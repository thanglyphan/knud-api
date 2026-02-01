/**
 * Authentication middleware
 * Updated to support multiple accounting providers
 */

import { Request, Response, NextFunction } from "express";
import { prisma } from "../db.js";
import { getValidAccessToken as getFikenAccessToken } from "../fiken/auth.js";

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      user?: {
        id: string;
        email: string;
        name: string | null;
        activeProvider?: string | null;
      };
      // Legacy Fiken fields (for backward compatibility)
      fikenAccessToken?: string;
      companySlug?: string;
      // Provider-agnostic fields
      accountingProvider?: string;
      accountingAccessToken?: string;
      companyId?: string;
    }
  }
}

/**
 * Middleware to verify user authentication
 * Extracts user ID from Bearer token and validates
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
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
          },
        },
      },
    });

    if (!user) {
      res.status(401).json({ error: "Invalid authentication token" });
      return;
    }

    // Find active connection
    const activeConnection = user.accountingConnections.find(
      (c) => c.provider === user.activeProvider
    );

    req.userId = user.id;
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      activeProvider: user.activeProvider,
    };
    req.accountingProvider = user.activeProvider || undefined;
    req.companyId = activeConnection?.companyId || undefined;
    // Legacy support
    req.companySlug = activeConnection?.companyId || undefined;

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(500).json({ error: "Authentication failed" });
  }
}

/**
 * Middleware to require valid accounting connection
 * Works with both Fiken and Tripletex
 */
export async function requireAccountingConnection(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const provider = req.accountingProvider;

  if (!provider) {
    res.status(401).json({
      error: "No accounting system connected",
      code: "NO_PROVIDER_CONNECTED",
    });
    return;
  }

  try {
    let accessToken: string | null = null;

    if (provider === "fiken") {
      accessToken = await getFikenAccessToken(req.userId);
    } else if (provider === "tripletex") {
      // Tripletex kommer snart - ikke tilgjengelig ennå
      res.status(501).json({
        error: "Tripletex-integrasjon er ikke tilgjengelig ennå",
        message: "Kommer snart!",
      });
      return;
    }

    if (!accessToken) {
      res.status(401).json({
        error: `${provider} connection expired or invalid`,
        code: "CONNECTION_EXPIRED",
      });
      return;
    }

    // Check if company is selected
    const connection = await prisma.accountingConnection.findUnique({
      where: {
        userId_provider: {
          userId: req.userId,
          provider,
        },
      },
      select: { companyId: true },
    });

    if (!connection?.companyId) {
      res.status(400).json({
        error: "No company selected",
        code: "NO_COMPANY_SELECTED",
      });
      return;
    }

    req.accountingAccessToken = accessToken;
    req.companyId = connection.companyId;
    // Legacy support for Fiken
    req.fikenAccessToken = provider === "fiken" ? accessToken : undefined;
    req.companySlug = provider === "fiken" ? connection.companyId : undefined;

    console.log(`[Auth] Provider: ${provider}, CompanyId: ${connection.companyId}, Token: ${accessToken?.substring(0, 15)}...`);

    next();
  } catch (error) {
    console.error("Accounting connection middleware error:", error);
    res.status(500).json({ error: "Failed to verify accounting connection" });
  }
}

/**
 * Legacy middleware - redirects to new middleware
 * @deprecated Use requireAccountingConnection instead
 */
export async function requireFikenConnection(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Force Fiken provider for legacy endpoints
  if (req.accountingProvider !== "fiken") {
    res.status(400).json({
      error: "This endpoint requires Fiken connection",
      code: "FIKEN_REQUIRED",
    });
    return;
  }

  return requireAccountingConnection(req, res, next);
}

/**
 * Optional auth - doesn't fail if not authenticated
 */
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    next();
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
          },
        },
      },
    });

    if (user) {
      const activeConnection = user.accountingConnections.find(
        (c) => c.provider === user.activeProvider
      );

      req.userId = user.id;
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        activeProvider: user.activeProvider,
      };
      req.accountingProvider = user.activeProvider || undefined;
      req.companyId = activeConnection?.companyId || undefined;
      req.companySlug = activeConnection?.companyId || undefined;
    }
  } catch (error) {
    // Ignore errors in optional auth
    console.error("Optional auth error (ignored):", error);
  }

  next();
}
