import crypto from "crypto";

/**
 * Generates a secure random onboarding token
 * @returns string - A URL-safe random token
 */
export function generateOnboardingToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Gets the expiry date for onboarding token (7 days from now)
 * @returns Date - Expiry date
 */
export function getOnboardingTokenExpiry(): Date {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 7); // Token valid for 7 days
  return expiry;
}
