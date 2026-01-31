/**
 * Stripe routes for subscription management
 */

import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { prisma } from "../db.js";

const router = Router();

// Initialize Stripe (using latest API version from package)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

/**
 * GET /api/stripe/products
 * Get all active products with prices and features
 */
router.get("/products", async (_req: Request, res: Response) => {
  try {
    // Get trial days from ENV
    const trialDays = parseInt(process.env.TRIAL_DAYS || "0", 10);

    // Fetch all active products with their default prices
    const products = await stripe.products.list({
      active: true,
      expand: ["data.default_price"],
    });

    // Format the response
    const formattedProducts = products.data.map((product) => {
      const price = product.default_price as Stripe.Price | null;
      
      // Parse features from metadata
      let features: string[] = [];
      if (product.metadata?.features) {
        // Support both comma-separated and JSON array formats
        try {
          features = JSON.parse(product.metadata.features);
        } catch {
          features = product.metadata.features.split(",").map((f) => f.trim());
        }
      } else if (product.metadata && Object.keys(product.metadata).length > 0) {
        // If no 'features' key, use all metadata values as features
        // This supports storing features as individual key-value pairs
        features = Object.values(product.metadata).filter((v) => typeof v === "string" && v.length > 0);
      }

      return {
        id: product.id,
        name: product.name,
        description: product.description,
        features,
        metadata: product.metadata,
        price: price
          ? {
              id: price.id,
              unitAmount: price.unit_amount,
              currency: price.currency,
              recurring: price.recurring
                ? {
                    interval: price.recurring.interval,
                    intervalCount: price.recurring.interval_count,
                  }
                : null,
            }
          : null,
        // Trial days from ENV (not from Stripe price)
        trialDays: trialDays > 0 ? trialDays : null,
      };
    });

    res.json({ products: formattedProducts });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

/**
 * POST /api/stripe/init-checkout
 * Initialize checkout by creating customer and SetupIntent
 * Returns clientSecret for collecting payment method without charging
 */
router.post("/init-checkout", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = authHeader.split(" ")[1];
  const { priceId } = req.body;

  if (!priceId) {
    res.status(400).json({ error: "Price ID is required" });
    return;
  }

  try {
    // Get user with accounting connection (to get organization number)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        accountingConnections: {
          select: {
            provider: true,
            organizationNumber: true,
            companyName: true,
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Get active connection for company info
    const activeConnection = user.accountingConnections.find(
      (c) => c.provider === "fiken"
    ) || user.accountingConnections[0];

    // Create or get Stripe customer
    let customerId = user.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: activeConnection?.companyName || user.name || undefined,
        metadata: {
          userId: user.id,
        },
      });
      customerId = customer.id;

      // Save customer ID to database
      await prisma.user.update({
        where: { id: userId },
        data: { stripeCustomerId: customerId },
      });
    }

    // Add Tax ID if organization number is available
    const organizationNumber = activeConnection?.organizationNumber;
    if (organizationNumber) {
      try {
        // Check if tax ID already exists
        const existingTaxIds = await stripe.customers.listTaxIds(customerId);
        const hasNoVat = existingTaxIds.data.some(
          (taxId) => taxId.type === "no_vat" && taxId.value === `${organizationNumber}MVA`
        );

        if (!hasNoVat) {
          await stripe.customers.createTaxId(customerId, {
            type: "no_vat",
            value: `${organizationNumber}MVA`,
          });
          console.log(`Tax ID added for customer ${customerId}: ${organizationNumber}MVA`);
        }
      } catch (taxError) {
        // Log but don't fail - tax ID is nice to have but not critical
        console.error("Failed to add tax ID:", taxError);
      }
    }

    // Get trial days from ENV
    const trialDays = parseInt(process.env.TRIAL_DAYS || "0", 10);

    // Create SetupIntent to collect payment method
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      metadata: {
        priceId,
        userId: user.id,
      },
    });

    if (!setupIntent.client_secret) {
      res.status(500).json({ error: "Failed to create setup intent" });
      return;
    }

    res.json({
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      customerId,
      trialPeriodDays: trialDays > 0 ? trialDays : null,
    });
  } catch (error) {
    console.error("Error initializing checkout:", error);
    res.status(500).json({
      error: "Failed to initialize checkout",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /api/stripe/complete-subscription
 * Complete subscription after payment method is saved
 * Creates subscription with trial period (if applicable) and automatic tax
 */
router.post("/complete-subscription", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = authHeader.split(" ")[1];
  const { priceId, setupIntentId } = req.body;

  if (!priceId || !setupIntentId) {
    res.status(400).json({ error: "Price ID and Setup Intent ID are required" });
    return;
  }

  try {
    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.stripeCustomerId) {
      res.status(404).json({ error: "User or Stripe customer not found" });
      return;
    }

    // Get SetupIntent to retrieve payment method
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    
    if (setupIntent.status !== "succeeded") {
      res.status(400).json({ error: "Setup intent not completed" });
      return;
    }

    const paymentMethodId = setupIntent.payment_method as string;
    if (!paymentMethodId) {
      res.status(400).json({ error: "No payment method found" });
      return;
    }

    // Get payment method to retrieve billing address
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    // Update customer with billing address (required for Stripe Tax)
    const updateData: Stripe.CustomerUpdateParams = {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    };

    // Add address from payment method if available
    if (paymentMethod.billing_details?.address) {
      updateData.address = {
        line1: paymentMethod.billing_details.address.line1 || undefined,
        line2: paymentMethod.billing_details.address.line2 || undefined,
        city: paymentMethod.billing_details.address.city || undefined,
        state: paymentMethod.billing_details.address.state || undefined,
        postal_code: paymentMethod.billing_details.address.postal_code || undefined,
        country: paymentMethod.billing_details.address.country || undefined,
      };
    }

    await stripe.customers.update(user.stripeCustomerId, updateData);

    // Get trial days from ENV and calculate trial_end timestamp
    const trialDays = parseInt(process.env.TRIAL_DAYS || "0", 10);
    const trialEnd = trialDays > 0 
      ? Math.floor(Date.now() / 1000) + (trialDays * 24 * 60 * 60)
      : undefined;

    // Create subscription with automatic tax and trial (if applicable)
    const subscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: user.stripeCustomerId,
      items: [{ price: priceId }],
      default_payment_method: paymentMethodId,
      automatic_tax: { enabled: true },
      ...(trialEnd && { trial_end: trialEnd }),
    };

    const subscription = await stripe.subscriptions.create(subscriptionParams);

    // Update user subscription status in database
    // Treat "trialing" as "active" for our purposes
    const status = subscription.status === "trialing" ? "active" : subscription.status;
    
    // Get subscription dates - cast to access properties
    const sub = subscription as unknown as {
      created: number;
      trial_end: number | null;
      current_period_end: number;
    };
    const subscriptionStarted = new Date(sub.created * 1000);
    const subscriptionEnds = sub.trial_end 
      ? new Date(sub.trial_end * 1000)
      : new Date(sub.current_period_end * 1000);

    await prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionStatus: status,
        subscriptionStarted,
        subscriptionEnds,
      },
    });

    res.json({
      subscriptionId: subscription.id,
      status: subscription.status,
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    });
  } catch (error) {
    console.error("Error completing subscription:", error);
    res.status(500).json({
      error: "Failed to complete subscription",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * POST /api/stripe/sync-subscription
 * Check and sync subscription status from Stripe (fallback if webhook is delayed)
 */
router.post("/sync-subscription", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = authHeader.split(" ")[1];

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (!user.stripeCustomerId) {
      res.json({ status: "none", isActive: false });
      return;
    }

    // Fetch subscriptions using raw API to get all fields (SDK types are incomplete)
    const fetchSubscriptions = async (statusFilter: string) => {
      const params = new URLSearchParams({
        customer: user.stripeCustomerId!,
        limit: "1",
        ...(statusFilter !== "all" && { status: statusFilter }),
      });
      const resp = await fetch(`https://api.stripe.com/v1/subscriptions?${params}`, {
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
      });
      return resp.json() as Promise<{
        data: Array<{
          id: string;
          status: string;
          current_period_end: number;
          current_period_start: number;
          start_date: number;
        }>;
      }>;
    };

    // Prioritize active, then trialing, then any
    let subscriptionsData = await fetchSubscriptions("active");
    if (subscriptionsData.data.length === 0) {
      subscriptionsData = await fetchSubscriptions("trialing");
    }
    if (subscriptionsData.data.length === 0) {
      subscriptionsData = await fetchSubscriptions("all");
    }

    if (subscriptionsData.data.length === 0) {
      res.json({ status: "none", isActive: false });
      return;
    }

    const subscription = subscriptionsData.data[0];
    
    // Map Stripe status to our status
    let status: string;
    switch (subscription.status) {
      case "active":
      case "trialing":
        status = "active";
        break;
      case "canceled":
        status = "cancelled";
        break;
      case "past_due":
      case "unpaid":
        status = "expired";
        break;
      default:
        status = subscription.status;
    }

    const isActive = status === "active" || 
      (status === "cancelled" && subscription.current_period_end * 1000 > Date.now());

    // Update user in database
    await prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionStatus: status,
        subscriptionStarted: new Date(subscription.start_date * 1000),
        subscriptionEnds: new Date(subscription.current_period_end * 1000),
      },
    });

    res.json({ 
      status, 
      isActive,
      subscriptionId: subscription.id,
    });
  } catch (error) {
    console.error("Error syncing subscription:", error);
    res.status(500).json({ error: "Failed to sync subscription" });
  }
});

