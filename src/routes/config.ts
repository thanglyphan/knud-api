/**
 * Configuration routes
 * Provides feature flags and app configuration to the frontend
 */

import { Router } from "express";

const router = Router();

/**
 * Check if Tripletex is enabled
 */
export function isTripletexEnabled(): boolean {
  return process.env.TRIPLETEX_ENABLED === "true";
}

/**
 * Check if Tripletex is configured (has required env vars)
 */
export function isTripletexConfigured(): boolean {
  return !!(
    process.env.TRIPLETEX_CONSUMER_TOKEN &&
    process.env.TRIPLETEX_API_URL
  );
}

/**
 * GET /api/config
 * Returns app configuration and feature flags
 */
router.get("/", (_req, res) => {
  res.json({
    features: {
      tripletexEnabled: isTripletexEnabled() && isTripletexConfigured(),
    },
    // Add more config options here as needed
  });
});

export default router;
