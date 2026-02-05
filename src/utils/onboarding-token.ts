import jwt from "jsonwebtoken";

/**
 * Onboarding Token Utility
 *
 * Used to temporarily store OAuth tokens for new users before they complete
 * the onboarding process (company selection). The token is a signed JWT that
 * expires after 30 minutes.
 */

export interface OnboardingData {
  provider: "fiken" | "tripletex";
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  email: string;
  name: string | null;
}

// Use a dedicated secret for onboarding tokens, fallback to a default for dev
const ONBOARDING_JWT_SECRET =
  process.env.ONBOARDING_JWT_SECRET || "knud-onboarding-secret-change-in-production";

// Token expires in 30 minutes
const TOKEN_EXPIRY = "30m";

/**
 * Create a signed JWT containing the onboarding data
 */
export function createOnboardingToken(data: OnboardingData): string {
  return jwt.sign(
    {
      provider: data.provider,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
      email: data.email,
      name: data.name,
    },
    ONBOARDING_JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

/**
 * Verify and decode an onboarding token
 * Returns null if the token is invalid or expired
 */
export function verifyOnboardingToken(token: string): OnboardingData | null {
  try {
    const decoded = jwt.verify(token, ONBOARDING_JWT_SECRET) as OnboardingData & {
      iat: number;
      exp: number;
    };

    return {
      provider: decoded.provider,
      accessToken: decoded.accessToken,
      refreshToken: decoded.refreshToken,
      expiresIn: decoded.expiresIn,
      email: decoded.email,
      name: decoded.name,
    };
  } catch (error) {
    // Token is invalid or expired
    return null;
  }
}
