/**
 * In-memory rate limiter
 * ======================
 * A simple, dependency-free rate limiter used to throttle abuse-prone
 * marketing endpoints (campaign create / redeem / segment create /
 * behaviour insights). Each unique `key` (typically an ops user id or
 * remote IP) gets its own sliding counter.
 *
 * Choice: fixed-window counter keyed by (key, windowMs). Cheap (O(1) per
 * check), bounded memory (entries auto-cleaned when their window expires).
 *
 * Limitations:
 *   - Per-process (Node.js single replica). Acceptable for the OPS app
 *     because there's exactly one Next.js server. For multi-replica
 *     deployments, swap this for a Redis token bucket — the call site
 *     signature stays the same.
 *   - Resets at the boundary, so a brief double-burst around the boundary
 *     can briefly reach 2× limit. Acceptable for marketing endpoints.
 */

interface RateBucket {
  count: number;
  resetAt: number; // epoch ms
}

// Keyed by `key`. Never grows unbounded — buckets are pruned when they
// expire, and stale buckets are also lazily evicted on each check.
const buckets = new Map<string, RateBucket>();

// Lazy-start a periodic sweep so memory stays bounded when traffic drops
// to zero (in which case no check ever runs to lazily evict). The sweep
// fires every 60s and removes any bucket whose resetAt has passed.
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function ensureSweep(): void {
  if (sweepTimer) return;
  // Avoid ever creating more than one interval across hot reloads /
  // multiple module evaluations — Node.js timers persist across requests.
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }, 60_000);
  // Don't keep the event loop alive solely for the sweep — the API
  // request itself is what keeps the process up.
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}

/**
 * Returns the number of seconds remaining until the caller's current
 * window resets (so we can surface a friendly "try again in X seconds"
 * message on HTTP 429). Returns 0 if the window has already reset.
 */
export function secondsUntilReset(key: string): number {
  const b = buckets.get(key);
  if (!b) return 0;
  const remaining = Math.ceil((b.resetAt - Date.now()) / 1000);
  return Math.max(0, remaining);
}

/**
 * Check whether a request is allowed under the configured limit.
 *
 * @param key       Identifier for the caller (e.g. `ops:${userId}` or IP).
 *                  Must be non-empty.
 * @param limit     Maximum number of requests allowed within the window.
 * @param windowMs  Window size in milliseconds.
 * @returns `true` if the request is allowed (and counted); `false` if
 *          the caller has exceeded the limit (in which case this request
 *          is NOT counted — so the caller can keep retrying without
 *          further penalising themselves once the window resets).
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  if (!key) {
    // Defensive: callers should always pass a key. Fall back to a
    // permissive "allow" rather than accidentally rate-limiting every
    // request together under an empty-string key.
    return true;
  }
  ensureSweep();
  const now = Date.now();

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    // First request in a fresh window.
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (existing.count >= limit) {
    // Exceeded — do NOT increment; let the window expire naturally.
    return false;
  }

  existing.count += 1;
  return true;
}

// ── Convenience helpers ──
//
// Pre-defined per-endpoint limits so call sites stay declarative and
// the constants live next to the limiter itself.

export const RATE_LIMITS = {
  campaignCreate: { limit: 10, windowMs: 60_000 }, // 10 / minute / ops user
  campaignRedeem: { limit: 20, windowMs: 60_000 }, // 20 / minute / ops user
  segmentCreate: { limit: 10, windowMs: 60_000 }, // 10 / minute
  behaviourInsights: { limit: 30, windowMs: 60_000 }, // 30 / minute
} as const;

/** Build a stable rate-limit key from the ops session. */
export function opsRateKey(userId: string | undefined, endpoint: string): string {
  return `ops:${userId ?? "anon"}:${endpoint}`;
}

/**
 * Format the "Rate limit exceeded. Try again in X seconds." payload the
 * API returns alongside HTTP 429. Kept here so the wording stays
 * consistent across every protected endpoint.
 */
export function rateLimitResponsePayload(key: string): { error: string } {
  const secs = secondsUntilReset(key);
  return {
    error: `Rate limit exceeded. Try again in ${secs} second${secs === 1 ? "" : "s"}.`,
  };
}
