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
  isTripletexConfigured,
  isTripletexEnabled,
  createSessionToken,
  getLoggedInUser,
  saveTripletexConnection,
} from "../tripletex/auth.js";
import {
  createOnboardingToken,
  verifyOnboardingToken,
  type OnboardingData,
} from "../utils/onboarding-token.js";

const router = Router();

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

  // Tripletex - enabled based on feature flag
  const tripletexEnabled = isTripletexEnabled() && isTripletexConfigured();
  providers.push({
    id: "tripletex",
    name: "Tripletex",
    description: tripletexEnabled 
      ? "Norsk regnskapsprogram med lønn og A-melding" 
      : "Kommer snart",
    authType: "token",
    disabled: !tripletexEnabled,
  });

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
 * 
 * For NEW users: Returns an onboardingToken (JWT) containing encrypted OAuth tokens.
 *                User is NOT created in DB yet - that happens in complete-onboarding.
 * For EXISTING users: Updates tokens and returns sessionToken as before.
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

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: userInfo.email },
    });

    if (existingUser) {
      // EXISTING USER: Update tokens and return sessionToken
      await saveFikenTokens(existingUser.id, tokens);
      
      // Update active provider to fiken
      await prisma.user.update({
        where: { id: existingUser.id },
        data: { activeProvider: "fiken" },
      });

      res.json({
        success: true,
        isNewUser: false,
        user: {
          id: existingUser.id,
          email: existingUser.email,
          name: existingUser.name,
        },
        sessionToken: existingUser.id,
      });
    } else {
      // NEW USER: Return onboardingToken, don't create user yet
      const onboardingToken = createOnboardingToken({
        provider: "fiken",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        email: userInfo.email,
        name: userInfo.name || null,
      });

      res.json({
        success: true,
        isNewUser: true,
        onboardingToken,
      });
    }
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
 * Connect to Tripletex using an employee token
 * 
 * The employee token is generated by the user in Tripletex:
 * 1. Go to Tripletex settings
 * 2. Navigate to "Integrasjoner" or "API"
 * 3. Create a new employee token
 * 
 * For NEW users: Returns an onboardingToken (JWT) containing encrypted tokens.
 *                User is NOT created in DB yet - that happens in complete-onboarding.
 * For EXISTING users: Updates tokens and returns sessionToken as before.
 * 
 * Note: Tripletex returns company info directly, but we still use the same onboarding
 * flow for consistency. The company from Tripletex will be pre-selected in SelectCompany.
 */
