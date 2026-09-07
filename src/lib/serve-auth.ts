import { createHmac, timingSafeEqual } from "crypto";
import { getHouseholdSession } from "@/lib/household-auth";
import { getOpsSession } from "@/lib/ops-auth";
import { getVendorSession } from "@/lib/vendor-auth";
import { resolveSecret } from "@/lib/secrets";

/**
 * Signed access tokens for GET /api/serve (FIX-1a item 3).
 * =====================================================
 *
 * /api/serve previously served ANY file to ANYONE who knew (or brute-forced)
 * its random-hex URL. It now requires either:
 *
 *   (a) a valid household / vendor / ops session cookie — covers every
 *       authenticated portal page (browser sends cookies on <img> tags),
 *       OR
 *   (b) a short-TTL HMAC-signed token in the `t` query param, covering the
 *       exact requested file path — used by PUBLIC surfaces (the /j/[token]
 *       job-share page) and by server-side consumers (the VLM photo
 *       analyzer) that have no session cookie.
 *
 * The HMAC key is derived from OPS_JWT_SECRET (an existing secret — one
 * fewer key to rotate). Tokens are `expiryEpochMs.base64url(hmac)` and the
 * signature covers `<path>|<expiry>` so a token for one file cannot be
 * replayed against another.
 */

const DEV_FALLBACK_KEY = "anna-serve-dev-secret";

function hmacKey(): Buffer {
  return Buffer.from(
    resolveSecret("OPS_JWT_SECRET", DEV_FALLBACK_KEY, {
      owner: "serve-auth (signed file URLs)",
    }),
    "utf8"
  );
}

/** Sign an access token for `path` valid for `ttlSeconds`. */
export function signServeToken(path: string, ttlSeconds: number): string {
  const exp = Date.now() + ttlSeconds * 1000;
  const payload = `${path}|${exp}`;
  const sig = createHmac("sha256", hmacKey()).update(payload).digest("base64url");
  return `${exp}.${sig}`;
}

/** Timing-safe verification of a token for `path`. */
export function verifyServeToken(path: string, token: string): boolean {
  const dotIndex = token.indexOf(".");
  if (dotIndex <= 0) return false;
  const expStr = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now()) return false;

  const expected = createHmac("sha256", hmacKey())
    .update(`${path}|${expStr}`)
    .digest("base64url");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Append a signed `t` param to a stored `/api/serve/...` URL so it can be
 * fetched without a session. Non-serve URLs (static assets, external URLs)
 * pass through unchanged. Null/undefined maps to undefined.
 */
export function signServeUrl(url: string, ttlSeconds: number): string;
export function signServeUrl(
  url: string | null | undefined,
  ttlSeconds: number
): string | undefined;
export function signServeUrl(
  url: string | null | undefined,
  ttlSeconds: number
): string | undefined {
  if (typeof url !== "string" || !url.startsWith("/api/serve/")) {
    return url ?? undefined;
  }
  const token = signServeToken(url, ttlSeconds);
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}t=${encodeURIComponent(token)}`;
}

/** True when any of the three portal sessions is present. */
export async function hasServeSession(): Promise<boolean> {
  const household = await getHouseholdSession().catch(() => null);
  if (household) return true;
  const vendor = await getVendorSession().catch(() => null);
  if (vendor) return true;
  const ops = await getOpsSession().catch(() => null);
  return !!ops;
}
