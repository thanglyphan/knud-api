/**
 * Authentication routes for accounting systems
 * Supports both Fiken (OAuth2) and Tripletex (token-based)
 */

import { Router } from "express";
import crypto from "crypto";
import { prisma } from "../db.js";
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getFikenUserInfo,
  saveFikenTokens,
  revokeToken,
  getValidAccessToken as getFikenAccessToken,
  isFikenConfigured,
  deleteFikenConnection,
} from "../fiken/auth.js";
import {
  createSessionToken,
  saveTripletexTokens,
  isTripletexConfigured,
  getValidSessionToken,
} from "../tripletex/auth.js";

const router = Router();

const TRIPLETEX_API_URL =
  process.env.TRIPLETEX_API_URL || "https://api.tripletex.io/v2";

// Store state tokens temporarily (in production, use Redis or similar)
const stateTokens = new Map<string, { createdAt: number }>();

// Clean up old state tokens periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes
  for (const [state, data] of stateTokens.entries()) {
    if (now - data.createdAt > maxAge) {
      stateTokens.delete(state);
    }
  }
}, 60 * 1000); // Every minute

// ==================== PROVIDERS ====================

/**
 * GET /api/auth/providers
 * List available accounting providers
 */
router.get("/providers", (_req, res) => {
  const providers = [];

  if (isFikenConfigured()) {
    providers.push({
      id: "fiken",
      name: "Fiken",
      description: "Norsk regnskapsprogram for små bedrifter",
      authType: "oauth2",
    });
  }

  if (isTripletexConfigured()) {
    providers.push({
      id: "tripletex",
      name: "Tripletex",
      description: "Komplett regnskapssystem for norske bedrifter",
      authType: "token",
    });
  }

  res.json({ providers });
});

// ==================== FIKEN AUTH ====================

/**
 * GET /api/auth/fiken
 * Redirects user to Fiken OAuth2 authorization page
 */
router.get("/fiken", (_req, res) => {
  if (!isFikenConfigured()) {
    res.status(500).json({ error: "Fiken OAuth2 is not configured" });
    return;
  }

  // Generate random state for CSRF protection
  const state = crypto.randomBytes(32).toString("hex");
  stateTokens.set(state, { createdAt: Date.now() });

  const authUrl = getAuthorizationUrl(state);
  res.json({ authUrl, state });
});

/**
 * POST /api/auth/fiken/callback
 * Handles the OAuth2 callback from Fiken
 */
router.post("/fiken/callback", async (req, res) => {
  try {
    const { code, state } = req.body;

    if (!code || !state) {
      res.status(400).json({ error: "Missing code or state" });
      return;
    }

    // Verify state token
    if (!stateTokens.has(state)) {
      res.status(400).json({ error: "Invalid or expired state token" });
      return;
    }
    stateTokens.delete(state);

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, state);

    // Get user info from Fiken
    const userInfo = await getFikenUserInfo(tokens.access_token);

    if (!userInfo.email) {
      res.status(400).json({ error: "Could not get user email from Fiken" });
      return;
    }

    // Create or update user in database
    const user = await prisma.user.upsert({
      where: { email: userInfo.email },
      create: {
        email: userInfo.email,
        name: userInfo.name,
        activeProvider: "fiken",
      },
      update: {
        name: userInfo.name,
        activeProvider: "fiken",
      },
    });

    // Save Fiken tokens
    await saveFikenTokens(user.id, tokens);

    // Return user info and session token (using user ID as simple token for now)
    // In production, you'd want to use JWT or similar
    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      sessionToken: user.id, // Simple session token
    });
  } catch (error) {
    console.error("OAuth callback error:", error);
    res.status(500).json({
      error: "Failed to complete authentication",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ==================== TRIPLETEX AUTH ====================

/**
 * POST /api/auth/tripletex/connect
 * Connect Tripletex using employee token
 */
router.post("/tripletex/connect", async (req, res) => {
  try {
    if (!isTripletexConfigured()) {
      res.status(500).json({ error: "Tripletex is not configured" });
      return;
    }

    const { employeeToken, expirationDate, email } = req.body;

    if (!employeeToken) {
      res.status(400).json({ error: "Employee token is required" });
      return;
    }

    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    // Create session token
    const { sessionToken, expiresAt } = await createSessionToken(
      employeeToken,
      expirationDate
    );

    // Create or update user in database
    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        activeProvider: "tripletex",
      },
      update: {
        activeProvider: "tripletex",
      },
    });

    // Save Tripletex tokens
    await saveTripletexTokens(user.id, sessionToken, employeeToken, expiresAt);

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      sessionToken: user.id,
    });
  } catch (error) {
    console.error("Tripletex connect error:", error);
    res.status(500).json({
      error: "Failed to connect Tripletex",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ==================== USER INFO ====================

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get("/me", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = authHeader.split(" ")[1];

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        accountingConnections: {
          select: {
            provider: true,
            companyId: true,
            companyName: true,
            organizationNumber: true,
            expiresAt: true,
          },
        },
      },
    });

    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    // Find active connection
    const activeConnection = user.accountingConnections.find(
      (c) => c.provider === user.activeProvider
    );

    // Check if token is still valid
    const hasValidToken =
      activeConnection && new Date(activeConnection.expiresAt) > new Date();

    // Check if subscription is active
    const isSubscriptionActive =
      user.subscriptionStatus === "active" ||
      (user.subscriptionStatus === "cancelled" &&
        user.subscriptionEnds &&
        new Date(user.subscriptionEnds) > new Date());

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        activeProvider: user.activeProvider,
        accountingConnected: !!activeConnection,
        accountingTokenValid: hasValidToken,
        // Legacy fields for backward compatibility
        fikenConnected: user.accountingConnections.some(
          (c) => c.provider === "fiken"
        ),
        fikenTokenValid:
          user.activeProvider === "fiken" ? hasValidToken : false,
        company: activeConnection
          ? {
              slug: activeConnection.companyId, // For Fiken compatibility
              id: activeConnection.companyId,
              name: activeConnection.companyName,
              organizationNumber: activeConnection.organizationNumber,
            }
          : null,
        connections: user.accountingConnections.map((c) => ({
          provider: c.provider,
          companyId: c.companyId,
          companyName: c.companyName,
          organizationNumber: c.organizationNumber,
          expiresAt: c.expiresAt,
          isActive: c.provider === user.activeProvider,
        })),
        subscription: {
          status: user.subscriptionStatus,
          started: user.subscriptionStarted,
          ends: user.subscriptionEnds,
          isActive: isSubscriptionActive,
        },
      },
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ error: "Failed to get user info" });
  }
});

