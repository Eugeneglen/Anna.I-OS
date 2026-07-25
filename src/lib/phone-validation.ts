// ============================================================
// Singapore Phone Validation Utility
// Accepts various formats, normalizes to +65XXXXXXXX (8 digits)
// ============================================================

/**
 * Regex for raw 8-digit Singapore mobile number (digits only).
 */
export const SG_PHONE_REGEX = /^\d{8}$/;

/**
 * Validates and normalizes a Singapore mobile phone number.
 *
 * Accepts input with or without:
 * - `+65` prefix
 * - Spaces, dashes, dots, or parentheses
 *
 * Returns an object with:
 * - `valid`: whether the phone is a valid SG mobile number
 * - `normalized`: the canonical `+65XXXXXXXX` format (only when valid)
 * - `error`: human-readable error message (only when invalid)
 */
export function validateSgPhone(
  input: string
): { valid: boolean; normalized?: string; error?: string } {
  if (!input || typeof input !== "string") {
    return { valid: false, error: "Phone number is required" };
  }

  // Strip all non-digit characters except leading +
  const cleaned = input.replace(/[\s\-\.\(\)]/g, "");

  // If it starts with +, keep it; otherwise prepend nothing
  let digits: string;

  if (cleaned.startsWith("+65")) {
    digits = cleaned.slice(3);
  } else if (cleaned.startsWith("65") && cleaned.length >= 10) {
    // Handle "65XXXXXXXX" without + prefix
    digits = cleaned.slice(2);
  } else {
    digits = cleaned;
  }

  // Must be exactly 8 digits
  if (!SG_PHONE_REGEX.test(digits)) {
    return {
      valid: false,
      error:
        "Invalid Singapore phone number. Must be 8 digits (e.g. 91234567 or +65 9123 4567)",
    };
  }

  // SG mobile numbers start with 8 or 9
  const firstDigit = digits[0];
  if (firstDigit !== "8" && firstDigit !== "9") {
    return {
      valid: false,
      error:
        "Invalid Singapore mobile number. Must start with 8 or 9 (e.g. 91234567)",
    };
  }

  return { valid: true, normalized: `+65${digits}` };
}
