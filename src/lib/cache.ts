/**
 * In-Memory Cache
 * ===============
 * Simple per-process, in-memory cache with TTL support.
 *
 * Why in-memory (not Redis)?
 *   - The dev sandbox runs a single Next.js server process — an
 *     in-process Map is sufficient for the marketing module's read-heavy
 *     analytics. Adding Redis would introduce an extra dependency, more
 *     moving parts, and the same cache invalidation challenges.
 *   - This layer is intentionally narrow: it caches the output of a few
 *     expensive Prisma aggregates (behaviour analytics, campaign
 *     performance) and is invalidated on every related write.
 *
 * Public API:
 *   - `get<T>(key)`            → cached value or null (expired entries return null)
 *   - `set<T>(key, value, ttl)`→ store value with a TTL in ms
 *   - `invalidate(key)`        → drop a single entry
 *   - `invalidatePattern(prefix)` → drop every entry whose key starts with `prefix`
 *   - `size()`                → number of live entries (testing / debugging)
 *   - `clear()`               → drop everything (testing / debugging)
 *
 * The Map stores `{ value, expiresAt }`. Expired entries are lazy-evicted
 * on read and proactively swept every 60s by a setInterval. The sweep
 * protects against long-tail keys that are written once and never read
 * again (so the Map doesn't grow unbounded over a multi-day uptime).
 */

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();
const SWEEP_INTERVAL_MS = 60_000;

// ── Sweep: drop expired entries every 60s ──
//
// `setInterval` keeps a Node.js event loop alive — fine here because the
// Next.js dev server / standalone server is long-running. The sweep is
// also defensive: lazy eviction on `get` already handles expired keys,
// but periodic sweeps prevent the Map from retaining dead entries whose
// keys are never queried again.
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt <= now) {
        store.delete(key);
      }
    }
  }, SWEEP_INTERVAL_MS).unref?.(); // .unref() so the timer doesn't keep the process alive in tests
}

/** Read a cached value. Returns null if absent or expired. */
export function get<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    // Lazy eviction — expired entries are dropped on read.
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

/** Store a value with a TTL (in milliseconds). */
export function set<T>(key: string, value: T, ttlMs: number): void {
  // Guard against negative / NaN TTLs — treat them as "expire immediately".
  const safeTtl = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 0;
  store.set(key, { value, expiresAt: Date.now() + safeTtl });
  // If ttl was 0/negative, the entry is already expired — drop it so a
  // subsequent `get` returns null instead of serving a stale value.
  if (safeTtl <= 0) store.delete(key);
}

/** Drop a single cached entry. No-op if the key doesn't exist. */
export function invalidate(key: string): void {
  store.delete(key);
}

/** Drop every cached entry whose key starts with `prefix`. */
export function invalidatePattern(prefix: string): void {
  if (!prefix) return;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

/** Number of live entries (testing / debugging). Includes not-yet-swept
 * expired entries — for an accurate live count, callers should rely on
 * `get` returning null for expired entries. */
export function size(): number {
  return store.size;
}

/** Drop every cached entry (testing / debugging). */
export function clear(): void {
  store.clear();
}

// ── Marketing cache helpers ──
//
// Centralised cache-key constants + tiny invalidation helpers, so callers
// don't have to remember the exact key strings. Each `invalidate*` call
// maps to a specific mutation surface (campaign created, voucher issued,
// redemption applied, voucher expired). Adding a new cache surface later
// is just: add the key constant + an invalidation helper.

export const MARKETING_CACHE_KEYS = {
  /** Aggregated behaviour analytics. Keyed globally — not per-user. */
  behaviour: "marketing:behaviour",
  /** Per-campaign performance. Keyed by campaign id. */
  campaignPerf: (campaignId: string) => `campaign:perf:${campaignId}`,
} as const;

/** Invalidate the global behaviour analytics cache. Call after campaign /
 * voucher / redemption / household mutations that would change RFM,
 * churn, or cross-sell outputs. */
export function invalidateBehaviourCache(): void {
  invalidate(MARKETING_CACHE_KEYS.behaviour);
}

/** Invalidate a single campaign's performance cache. Call after a
 * redemption, voucher issuance, voucher expiry, or campaign mutation
 * that would change the funnel / ROI numbers for that campaign. */
export function invalidateCampaignPerfCache(campaignId: string): void {
  invalidate(MARKETING_CACHE_KEYS.campaignPerf(campaignId));
}

/** Invalidate the entire campaign-perf family (every campaign). Used
 * when a mutation could affect multiple campaigns at once (e.g. bulk
 * voucher expiry sweep). */
export function invalidateAllCampaignPerfCaches(): void {
  invalidatePattern("campaign:perf:");
}