// ==================== LOGOUT ====================

/**
 * POST /api/auth/logout
 * Logout user and revoke tokens
 */
router.post("/logout", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = authHeader.split(" ")[1];

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { activeProvider: true },
    });

    // Revoke Fiken token if connected
    if (user?.activeProvider === "fiken") {
      const accessToken = await getFikenAccessToken(userId);
      if (accessToken) {
        try {
          await revokeToken(accessToken);
        } catch (e) {
          console.error("Failed to revoke Fiken token:", e);
        }
      }
    }

    // Delete all accounting connections
    await prisma.accountingConnection.deleteMany({
      where: { userId },
    });

    // Clear active provider
    await prisma.user.update({
      where: { id: userId },
      data: { activeProvider: null },
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Failed to logout" });
  }
});

// ==================== COMPANIES ====================

/**
 * GET /api/auth/companies
 * Get list of companies the user has access to
 */
router.get("/companies", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = authHeader.split(" ")[1];
  const provider =
    (req.headers["x-provider"] as string) ||
    (await prisma.user
      .findUnique({ where: { id: userId }, select: { activeProvider: true } })
      .then((u) => u?.activeProvider)) ||
    "fiken";

  try {
    if (provider === "fiken") {
      const accessToken = await getFikenAccessToken(userId);
      if (!accessToken) {
        res.status(401).json({ error: "Fiken token expired or invalid" });
        return;
      }

      // Fetch companies from Fiken API
      const response = await fetch("https://api.fiken.no/api/v2/companies", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch companies from Fiken");
      }

      const companies = await response.json();

      res.json({
        provider: "fiken",
        companies: companies.map((c: any) => ({
          id: c.slug,
          slug: c.slug, // For backward compatibility
          name: c.name,
          organizationNumber: c.organizationNumber,
        })),
      });
    } else if (provider === "tripletex") {
      const sessionToken = await getValidSessionToken(userId);
      if (!sessionToken) {
        res.status(401).json({ error: "Tripletex token expired or invalid" });
        return;
      }

      // Bruk companyId=0 for å hente selskaper brukeren har tilgang til
      // companyId=0 betyr "selskapet til token-eieren"
      const authHeader = `Basic ${Buffer.from(`0:${sessionToken}`).toString("base64")}`;

      // Først, hent brukerens eget selskap via whoAmI
      const whoAmIResponse = await fetch(
        `${TRIPLETEX_API_URL}/token/session/%3EwhoAmI`,
        {
          headers: {
            Authorization: authHeader,
          },
        }
      );

      if (!whoAmIResponse.ok) {
        const errorText = await whoAmIResponse.text();
        console.error("Tripletex whoAmI error:", errorText);
        throw new Error("Failed to get user info from Tripletex");
      }

      const whoAmIData = await whoAmIResponse.json();
      console.log("Tripletex whoAmI response:", JSON.stringify(whoAmIData, null, 2));

      // Hent brukerens selskap-ID fra whoAmI
      const userCompanyId = whoAmIData.value?.company?.id;
      const companies: any[] = [];

      // Hvis vi har en company ID, hent full selskapsinformasjon
      if (userCompanyId) {
        // Bruk companyId i auth header for å hente selskapsdetaljer
        const companyAuthHeader = `Basic ${Buffer.from(`${userCompanyId}:${sessionToken}`).toString("base64")}`;
        
        const companyResponse = await fetch(
          `${TRIPLETEX_API_URL}/company/${userCompanyId}`,
          {
            headers: {
              Authorization: companyAuthHeader,
            },
          }
        );

        if (companyResponse.ok) {
          const companyData = await companyResponse.json();
          console.log("Tripletex company response:", JSON.stringify(companyData, null, 2));
          
          const company = companyData.value;
          if (company) {
            companies.push({
              id: String(company.id),
              name: company.name || `Selskap ${company.id}`,
              organizationNumber: company.organizationNumber,
            });
          }
        } else {
          // Fallback: bruk data fra whoAmI selv om det mangler navn
          const simpleCompany = whoAmIData.value?.company;
          if (simpleCompany) {
            companies.push({
              id: String(simpleCompany.id),
              name: simpleCompany.name || `Selskap ${simpleCompany.id}`,
              organizationNumber: simpleCompany.organizationNumber,
            });
          }
        }
      }

      // Hent også liste over selskaper med tilgang (for regnskapsførere)
      const companiesResponse = await fetch(
        `${TRIPLETEX_API_URL}/company/%3EwithLoginAccess`,
        {
          headers: {
            Authorization: authHeader,
          },
        }
      );

      if (companiesResponse.ok) {
        const companiesData = await companiesResponse.json();
        console.log("Tripletex companies response:", JSON.stringify(companiesData, null, 2));
        
        // Legg til eventuelle andre selskaper (unngå duplikater)
        for (const c of companiesData.values || []) {
          if (!companies.some((existing) => existing.id === String(c.id))) {
            companies.push({
              id: String(c.id),
              name: c.name || `Selskap ${c.id}`,
              organizationNumber: c.organizationNumber,
            });
          }
        }
      }

      res.json({
        provider: "tripletex",
        companies,
      });
    } else {
      res.status(400).json({ error: "Invalid provider" });
    }
  } catch (error) {
    console.error("Get companies error:", error);
    res.status(500).json({ error: "Failed to get companies" });
  }
});

