/**
 * Tripletex Authentication
 * Handles session token management for Tripletex API
 *
 * Tripletex bruker Consumer Token + Employee Token → Session Token
 * Session token utløper på en spesifikk dato (ikke etter X sekunder)
 */

import { prisma } from "../db.js";

const TRIPLETEX_API_URL =
  process.env.TRIPLETEX_API_URL || "https://api.tripletex.io/v2";

interface SessionTokenResponse {
  value: {
    id: number;
    token: string;
    expirationDate: string;
  };
}

interface WhoAmIResponse {
  value: {
    employee: {
      id: number;
      firstName: string;
      lastName: string;
      email: string;
    };
    company: {
      id: number;
      name: string;
      organizationNumber: string;
    };
  };
}

/**
 * Check if Tripletex is configured
 */
export function isTripletexConfigured(): boolean {
  return !!process.env.TRIPLETEX_CONSUMER_TOKEN;
}

/**
 * Create a new session token using consumer token and employee token
 *
 * PUT /token/session/:create
 */
export async function createSessionToken(
  employeeToken: string,
  expirationDate?: string
): Promise<{ sessionToken: string; expiresAt: Date }> {
  const consumerToken = process.env.TRIPLETEX_CONSUMER_TOKEN;

  if (!consumerToken) {
    throw new Error("TRIPLETEX_CONSUMER_TOKEN is not configured");
  }

  // Default: utløper om 30 dager
  const expDate =
    expirationDate ||
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const params = new URLSearchParams({
    consumerToken,
    employeeToken,
    expirationDate: expDate,
  });

  const response = await fetch(
    `${TRIPLETEX_API_URL}/token/session/:create?${params.toString()}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create session token: ${error}`);
  }

  const data: SessionTokenResponse = await response.json();

  return {
    sessionToken: data.value.token,
    expiresAt: new Date(data.value.expirationDate),
  };
}

/**
 * Validate session token and get user/company info
 *
 * GET /token/session/>whoAmI
 */
export async function validateSessionToken(
  sessionToken: string,
  companyId: number
): Promise<WhoAmIResponse["value"]> {
  const authHeader = `Basic ${Buffer.from(`${companyId}:${sessionToken}`).toString("base64")}`;

  const response = await fetch(`${TRIPLETEX_API_URL}/token/session/%3EwhoAmI`, {
    headers: {
      Authorization: authHeader,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to validate session token: ${error}`);
  }

  const data: WhoAmIResponse = await response.json();
  return data.value;
}

/**
 * Get a valid session token for a user, creating new if expired
 */
export async function getValidSessionToken(
  userId: string
): Promise<string | null> {
  const connection = await prisma.accountingConnection.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: "tripletex",
      },
    },
  });

  if (!connection) {
    return null;
  }

  // Check if token is expired (with 1 day buffer)
  const now = new Date();
  const expiresAt = new Date(connection.expiresAt);
  const bufferMs = 24 * 60 * 60 * 1000; // 1 day

  if (now.getTime() + bufferMs >= expiresAt.getTime()) {
    // Token is expired or about to expire, create new session
    if (!connection.employeeToken) {
      console.error("No employee token stored, cannot refresh session");
      return null;
    }

    try {
      const { sessionToken, expiresAt: newExpiresAt } = await createSessionToken(
        connection.employeeToken
      );

      // Update token in database
      await prisma.accountingConnection.update({
        where: {
          userId_provider: {
            userId,
            provider: "tripletex",
          },
        },
        data: {
          accessToken: sessionToken,
          expiresAt: newExpiresAt,
        },
      });

      return sessionToken;
    } catch (error) {
      console.error("Failed to refresh Tripletex session:", error);
      return null;
    }
  }

  return connection.accessToken;
}

/**
 * Save Tripletex tokens for a user
 */
export async function saveTripletexTokens(
  userId: string,
  sessionToken: string,
  employeeToken: string,
  expiresAt: Date,
  companyId?: string,
  companyName?: string,
  organizationNumber?: string
): Promise<void> {
  await prisma.accountingConnection.upsert({
    where: {
      userId_provider: {
        userId,
        provider: "tripletex",
      },
    },
    create: {
      userId,
      provider: "tripletex",
      accessToken: sessionToken,
      employeeToken,
      expiresAt,
      companyId,
      companyName,
      organizationNumber,
    },
    update: {
      accessToken: sessionToken,
      employeeToken,
      expiresAt,
      companyId: companyId ?? undefined,
      companyName: companyName ?? undefined,
      organizationNumber: organizationNumber ?? undefined,
    },
  });

  // Set as active provider
  await prisma.user.update({
    where: { id: userId },
    data: { activeProvider: "tripletex" },
  });
}

/**
 * Get user's selected company ID for Tripletex
 */
export async function getUserCompanyId(userId: string): Promise<string | null> {
  const connection = await prisma.accountingConnection.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: "tripletex",
      },
    },
    select: { companyId: true },
  });

  return connection?.companyId || null;
}

/**
 * Update user's selected Tripletex company
 */
export async function setUserCompany(
  userId: string,
  companyId: string,
  companyName: string,
  organizationNumber?: string
): Promise<void> {
  await prisma.accountingConnection.update({
    where: {
      userId_provider: {
        userId,
        provider: "tripletex",
      },
    },
    data: { companyId, companyName, organizationNumber },
  });
}