router.post("/tripletex/connect", async (req, res) => {
  // Check if Tripletex is enabled
  if (!isTripletexEnabled() || !isTripletexConfigured()) {
    res.status(501).json({
      error: "Tripletex-integrasjon er ikke tilgjengelig ennå",
      message: "Kommer snart!",
    });
    return;
  }

  try {
    const { employeeToken, email } = req.body;

    if (!employeeToken) {
      res.status(400).json({ error: "Employee token er påkrevd" });
      return;
    }

    if (!email) {
      res.status(400).json({ error: "E-post er påkrevd" });
      return;
    }

    // Create session token using the employee token
    const session = await createSessionToken(employeeToken);

    // Get user info from Tripletex
    const userInfo = await getLoggedInUser(session.token);
    const userName = `${userInfo.employee.firstName} ${userInfo.employee.lastName}`.trim();

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      // EXISTING USER: Update tokens and return sessionToken
      await saveTripletexConnection(
        existingUser.id,
        employeeToken,
        session.token,
        new Date(session.expirationDate),
        String(userInfo.companyId),
        userInfo.company.name,
        userInfo.company.organizationNumber
      );

      // Update active provider to tripletex
      await prisma.user.update({
        where: { id: existingUser.id },
        data: { 
          activeProvider: "tripletex",
          name: userName,
        },
      });

      res.json({
        success: true,
        isNewUser: false,
        user: {
          id: existingUser.id,
          email: existingUser.email,
          name: userName,
        },
        company: {
          id: String(userInfo.companyId),
          name: userInfo.company.name,
          organizationNumber: userInfo.company.organizationNumber,
        },
        sessionToken: existingUser.id,
      });
    } else {
      // NEW USER: Return onboardingToken, don't create user yet
      // Note: For Tripletex, we include the session token (not employee token) as accessToken
      // The refresh token concept doesn't apply the same way, so we store employeeToken there
      const onboardingToken = createOnboardingToken({
        provider: "tripletex",
        accessToken: session.token,
        refreshToken: employeeToken, // Store employee token for later use
        expiresIn: Math.floor((new Date(session.expirationDate).getTime() - Date.now()) / 1000),
        email,
        name: userName,
      });

      res.json({
        success: true,
        isNewUser: true,
        onboardingToken,
        // Include company info since Tripletex provides it directly
        company: {
          id: String(userInfo.companyId),
          name: userInfo.company.name,
          organizationNumber: userInfo.company.organizationNumber,
        },
      });
    }
  } catch (error) {
    console.error("Tripletex connect error:", error);
    res.status(500).json({
      error: "Kunne ikke koble til Tripletex",
      details: error instanceof Error ? error.message : "Ukjent feil",
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
        acceptedTermsAt: user.acceptedTermsAt,
        accountingConnected: !!activeConnection,
        accountingTokenValid: hasValidToken,
        // Legacy fields for backward compatibility
        fikenConnected: user.accountingConnections.some(
          (c) => c.provider === "fiken"
        ),
        fikenTokenValid:
          user.activeProvider === "fiken" ? hasValidToken : false,
        // Only return company if companyId is set (user has completed company selection)
        company: activeConnection?.companyId
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
 * 
 * Supports two authentication methods:
 * 1. X-Onboarding-Token: For new users during onboarding (before user is created)
 * 2. Authorization: Bearer <sessionToken>: For existing users
 */
router.get("/companies", async (req, res) => {
  const onboardingToken = req.headers["x-onboarding-token"] as string;
  const authHeader = req.headers.authorization;

  // Try onboarding token first (for new users)
  if (onboardingToken) {
    const onboardingData = verifyOnboardingToken(onboardingToken);
    if (!onboardingData) {
      res.status(401).json({ error: "Invalid or expired onboarding token" });
      return;
    }

    try {
      if (onboardingData.provider === "fiken") {
        // Fetch companies from Fiken API using the token from onboarding data
        const response = await fetch("https://api.fiken.no/api/v2/companies", {
          headers: {
            Authorization: `Bearer ${onboardingData.accessToken}`,
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
            slug: c.slug,
            name: c.name,
            organizationNumber: c.organizationNumber,
            hasApiAccess: c.hasApiAccess ?? true,
          })),
        });
      } else if (onboardingData.provider === "tripletex") {
        // For Tripletex, we need to fetch company info using the session token
        // The session token is stored as accessToken in onboarding data
        const userInfo = await getLoggedInUser(onboardingData.accessToken);

        res.json({
          provider: "tripletex",
          companies: [{
            id: String(userInfo.companyId),
            name: userInfo.company.name,
            organizationNumber: userInfo.company.organizationNumber,
          }],
        });
      } else {
        res.status(400).json({ error: "Invalid provider in onboarding token" });
      }
    } catch (error) {
      console.error("Get companies error (onboarding):", error);
      res.status(500).json({ error: "Failed to get companies" });
    }
    return;
  }

  // Fall back to session token for existing users
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
          hasApiAccess: c.hasApiAccess ?? true, // API module enabled in Fiken
        })),
      });
    } else if (provider === "tripletex") {
      // For Tripletex, the company is already set during connect
      // Return the stored company from the connection
      const connection = await prisma.accountingConnection.findUnique({
        where: {
          userId_provider: {
            userId,
            provider: "tripletex",
          },
        },
        select: {
          companyId: true,
          companyName: true,
          organizationNumber: true,
        },
      });

      if (!connection || !connection.companyId) {
        res.status(401).json({ error: "Tripletex not connected" });
        return;
      }

      // Tripletex users typically only have access to one company
      res.json({
        provider: "tripletex",
        companies: [{
          id: connection.companyId,
          name: connection.companyName,
          organizationNumber: connection.organizationNumber,
        }],
      });
    } else {
      res.status(400).json({ error: "Invalid provider" });
    }
  } catch (error) {
    console.error("Get companies error:", error);
    res.status(500).json({ error: "Failed to get companies" });
  }
});