/**
 * POST /api/stripe/portal
 * Create a customer portal session
 */
router.post("/portal", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = authHeader.split(" ")[1];

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.stripeCustomerId) {
      res.status(404).json({ error: "No Stripe customer found" });
      return;
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${process.env.FRONTEND_URL}/chat`,
    });

    res.json({ url: portalSession.url });
  } catch (error) {
    console.error("Error creating portal session:", error);
    res.status(500).json({ error: "Failed to create portal session" });
  }
});

/**
 * POST /api/stripe/webhook
 * Handle Stripe webhook events
 * Note: This route needs raw body, configured in index.ts
 */
export const handleWebhook = async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    res.status(400).json({ error: "Webhook signature verification failed" });
    return;
  }

  // Handle the event
  switch (event.type) {
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as Stripe.PaymentIntent & {
        invoice?: string | Stripe.Invoice | null;
      };
      const customerId = paymentIntent.customer as string;

      if (!customerId) {
        console.log("No customer ID in payment intent, skipping");
        break;
      }

      // Check if this payment is for a subscription by looking at invoice
      if (paymentIntent.invoice) {
        const invoiceId = typeof paymentIntent.invoice === "string" 
          ? paymentIntent.invoice 
          : paymentIntent.invoice.id;
        
        const invoice = await stripe.invoices.retrieve(invoiceId) as Stripe.Invoice & {
          subscription?: string | Stripe.Subscription | null;
        };
        
        if (invoice.subscription) {
          const subscriptionId = typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription.id;
          
          const subscription = await stripe.subscriptions.retrieve(subscriptionId) as unknown as Stripe.Subscription & {
            current_period_start: number;
            current_period_end: number;
          };

          // Update user subscription status
          await prisma.user.updateMany({
            where: { stripeCustomerId: customerId },
            data: {
              subscriptionStatus: "active",
              subscriptionStarted: new Date(subscription.current_period_start * 1000),
              subscriptionEnds: new Date(subscription.current_period_end * 1000),
            },
          });

          console.log(`Subscription activated via payment_intent.succeeded for customer ${customerId}`);
        }
      }
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice & { subscription: string };
      const customerId = invoice.customer as string;
      const subscriptionId = invoice.subscription;

      if (!subscriptionId) {
        console.log("No subscription ID in invoice, skipping");
        break;
      }

      // Get subscription details
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const subData = subscription as unknown as {
        current_period_start: number;
        current_period_end: number;
      };

      // Update user subscription status
      await prisma.user.updateMany({
        where: { stripeCustomerId: customerId },
        data: {
          subscriptionStatus: "active",
          subscriptionStarted: new Date(subData.current_period_start * 1000),
          subscriptionEnds: new Date(subData.current_period_end * 1000),
        },
      });

      console.log(`Subscription activated for customer ${customerId}`);
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription & { current_period_end: number };
      const customerId = subscription.customer as string;

      // Map Stripe status to our status
      let status: string;
      switch (subscription.status) {
        case "active":
          status = "active";
          break;
        case "canceled":
          status = "cancelled";
          break;
        case "past_due":
        case "unpaid":
          status = "expired";
          break;
        default:
          status = subscription.status;
      }

      await prisma.user.updateMany({
        where: { stripeCustomerId: customerId },
        data: {
          subscriptionStatus: status,
          subscriptionEnds: new Date(subscription.current_period_end * 1000),
        },
      });

      console.log(`Subscription updated for customer ${customerId}: ${status}`);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription & { current_period_end: number };
      const customerId = subscription.customer as string;

      await prisma.user.updateMany({
        where: { stripeCustomerId: customerId },
        data: {
          subscriptionStatus: "cancelled",
          subscriptionEnds: new Date(subscription.current_period_end * 1000),
        },
      });

      console.log(`Subscription cancelled for customer ${customerId}`);
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
};

export default router;
