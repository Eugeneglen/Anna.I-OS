import { timingSafeEqual } from "crypto";

/**
 * Cron-service authentication helper (FIX-1a).
 * ============================================
 *
 * Mirrors the established convention in
 * src/app/api/ops/marketing/dispatch-expiry/route.ts:
 *   - header `x-cron-secret` only (no query-param fallback — secrets in
 *     URLs leak via logs/referrers)
 *   - timing-safe comparison
 *   - PROD with unset CRON_SECRET → the cron path is CLOSED (401 always);
 *     the dev fallback secret exists only outside production.
 *
 * Shared by the routes that accept "ops session OR internal cron service":
 *   - POST /api/anomalies/check
 *   - POST /api/quote/cleanup
 */

const DEV_FALLBACK_SECRET = "anna-cron-dev-secret";

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still do a comparison to keep timing roughly constant.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function resolveSecret(): string | null {
  const s = process.env.CRON_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[cron-auth] CRON_SECRET is not set — cron-authenticated endpoints are CLOSED (401) until it is configured."
    );
    return null;
  }
  console.warn(
    "[cron-auth] CRON_SECRET not set — using dev fallback secret. Do NOT ship this to production."
  );
  return DEV_FALLBACK_SECRET;
}

/**
 * Returns true when the request carries a valid `x-cron-secret` header.
 * Always false in production when CRON_SECRET is unset.
 */
export function isCronRequest(headers: Headers): boolean {
  const expected = resolveSecret();
  const provided = headers.get("x-cron-secret") ?? "";
  if (!expected || !provided) return false;
  return secretsMatch(provided, expected);
}
