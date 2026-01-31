/**
 * Authentication middleware
 */

import { Request, Response, NextFunction } from "express";
import { prisma } from "../db.js";
import { getValidAccessToken } from "../fiken/auth.js";

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      userId?: string;
      user?: {
        id: string;
        email: string;
        name: string | null;
      };
      fikenAccessToken?: string;
      companySlug?: string;
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
        fikenToken: {
          select: {
            companySlug: true,
          },
        },
      },
    });

    if (!user) {
      res.status(401).json({ error: "Invalid authentication token" });
      return;
    }

    req.userId = user.id;
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
    };
    req.companySlug = user.fikenToken?.companySlug || undefined;

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(500).json({ error: "Authentication failed" });
  }
}

/**
 * Middleware to require valid Fiken connection
 * Also fetches and validates access token
 */
export async function requireFikenConnection(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const accessToken = await getValidAccessToken(req.userId);

    if (!accessToken) {
      res.status(401).json({ 
        error: "Fiken connection required",
        code: "FIKEN_NOT_CONNECTED"
      });
      return;
    }

    // Check if company is selected
    const token = await prisma.fikenToken.findUnique({
      where: { userId: req.userId },
      select: { companySlug: true },
    });

    if (!token?.companySlug) {
      res.status(400).json({ 
        error: "No company selected",
        code: "NO_COMPANY_SELECTED"
      });
      return;
    }

    req.fikenAccessToken = accessToken;
    req.companySlug = token.companySlug;

    next();
  } catch (error) {
    console.error("Fiken connection middleware error:", error);
    res.status(500).json({ error: "Failed to verify Fiken connection" });
  }
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
        fikenToken: {
          select: {
            companySlug: true,
          },
        },
      },
    });

    if (user) {
      req.userId = user.id;
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
      };
      req.companySlug = user.fikenToken?.companySlug || undefined;
    }
  } catch (error) {
    // Ignore errors in optional auth
    console.error("Optional auth error (ignored):", error);
  }

  next();
}
