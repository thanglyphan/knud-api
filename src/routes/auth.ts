/**
 * Authentication routes for Fiken OAuth2
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
  getValidAccessToken,
  isFikenConfigured,
} from "../fiken/auth.js";

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
      },
      update: {
        name: userInfo.name,
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
      select: {
        id: true,
        email: true,
        name: true,
        subscriptionStatus: true,
        subscriptionStarted: true,
        subscriptionEnds: true,
        fikenToken: {
          select: {
            companySlug: true,
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

    // Check if Fiken token is still valid
    const hasValidToken = user.fikenToken && new Date(user.fikenToken.expiresAt) > new Date();

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
        fikenConnected: !!user.fikenToken,
        fikenTokenValid: hasValidToken,
        company: user.fikenToken
          ? {
              slug: user.fikenToken.companySlug,
              name: user.fikenToken.companyName,
              organizationNumber: user.fikenToken.organizationNumber,
            }
          : null,
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

/**
 * POST /api/auth/logout
 * Logout user and revoke Fiken tokens
 */
router.post("/logout", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = authHeader.split(" ")[1];

  try {
    // Get access token to revoke
    const accessToken = await getValidAccessToken(userId);
    
    if (accessToken) {
      // Revoke Fiken token
      try {
        await revokeToken(accessToken);
      } catch (e) {
        console.error("Failed to revoke Fiken token:", e);
      }
    }

    // Delete Fiken token from database
    await prisma.fikenToken.deleteMany({
      where: { userId },
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Failed to logout" });
  }
});

/**
 * GET /api/auth/companies
 * Get list of companies the user has access to in Fiken
 */
router.get("/companies", async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const userId = authHeader.split(" ")[1];

  try {
    const accessToken = await getValidAccessToken(userId);
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
      companies: companies.map((c: any) => ({
        slug: c.slug,
        name: c.name,
        organizationNumber: c.organizationNumber,
      })),
    });
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
  const { companySlug, companyName, organizationNumber } = req.body;

  if (!companySlug) {
    res.status(400).json({ error: "Company slug is required" });
    return;
  }

  try {
    await prisma.fikenToken.update({
      where: { userId },
      data: { companySlug, companyName, organizationNumber },
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Select company error:", error);
    res.status(500).json({ error: "Failed to select company" });
  }
});

export default router;
