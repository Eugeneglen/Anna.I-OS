/**
 * Platform Config — cached runtime reader
 * =======================================
 *
 * Shared, in-process cached access to `platform_config` rows (Ops-controlled
 * runtime settings). Mirrors the marketing config read pattern
 * (src/lib/marketing/config.ts) but with a SHORT TTL (~60s) so Ops edits
 * propagate quickly, and per-key cache invalidation on write.
 *
 * Owned config surfaces:
 *   - "commission_rate"            → src/lib/commission.ts (Ops margin lever)
 *   - "require_verification_photos" → job-completion photo gate (default TRUE)
 *
 * Design rules:
 *   - The DB row is the single source of truth; this helper is a read cache.
 *   - Writes happen in the Ops CMS routes (/api/ops/config) — they MUST call
 *     the matching invalidate* helper so the new value is visible within the
 *     same process immediately (same pattern as resetMarketingConfigCache).
 *   - Missing/corrupt rows fall back to the provided default — never throw.
 */

import { db } from "@/lib/db";
import * as cache from "@/lib/cache";

// ── Keys ──

export const PLATFORM_CONFIG_KEYS = {
  /** Platform commission rate (percent number, e.g. "12.5"). Ops margin lever. */
  commissionRate: "commission_rate",
  /** Whether vendors must upload ≥1 verification photo before completing a job. "true"/"false" (default true). */
  requireVerificationPhotos: "require_verification_photos",
} as const;

// ── Cache (60s TTL, per-key, in-process via src/lib/cache.ts) ──

const CACHE_TTL_MS = 60_000;
const CACHE_PREFIX = "platform_config:";

function cacheKey(key: string): string {
  return `${CACHE_PREFIX}${key}`;
}

/** Wrapper so a cached null (row absent) is distinguishable from "not cached". */
interface CachedValue {
  value: string | null;
}

/**
 * Read a raw PlatformConfig value with a 60s in-process cache.
 * Returns null when the row is absent or the DB read fails (fallback
 * semantics live in the typed readers below).
 */
export async function getPlatformConfigValue(key: string): Promise<string | null> {
  const ck = cacheKey(key);
  const cached = cache.get<CachedValue>(ck);
  if (cached) return cached.value;

  let value: string | null = null;
  try {
    const row = await db.platformConfig.findUnique({ where: { key } });
    value = row?.value ?? null;
  } catch (err) {
    // Read failure must never break a money flow — callers fall back to the
    // compiled default. Log loudly for ops follow-up.
    console.error(`[platform-config] Failed to read "${key}" — using default:`, err);
    return null;
  }

  cache.set<CachedValue>(ck, { value }, CACHE_TTL_MS);
  return value;
}

/**
 * Read a numeric PlatformConfig value (JSON/plain number string).
 * Falls back to `fallback` when the row is absent or not a finite number.
 */
export async function getPlatformConfigNumber(
  key: string,
  fallback: number
): Promise<number> {
  const raw = await getPlatformConfigValue(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Read a boolean PlatformConfig value ("true"/"false"/"1"/"0"/"yes"/"no"/"on"/"off").
 * Falls back to `fallback` when the row is absent or unrecognized.
 */
export async function getPlatformConfigBoolean(
  key: string,
  fallback: boolean
): Promise<boolean> {
  const raw = await getPlatformConfigValue(key);
  if (raw === null) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

// ── Invalidation (call on Ops config write) ──

/** Drop the cached value for one key. No-op when not cached. */
export function invalidatePlatformConfig(key: string): void {
  cache.invalidate(cacheKey(key));
}

/** Drop every platform-config cached value. */
export function invalidateAllPlatformConfig(): void {
  cache.invalidatePattern(CACHE_PREFIX);
}

// ── Typed readers ──

/**
 * Whether vendors must upload at least one verification photo before they
 * can mark a job complete. Ops-controlled via the
 * "require_verification_photos" PlatformConfig key; DEFAULTS TO TRUE when
 * the key is absent (audit FIX-1c: completion with zero photos must be
 * rejected server-side unless ops explicitly turns the gate off).
 */
export async function getRequireVerificationPhotos(): Promise<boolean> {
  return getPlatformConfigBoolean(PLATFORM_CONFIG_KEYS.requireVerificationPhotos, true);
}
