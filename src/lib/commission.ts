/**
 * Commission — single source of truth (Ops-controlled platform margin)
 * ==================================================================
 *
 * BUSINESS RULE (Anna.I Ops is the sole pricing authority):
 *   Vendors NEVER set customer-facing prices — they fulfil at Anna.I-
 *   determined prices. Ops centrally controls:
 *     1. Selling prices    → ServiceJobType.basePriceCents (Job Types editor)
 *     2. Platform margin   → PlatformConfig "commission_rate" (this module)
 *
 * The commission rate is applied where escrow entries are created (vendor
 * booking accept + add-on approval) and stored on every EscrowLedger row so
 * later recalculations (refunds, payout-base heals) use the rate that was
 * in force when the entry was created — never a mix.
 *
 * Read path: PlatformConfig "commission_rate" (Ops edits it via
 * /api/ops/config action "save_commission"), cached in-process for 60s
 * (src/lib/platform-config.ts), falling back to the compiled constant
 * PLATFORM_COMMISSION_RATE (src/lib/constants.ts, currently 10).
 *
 * Cache invalidation: the Ops config write route calls
 * invalidateCommissionRateCache() immediately after the upsert (same
 * mutation-invalidation pattern as resetMarketingConfigCache), so new
 * escrows pick up a rate change right away; the 60s TTL covers any
 * multi-process drift.
 */

import { PLATFORM_COMMISSION_RATE } from "@/lib/constants";
import {
  getPlatformConfigNumber,
  invalidatePlatformConfig,
  PLATFORM_CONFIG_KEYS,
} from "@/lib/platform-config";

/**
 * The effective platform commission rate (percent, e.g. 10 or 12.5).
 *
 * Resolution order:
 *   1. PlatformConfig "commission_rate" (Ops-controlled, 60s-cached)
 *   2. PLATFORM_COMMISSION_RATE constant (compiled default)
 *
 * Out-of-range values (negative or > 100, only possible via direct DB
 * edits — the Ops route validates 0-100) fall back to the constant.
 */
export async function getCommissionRate(): Promise<number> {
  const rate = await getPlatformConfigNumber(
    PLATFORM_CONFIG_KEYS.commissionRate,
    PLATFORM_COMMISSION_RATE
  );
  if (rate < 0 || rate > 100) {
    console.error(
      `[commission] PlatformConfig "${PLATFORM_CONFIG_KEYS.commissionRate}" is out of range (${rate}) — falling back to ${PLATFORM_COMMISSION_RATE}`
    );
    return PLATFORM_COMMISSION_RATE;
  }
  return rate;
}

/**
 * Drop the cached commission rate. Called by the Ops config write route
 * after "save_commission" so the next escrow creation reads the fresh value.
 */
export function invalidateCommissionRateCache(): void {
  invalidatePlatformConfig(PLATFORM_CONFIG_KEYS.commissionRate);
}