// ==================== ONBOARDING ====================

/**
 * POST /api/auth/complete-onboarding
 * Complete the onboarding process for new users
 * 
 * This endpoint is called after a new user has selected their company.
 * It creates the user in the database and sets up their accounting connection.
 * 
 * Requires: X-Onboarding-Token header with valid JWT from fiken/callback or tripletex/connect
 */
router.post("/complete-onboarding", async (req, res) => {
  const onboardingToken = req.headers["x-onboarding-token"] as string;
  
  if (!onboardingToken) {
    res.status(401).json({ error: "Onboarding token is required" });
    return;
  }

  const onboardingData = verifyOnboardingToken(onboardingToken);
  if (!onboardingData) {
    res.status(401).json({ error: "Invalid or expired onboarding token" });
    return;
  }

  const { companyId, companyName, organizationNumber, acceptedTerms } = req.body;

  if (!companyId) {
    res.status(400).json({ error: "Company ID is required" });
    return;
  }

  if (!acceptedTerms) {
    res.status(400).json({ error: "Must accept terms to create account" });
    return;
  }

  try {
    // Check if user already exists (edge case: user created between callback and onboarding)
    const existingUser = await prisma.user.findUnique({
      where: { email: onboardingData.email },
    });

    if (existingUser) {
      res.status(409).json({ 
        error: "User already exists",
        message: "En bruker med denne e-postadressen finnes allerede. Prøv å logge inn på nytt.",
      });
      return;
    }

    // Create user and accounting connection in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email: onboardingData.email,
          name: onboardingData.name,
          activeProvider: onboardingData.provider,
          acceptedTermsAt: new Date(),
        },
      });

      // Calculate token expiry
      const expiresAt = new Date(Date.now() + onboardingData.expiresIn * 1000);

      // Create accounting connection with company info
      await tx.accountingConnection.create({
        data: {
          userId: user.id,
          provider: onboardingData.provider,
          accessToken: onboardingData.accessToken,
          refreshToken: onboardingData.refreshToken,
          expiresAt,
          companyId,
          companyName,
          organizationNumber,
        },
      });

      return user;
    });

    // Return session token and user info
    res.json({
      success: true,
      sessionToken: result.id,
      user: {
        id: result.id,
        email: result.email,
        name: result.name,
        activeProvider: result.activeProvider,
        acceptedTermsAt: result.acceptedTermsAt,
        company: {
          slug: companyId,
          id: companyId,
          name: companyName,
          organizationNumber,
        },
        subscription: {
          status: "none",
          started: null,
          ends: null,
          isActive: false,
        },
      },
    });
  } catch (error) {
    console.error("Complete onboarding error:", error);
    res.status(500).json({
      error: "Failed to complete onboarding",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ==================== SELECT COMPANY ====================

/**
 * POST /api/auth/select-company
 * Select which company to use (for existing users)
 */
router.post("/select-company", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = authHeader.split(" ")[1];
  const { companySlug, companyId, companyName, organizationNumber, provider, acceptedTerms } =
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

    // Update company selection
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

    // If user accepted terms, update acceptedTermsAt
    if (acceptedTerms === true) {
      await prisma.user.update({
        where: { id: userId },
        data: { acceptedTermsAt: new Date() },
      });
    }

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