/**
 * POST /api/auth/select-company
 * Select which company to use
 */
router.post("/select-company", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = authHeader.split(" ")[1];
  const { companySlug, companyId, companyName, organizationNumber, provider } =
    req.body;

  const resolvedCompanyId = companyId || companySlug;

  if (!resolvedCompanyId) {
    res.status(400).json({ error: "Company ID/slug is required" });
    return;
  }

  try {
    // Get active provider if not specified
    const activeProvider =
      provider ||
      (await prisma.user
        .findUnique({ where: { id: userId }, select: { activeProvider: true } })
        .then((u) => u?.activeProvider)) ||
      "fiken";

    await prisma.accountingConnection.update({
      where: {
        userId_provider: {
          userId,
          provider: activeProvider,
        },
      },
      data: {
        companyId: resolvedCompanyId,
        companyName,
        organizationNumber,
      },
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Select company error:", error);
    res.status(500).json({ error: "Failed to select company" });
  }
});

// ==================== SWITCH PROVIDER ====================

/**
 * POST /api/auth/switch-provider
 * Switch active accounting provider
 */
router.post("/switch-provider", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = authHeader.split(" ")[1];
  const { provider } = req.body;

  if (!provider || !["fiken", "tripletex"].includes(provider)) {
    res.status(400).json({ error: "Invalid provider" });
    return;
  }

  try {
    // Check if user has a connection for this provider
    const connection = await prisma.accountingConnection.findUnique({
      where: {
        userId_provider: {
          userId,
          provider,
        },
      },
    });

    if (!connection) {
      res.status(400).json({
        error: `No ${provider} connection found. Please connect first.`,
      });
      return;
    }

    // Update active provider
    await prisma.user.update({
      where: { id: userId },
      data: { activeProvider: provider },
    });

    res.json({ success: true, activeProvider: provider });
  } catch (error) {
    console.error("Switch provider error:", error);
    res.status(500).json({ error: "Failed to switch provider" });
  }
});

// ==================== DISCONNECT ====================

/**
 * POST /api/auth/disconnect
 * Disconnect a specific accounting provider
 */
router.post("/disconnect", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = authHeader.split(" ")[1];
  const { provider } = req.body;

  if (!provider || !["fiken", "tripletex"].includes(provider)) {
    res.status(400).json({ error: "Invalid provider" });
    return;
  }

  try {
    // Revoke Fiken token if disconnecting Fiken
    if (provider === "fiken") {
      const accessToken = await getFikenAccessToken(userId);
      if (accessToken) {
        try {
          await revokeToken(accessToken);
        } catch (e) {
          console.error("Failed to revoke Fiken token:", e);
        }
      }
    }

    // Delete the connection
    await prisma.accountingConnection.deleteMany({
      where: {
        userId,
        provider,
      },
    });

    // If this was the active provider, switch to another or clear
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { accountingConnections: true },
    });

    if (user && user.activeProvider === provider) {
      const otherConnection = user.accountingConnections.find(
        (c) => c.provider !== provider
      );
      await prisma.user.update({
        where: { id: userId },
        data: { activeProvider: otherConnection?.provider || null },
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Disconnect error:", error);
    res.status(500).json({ error: "Failed to disconnect" });
  }
});

export default router;
