/**
 * Marketing Config
 * =================
 * Centralised marketing configuration values stored in `platform_config`
 * (key = "marketing_config"). Reads the JSON row and returns a typed
 * object with sensible fallbacks if the row is missing/corrupt.
 *
 * Used by:
 *   - behaviour-engine.ts (RFM thresholds, churn thresholds)
 *
 * Replaces the previous hard-coded magic numbers (30/60/90/180 days,
 * 1/3/6/10 orders, $50/$100/$300/$500 spent, etc.).
 */

import { db } from "@/lib/db";

// ── Types ──

export interface MarketingConfig {
  /** Reactivation rate (fraction of lapsed households expected to return). */
  reactivationRate: number;
  /** Default discount value (dollars or percent) used for auto-suggested campaigns. */
  defaultDiscountValue: number;
  /** Average order value assumption (SGD cents) used for revenue forecasting. */
  avgOrderValueCents: number;
  /** Recency thresholds (days) for RFM scoring — ascending, 4 buckets → 5 score bands. */
  rfmRecencyThresholds: [number, number, number, number];
  /** Frequency thresholds (total orders) for RFM scoring — ascending, 4 buckets. */
  rfmFrequencyThresholds: [number, number, number, number];
  /** Monetary thresholds (cents) for RFM scoring — ascending, 4 buckets. */
  rfmMonetaryThresholds: [number, number, number, number];
  /** Days before voucher expiry to send a reminder notification. */
  voucherExpiryNoticeDays: number;
}

// ── Defaults (used when platform_config row is missing or invalid) ──
//
// These match the previous hard-coded values so existing RFM scoring
// behaviour is unchanged when no config row exists.
export const DEFAULT_MARKETING_CONFIG: MarketingConfig = {
  reactivationRate: 0.3,
  defaultDiscountValue: 15,
  avgOrderValueCents: 5000,
  rfmRecencyThresholds: [30, 60, 90, 180],
  rfmFrequencyThresholds: [1, 3, 6, 10],
  rfmMonetaryThresholds: [5000, 10000, 30000, 50000],
  voucherExpiryNoticeDays: 3,
};

// ── Cache (in-memory; one read per process lifetime) ──

let cachedConfig: MarketingConfig | null = null;
let cacheChecked = false;

/** Reset the cache — useful for tests / after config writes. */
export function resetMarketingConfigCache(): void {
  cachedConfig = null;
  cacheChecked = false;
}

// ── Public: read the marketing config ──

export async function getMarketingConfig(): Promise<MarketingConfig> {
  if (cacheChecked && cachedConfig) return cachedConfig;

  try {
    const row = await db.platformConfig.findUnique({
      where: { key: "marketing_config" },
    });
    if (!row?.value) {
      cachedConfig = DEFAULT_MARKETING_CONFIG;
    } else {
      try {
        const parsed = JSON.parse(row.value) as Partial<MarketingConfig>;
        // Merge with defaults — only fields present in the row override.
        cachedConfig = {
          ...DEFAULT_MARKETING_CONFIG,
          ...parsed,
        };
        // Validate threshold arrays — fall back to defaults if malformed.
        if (
          !Array.isArray(cachedConfig.rfmRecencyThresholds) ||
          cachedConfig.rfmRecencyThresholds.length !== 4
        ) {
          cachedConfig.rfmRecencyThresholds = DEFAULT_MARKETING_CONFIG.rfmRecencyThresholds;
        }
        if (
          !Array.isArray(cachedConfig.rfmFrequencyThresholds) ||
          cachedConfig.rfmFrequencyThresholds.length !== 4
        ) {
          cachedConfig.rfmFrequencyThresholds = DEFAULT_MARKETING_CONFIG.rfmFrequencyThresholds;
        }
        if (
          !Array.isArray(cachedConfig.rfmMonetaryThresholds) ||
          cachedConfig.rfmMonetaryThresholds.length !== 4
        ) {
          cachedConfig.rfmMonetaryThresholds = DEFAULT_MARKETING_CONFIG.rfmMonetaryThresholds;
        }
      } catch {
        cachedConfig = DEFAULT_MARKETING_CONFIG;
      }
    }
  } catch {
    cachedConfig = DEFAULT_MARKETING_CONFIG;
  }

  cacheChecked = true;
  return cachedConfig;
}

// ── Seed/upsert helper ──
//
// Called by the seed script (or once on demand) to materialise the
// platform_config row with default values. Idempotent.
export async function seedMarketingConfig(
  overrides: Partial<MarketingConfig> = {},
): Promise<void> {
  const value = JSON.stringify({ ...DEFAULT_MARKETING_CONFIG, ...overrides });
  await db.platformConfig.upsert({
    where: { key: "marketing_config" },
    create: {
      key: "marketing_config",
      value,
      label: "Marketing module configuration (RFM thresholds, reactivation rate, etc.)",
    },
    update: { value },
  });
  resetMarketingConfigCache();
}
