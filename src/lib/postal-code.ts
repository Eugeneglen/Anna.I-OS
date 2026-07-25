// ============================================================
// Singapore Postal Code Validation Utility
// Singapore postal codes are exactly 6 digits
// ============================================================

/**
 * Regex for a valid 6-digit Singapore postal code.
 */
export const SG_POSTAL_CODE_REGEX = /^\d{6}$/;

/**
 * Checks whether the given string is a valid Singapore postal code.
 * Accepts input with or without spaces.
 */
export function isValidPostalCode(code: string): boolean {
  if (!code || typeof code !== "string") return false;
  const stripped = code.replace(/\s/g, "");
  return SG_POSTAL_CODE_REGEX.test(stripped);
}

/**
 * Normalizes a postal code by stripping spaces.
 * Returns the 6-digit string if valid, or the stripped version.
 * Does NOT validate — use `isValidPostalCode()` first if validation is needed.
 */
export function normalizePostalCode(code: string): string {
  if (!code || typeof code !== "string") return "";
  return code.replace(/\s/g, "");
}
