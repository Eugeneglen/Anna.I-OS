// ============================================================
// Anna.I — socket auth fallback helpers (FIX-1b)
// Shared by the useHouseholdEvents / useVendorEvents / useOpsEvents
// hooks. The ops-events service now REJECTS unauthenticated websocket
// handshakes; these helpers implement the graceful fallback:
//   1. connect with the portal session cookie (sent automatically,
//      same-origin through the Caddy gateway), then
//   2. on an auth rejection, fetch a short-lived token from
//      /api/events/token and reconnect with it, then
//   3. if that also fails, degrade silently (log once — the app keeps
//      working, it just loses realtime updates).
// ============================================================

"use client";

/**
 * The service's handshake middleware rejects unauthenticated
 * connections with `next(new Error("unauthorized: ..."))`. Socket.io
 * does NOT auto-reconnect after a middleware rejection, so detecting
 * this case lets us react exactly once instead of spamming retries.
 */
export function isAuthRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.toLowerCase().includes("unauthorized");
}

interface EventTokenResponse {
  token?: string;
  role?: string;
  expiresInSec?: number;
}

/**
 * Fetch a short-lived realtime event token from GET /api/events/token.
 * Same-origin fetch — the portal session cookie (or vendor Authorization
 * header flow, where applicable) authenticates the request. Returns null
 * on any failure so callers can degrade silently.
 */
export async function fetchEventToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/events/token", { credentials: "same-origin" });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as EventTokenResponse | null;
    if (typeof data?.token === "string" && data.token.length > 0) {
      return data.token;
    }
    return null;
  } catch {
    return null;
  }
}
