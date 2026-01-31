/**
 * Fiken OAuth2 Authentication
 * Handles the OAuth2 flow for Fiken API
 *
 * Oppdatert til å bruke AccountingConnection-modellen
 */

import { prisma } from "../db.js";

const FIKEN_AUTH_URL = "https://fiken.no/oauth/authorize";
const FIKEN_TOKEN_URL = "https://fiken.no/oauth/token";
const FIKEN_REVOKE_URL = "https://fiken.no/oauth/revoke";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

interface FikenUserInfo {
  name: string;
  email: string;
}

/**
 * Check if Fiken OAuth2 is configured
 */
export function isFikenConfigured(): boolean {
  return !!(
    process.env.FIKEN_CLIENT_ID &&
    process.env.FIKEN_CLIENT_SECRET &&
    process.env.FIKEN_REDIRECT_URI
  );
}

/**
 * Generate the Fiken OAuth2 authorization URL
 */
export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.FIKEN_CLIENT_ID!,
    redirect_uri: process.env.FIKEN_REDIRECT_URI!,
    state,
  });

  return `${FIKEN_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  code: string,
  state: string
): Promise<TokenResponse> {
  const credentials = Buffer.from(
    `${process.env.FIKEN_CLIENT_ID}:${process.env.FIKEN_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(FIKEN_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.FIKEN_REDIRECT_URI!,
      state,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error_description || "Failed to exchange code for tokens");
  }

  return response.json();
}

/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const credentials = Buffer.from(
    `${process.env.FIKEN_CLIENT_ID}:${process.env.FIKEN_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(FIKEN_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error_description || "Failed to refresh token");
  }

  return response.json();
}

/**
 * Revoke tokens (logout)
 */
export async function revokeToken(accessToken: string): Promise<void> {
  await fetch(FIKEN_REVOKE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

/**
 * Get user info from Fiken API
 */
export async function getFikenUserInfo(accessToken: string): Promise<FikenUserInfo> {
  const response = await fetch("https://api.fiken.no/api/v2/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to get user info from Fiken");
  }

  const data = await response.json();
  return {
    name: data.name || "",
    email: data.email || "",
  };
}

/**
 * Get a valid access token for a user, refreshing if necessary
 */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const connection = await prisma.accountingConnection.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: "fiken",
      },
    },
  });

  if (!connection) {
    return null;
  }

  // Check if token is expired (with 5 minute buffer)
  const now = new Date();
  const expiresAt = new Date(connection.expiresAt);
  const bufferMs = 5 * 60 * 1000; // 5 minutes

  if (now.getTime() + bufferMs >= expiresAt.getTime()) {
    // Token is expired or about to expire, refresh it
    if (!connection.refreshToken) {
      console.error("No refresh token stored for Fiken");
      return null;
    }

    try {
      const newTokens = await refreshAccessToken(connection.refreshToken);

      // Update tokens in database
      await prisma.accountingConnection.update({
        where: {
          userId_provider: {
            userId,
            provider: "fiken",
          },
        },
        data: {
          accessToken: newTokens.access_token,
          refreshToken: newTokens.refresh_token,
          expiresAt: new Date(Date.now() + newTokens.expires_in * 1000),
        },
      });

      return newTokens.access_token;
    } catch (error) {
      console.error("Failed to refresh Fiken token:", error);
      // Delete invalid connection
      await prisma.accountingConnection.delete({
        where: {
          userId_provider: {
            userId,
            provider: "fiken",
          },
        },
      });
      return null;
    }
  }

  return connection.accessToken;
}

/**
 * Save or update Fiken tokens for a user
 */
export async function saveFikenTokens(
  userId: string,
  tokens: TokenResponse,
  companySlug?: string,
  companyName?: string,
  organizationNumber?: string
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await prisma.accountingConnection.upsert({
    where: {
      userId_provider: {
        userId,
        provider: "fiken",
      },
    },
    create: {
      userId,
      provider: "fiken",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      companyId: companySlug,
      companyName,
      organizationNumber,
    },
    update: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt,
      companyId: companySlug ?? undefined,
      companyName: companyName ?? undefined,
      organizationNumber: organizationNumber ?? undefined,
    },
  });

  // Set Fiken as active provider
  await prisma.user.update({
    where: { id: userId },
    data: { activeProvider: "fiken" },
  });
}

/**
 * Get user's selected company slug
 */
export async function getUserCompanySlug(userId: string): Promise<string | null> {
  const connection = await prisma.accountingConnection.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: "fiken",
      },
    },
    select: { companyId: true },
  });

  return connection?.companyId || null;
}

/**
 * Update user's selected company
 */
export async function setUserCompany(
  userId: string,
  companySlug: string,
  companyName: string,
  organizationNumber?: string
): Promise<void> {
  await prisma.accountingConnection.update({
    where: {
      userId_provider: {
        userId,
        provider: "fiken",
      },
    },
    data: { companyId: companySlug, companyName, organizationNumber },
  });
}

/**
 * Get Fiken connection for a user
 */
export async function getFikenConnection(userId: string) {
  return prisma.accountingConnection.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: "fiken",
      },
    },
  });
}

/**
 * Delete Fiken connection for a user
 */
export async function deleteFikenConnection(userId: string): Promise<void> {
  await prisma.accountingConnection.deleteMany({
    where: {
      userId,
      provider: "fiken",
    },
  });
}
