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
        name: user.name || undefined,
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
 * POST /api/stripe/validate-promo-code
 * Validate a promotion code and return discount info
 */
router.post("/validate-promo-code", async (req: Request, res: Response) => {
  const { code } = req.body;

  if (!code) {
    res.status(400).json({ error: "Promotion code is required" });
    return;
  }

  try {
    // Search for active promotion codes matching the code
    const promotionCodes = await stripe.promotionCodes.list({
      code: code.toUpperCase(),
      active: true,
      limit: 1,
    });

    if (promotionCodes.data.length === 0) {
      res.json({ 
        valid: false, 
        error: "Ugyldig eller utløpt rabattkode" 
      });
      return;
    }

    const promoCode = promotionCodes.data[0];
    
    // Fetch the coupon separately to get full details
    // The coupon ID can be in different places depending on SDK version
    const promoCodeAny = promoCode as any;
    let couponId: string;
    
    if (promoCodeAny.coupon) {
      // Direct coupon property
      couponId = typeof promoCodeAny.coupon === "string" 
        ? promoCodeAny.coupon 
        : promoCodeAny.coupon.id;
    } else if (promoCodeAny.promotion?.coupon) {
      // Nested under promotion
      couponId = promoCodeAny.promotion.coupon;
    } else {
      throw new Error("Could not find coupon ID in promotion code");
    }
    
    const coupon = await stripe.coupons.retrieve(couponId);

    // Build discount info in format frontend expects
    const discount: {
      type: "percent_off" | "amount_off";
      value: number;
      currency?: string;
      duration: string;
      durationInMonths?: number;
      name?: string;
    } = coupon.amount_off
      ? {
          type: "amount_off",
          value: coupon.amount_off,
          currency: coupon.currency || "nok",
          duration: coupon.duration,
          durationInMonths: coupon.duration_in_months || undefined,
          name: coupon.name || undefined,
        }
      : {
          type: "percent_off",
          value: coupon.percent_off || 0,
          duration: coupon.duration,
          durationInMonths: coupon.duration_in_months || undefined,
          name: coupon.name || undefined,
        };

    res.json({
      valid: true,
      promotionCodeId: promoCode.id,
      discount,
    });
  } catch (error) {
    console.error("Error validating promo code:", error);
    res.status(500).json({ 
      valid: false, 
      error: "Kunne ikke validere rabattkode" 
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
  const { priceId, setupIntentId, promotionCode } = req.body;

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
    // Only give trial if user hasn't used it before
    const trialDays = parseInt(process.env.TRIAL_DAYS || "0", 10);
    const canHaveTrial = trialDays > 0 && !user.hasUsedTrial;
    const trialEnd = canHaveTrial 
      ? Math.floor(Date.now() / 1000) + (trialDays * 24 * 60 * 60)
      : undefined;

    // Create subscription with automatic tax and trial (if applicable)
    const subscriptionParams: Stripe.SubscriptionCreateParams = {
      customer: user.stripeCustomerId,
      items: [{ price: priceId }],
      default_payment_method: paymentMethodId,
      automatic_tax: { enabled: true },
      ...(trialEnd && { trial_end: trialEnd }),
      ...(promotionCode && { discounts: [{ promotion_code: promotionCode }] }),
    };

    const subscription = await stripe.subscriptions.create(subscriptionParams);

    // Update user subscription status in database
    // Preserve trialing status instead of converting to active
    const status = subscription.status === "trialing" ? "trialing" : subscription.status;
    
    // Get subscription dates safely
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subAny = subscription as any;
    const createdTimestamp = subAny.created || subAny.start_date || Math.floor(Date.now() / 1000);
    const subscriptionStarted = new Date(createdTimestamp * 1000);
    
    // Use trial_end if available, otherwise current_period_end
    let subscriptionEnds: Date;
    if (subAny.trial_end && typeof subAny.trial_end === 'number') {
      subscriptionEnds = new Date(subAny.trial_end * 1000);
    } else if (subAny.current_period_end && typeof subAny.current_period_end === 'number') {
      subscriptionEnds = new Date(subAny.current_period_end * 1000);
    } else {
      // Fallback: 30 days from now
      subscriptionEnds = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        subscriptionStatus: status,
        subscriptionStarted,
        subscriptionEnds,
        // Mark trial as used if this subscription has a trial
        ...(canHaveTrial && { hasUsedTrial: true }),
      },
    });

    res.json({
      subscriptionId: subscription.id,
      status: subscription.status,
      trialEnd: subAny.trial_end ? new Date(subAny.trial_end * 1000).toISOString() : null,
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
        status = "active";
        break;
      case "trialing":
        status = "trialing";
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

    const isActive = status === "active" || status === "trialing" ||
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
 * GET /api/stripe/coupon-status
 * Check if user has used the FIKEN99 or TRIPLETEX129 coupons
 */
router.get("/coupon-status", async (req: Request, res: Response) => {
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

    // If user has no Stripe customer, they haven't used any coupon
    if (!user.stripeCustomerId) {
      res.json({ hasUsedFiken99: false, hasUsedTripletex129: false });
      return;
    }

    // Fetch all subscriptions for this customer (including canceled)
    const subscriptions = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "all",
      expand: ["data.discount.coupon", "data.discount.promotion_code"],
    });

    // Helper to check if a subscription has a specific coupon/promo code
    const hasUsedCoupon = (couponName: string) =>
      subscriptions.data.some((sub) => {
        const discount = (sub as any).discount;
        if (!discount) return false;

        // Check coupon ID or name
        const coupon = discount.coupon;
        if (coupon?.id === couponName || coupon?.name === couponName) {
          return true;
        }

        // Check promotion code
        const promoCode = discount.promotion_code;
        if (promoCode && typeof promoCode === "object") {
          if (promoCode.code === couponName) {
            return true;
          }
        }

        return false;
      });

    res.json({
      hasUsedFiken99: hasUsedCoupon("FIKEN99"),
      hasUsedTripletex129: hasUsedCoupon("TRIPLETEX129"),
    });
  } catch (error) {
    console.error("Error checking coupon status:", error);
    res.status(500).json({ error: "Failed to check coupon status" });
  }
});

/**
 * GET /api/stripe/subscription-details
 * Get the user's active subscription details including actual price and discount
 */
router.get("/subscription-details", async (req: Request, res: Response) => {
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

    // If no Stripe customer, return null subscription
    if (!user.stripeCustomerId) {
      res.json({ subscription: null });
      return;
    }

    // Fetch active or trialing subscription
    // Note: Stripe uses "discounts" (array) not "discount" (singular)
    const subscriptions = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "all",
      limit: 1,
      expand: ["data.items.data.price", "data.discounts"],
    });

    // Find active or trialing subscription
    const activeSubscription = subscriptions.data.find(
      (sub) => sub.status === "active" || sub.status === "trialing"
    ) || subscriptions.data[0];

    if (!activeSubscription) {
      res.json({ subscription: null });
      return;
    }

    // Get price info from subscription item
    const subscriptionItem = activeSubscription.items.data[0];
    const price = subscriptionItem?.price;
    
    // Get discount info if any (discounts is an array in Stripe API)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const discounts = (activeSubscription as any).discounts as any[];
    const discount = discounts && discounts.length > 0 ? discounts[0] : null;
    let discountInfo = null;
    
    if (discount) {
      // Get coupon ID from discount.source.coupon (newer format) or discount.coupon
      const couponId = discount.source?.coupon || discount.coupon?.id || discount.coupon;
      if (couponId) {
        // Fetch full coupon details
        const coupon = await stripe.coupons.retrieve(couponId);
        discountInfo = {
          name: coupon.name || coupon.id,
          amountOff: coupon.amount_off,
          percentOff: coupon.percent_off,
          currency: coupon.currency,
          duration: coupon.duration,
        };
      }
    }

    // Calculate actual price after discount
    const unitAmount = price?.unit_amount || 0;
    let discountedAmount = unitAmount;
    
    if (discountInfo) {
      if (discountInfo.amountOff) {
        discountedAmount = Math.max(0, unitAmount - discountInfo.amountOff);
      } else if (discountInfo.percentOff) {
        discountedAmount = Math.round(unitAmount * (1 - discountInfo.percentOff / 100));
      }
    }

    res.json({
      subscription: {
        id: activeSubscription.id,
        status: activeSubscription.status,
        currentPeriodEnd: (activeSubscription as any).current_period_end,
        cancelAtPeriodEnd: activeSubscription.cancel_at_period_end,
        price: {
          unitAmount: unitAmount,
          discountedAmount: discountedAmount,
          currency: price?.currency || "nok",
          interval: price?.recurring?.interval || "month",
          intervalCount: price?.recurring?.interval_count || 1,
        },
        discount: discountInfo,
      },
    });
  } catch (error) {
    console.error("Error fetching subscription details:", error);
    res.status(500).json({ error: "Failed to fetch subscription details" });
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

  // Log ALL incoming webhook events for debugging
  console.log(`\n========== WEBHOOK RECEIVED ==========`);
  console.log(`Event type: ${event.type}`);
  console.log(`Event ID: ${event.id}`);
  console.log(`Event created: ${new Date(event.created * 1000).toISOString()}`);
  
  // Handle the event
  switch (event.type) {
    case "payment_intent.succeeded": {
      console.log(`[payment_intent.succeeded] Processing...`);
      const paymentIntent = event.data.object as Stripe.PaymentIntent & {
        invoice?: string | Stripe.Invoice | null;
      };
      const customerId = paymentIntent.customer as string;
      console.log(`[payment_intent.succeeded] Customer ID: ${customerId}`);

      if (!customerId) {
        console.log("[payment_intent.succeeded] No customer ID in payment intent, skipping");
        break;
      }

      // Check if this payment is for a subscription by looking at invoice
      if (paymentIntent.invoice) {
        const invoiceId = typeof paymentIntent.invoice === "string" 
          ? paymentIntent.invoice 
          : paymentIntent.invoice.id;
        console.log(`[payment_intent.succeeded] Invoice ID: ${invoiceId}`);
        
        const invoice = await stripe.invoices.retrieve(invoiceId) as Stripe.Invoice & {
          subscription?: string | Stripe.Subscription | null;
        };
        
        if (invoice.subscription) {
          const subscriptionId = typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription.id;
          console.log(`[payment_intent.succeeded] Subscription ID: ${subscriptionId}`);
          
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const subData = subscription as any;

          console.log(`[payment_intent.succeeded] Subscription status: ${subData.status}`);
          console.log(`[payment_intent.succeeded] cancel_at_period_end: ${subData.cancel_at_period_end}`);
          console.log(`[payment_intent.succeeded] cancel_at: ${subData.cancel_at}`);
          console.log(`[payment_intent.succeeded] current_period_start: ${subData.current_period_start}`);
          console.log(`[payment_intent.succeeded] current_period_end: ${subData.current_period_end}`);
          console.log(`[payment_intent.succeeded] trial_start: ${subData.trial_start}`);
          console.log(`[payment_intent.succeeded] trial_end: ${subData.trial_end}`);

          // Validate dates before updating - use trial dates as fallback for trialing subscriptions
          const periodStart = subData.current_period_start || subData.trial_start || subData.start_date;
          const periodEnd = subData.current_period_end || subData.trial_end;
          
          if (!periodStart || !periodEnd) {
            console.log(`[payment_intent.succeeded] Missing period dates, skipping update`);
            break;
          }

          // Don't override cancelled status if subscription is set to cancel
          const isCancelling = subData.cancel_at_period_end || subData.cancel_at !== null;
          // Preserve trialing status, don't convert to active
          let status: string;
          if (isCancelling) {
            status = "cancelled";
          } else if (subData.status === "trialing") {
            status = "trialing";
          } else {
            status = "active";
          }
          console.log(`[payment_intent.succeeded] Setting status to: ${status}`);

          // Update user subscription status
          await prisma.user.updateMany({
            where: { stripeCustomerId: customerId },
            data: {
              subscriptionStatus: status,
              subscriptionStarted: new Date(periodStart * 1000),
              subscriptionEnds: new Date(periodEnd * 1000),
            },
          });

          console.log(`[payment_intent.succeeded] Database updated for customer ${customerId}`);
        }
      } else {
        console.log(`[payment_intent.succeeded] No invoice attached, skipping`);
      }
      break;
    }

    case "invoice.payment_succeeded": {
      console.log(`[invoice.payment_succeeded] Processing...`);
      const invoice = event.data.object as Stripe.Invoice & { subscription: string };
      const customerId = invoice.customer as string;
      const subscriptionId = invoice.subscription;
      console.log(`[invoice.payment_succeeded] Customer ID: ${customerId}`);
      console.log(`[invoice.payment_succeeded] Subscription ID: ${subscriptionId}`);

      if (!subscriptionId) {
        console.log("[invoice.payment_succeeded] No subscription ID in invoice, skipping");
        break;
      }

      // Get subscription details
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subData = subscription as any;
      
      console.log(`[invoice.payment_succeeded] Subscription status: ${subData.status}`);
      console.log(`[invoice.payment_succeeded] cancel_at_period_end: ${subData.cancel_at_period_end}`);
      console.log(`[invoice.payment_succeeded] cancel_at: ${subData.cancel_at}`);
      console.log(`[invoice.payment_succeeded] current_period_start: ${subData.current_period_start}`);
      console.log(`[invoice.payment_succeeded] current_period_end: ${subData.current_period_end}`);
      console.log(`[invoice.payment_succeeded] trial_start: ${subData.trial_start}`);
      console.log(`[invoice.payment_succeeded] trial_end: ${subData.trial_end}`);
      
      // Validate dates before updating - use trial dates as fallback for trialing subscriptions
      const periodStart = subData.current_period_start || subData.trial_start || subData.start_date;
      const periodEnd = subData.current_period_end || subData.trial_end;
      
      if (!periodStart || !periodEnd) {
        console.log(`[invoice.payment_succeeded] Missing period dates, skipping update`);
        break;
      }

      // Don't override cancelled status if subscription is set to cancel
      const isCancelling = subData.cancel_at_period_end || subData.cancel_at !== null;
      // Preserve trialing status, don't convert to active
      let status: string;
      if (isCancelling) {
        status = "cancelled";
      } else if (subData.status === "trialing") {
        status = "trialing";
      } else {
        status = "active";
      }
      console.log(`[invoice.payment_succeeded] Setting status to: ${status}`);

      // Update user subscription status
      await prisma.user.updateMany({
        where: { stripeCustomerId: customerId },
        data: {
          subscriptionStatus: status,
          subscriptionStarted: new Date(periodStart * 1000),
          subscriptionEnds: new Date(periodEnd * 1000),
        },
      });

      console.log(`[invoice.payment_succeeded] Database updated for customer ${customerId}`);
      break;
    }

    case "customer.subscription.updated": {
      console.log(`[subscription.updated] Processing...`);
      const subscription = event.data.object as Stripe.Subscription & { 
        current_period_end: number;
        cancel_at_period_end: boolean;
        cancel_at: number | null;
        canceled_at: number | null;
      };
      const customerId = subscription.customer as string;
      
      console.log(`[subscription.updated] Customer ID: ${customerId}`);
      console.log(`[subscription.updated] Subscription status: ${subscription.status}`);
      console.log(`[subscription.updated] cancel_at_period_end: ${subscription.cancel_at_period_end}`);
      console.log(`[subscription.updated] cancel_at: ${subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : 'null'}`);
      console.log(`[subscription.updated] canceled_at: ${subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : 'null'}`);
      console.log(`[subscription.updated] current_period_end: ${new Date(subscription.current_period_end * 1000).toISOString()}`);

      // Map Stripe status to our status
      let status: string;
      
      // Check if subscription is set to cancel (either at period end or at a specific time)
      const isCancelling = subscription.cancel_at_period_end || subscription.cancel_at !== null;
      
      if (isCancelling) {
        status = "cancelled";
        console.log(`[subscription.updated] Subscription is cancelling -> setting status to "cancelled"`);
      } else {
        switch (subscription.status) {
          case "active":
            status = "active";
            break;
          case "trialing":
            status = "trialing";
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
        console.log(`[subscription.updated] Subscription is NOT cancelling -> setting status to "${status}"`);
      }

      await prisma.user.updateMany({
        where: { stripeCustomerId: customerId },
        data: {
          subscriptionStatus: status,
          subscriptionEnds: new Date(subscription.current_period_end * 1000),
        },
      });

      console.log(`[subscription.updated] Database updated: status=${status}`);
      console.log(`========== WEBHOOK COMPLETE ==========\n`);
      break;
    }

    case "customer.subscription.deleted": {
      console.log(`[subscription.deleted] Processing...`);
      const subscription = event.data.object as Stripe.Subscription & { current_period_end: number };
      const customerId = subscription.customer as string;
      
      console.log(`[subscription.deleted] Customer ID: ${customerId}`);
      console.log(`[subscription.deleted] current_period_end: ${new Date(subscription.current_period_end * 1000).toISOString()}`);

      await prisma.user.updateMany({
        where: { stripeCustomerId: customerId },
        data: {
          subscriptionStatus: "cancelled",
          subscriptionEnds: new Date(subscription.current_period_end * 1000),
        },
      });

      console.log(`[subscription.deleted] Database updated: status=cancelled`);
      console.log(`========== WEBHOOK COMPLETE ==========\n`);
      break;
    }

    default:
      console.log(`[UNHANDLED] Event type: ${event.type}`);
      console.log(`========== WEBHOOK COMPLETE ==========\n`);
  }

  res.json({ received: true });
};

export default router;
