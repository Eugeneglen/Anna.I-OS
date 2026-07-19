// ============================================================
// Anna.I — Vendor Entitlement Utility
// Single point for all feature-gate checks.
// Never scatter tier conditionals through business logic.
// ============================================================

import { db } from "@/lib/db"

// In-memory cache for the current request cycle
const featureCache = new Map<string, boolean>()

/**
 * Check if a vendor has access to a given feature.
 * 
 * Effective feature set = plan's features + overrides.
 * An override can ENABLE a feature even if the plan doesn't include it,
 * or DISABLE a feature that the plan does include.
 * 
 * @param vendorId - The vendor to check
 * @param featureKey - The feature key (e.g. "team_management", "advanced_analytics")
 */
export async function hasFeature(
  vendorId: string,
  featureKey: string
): Promise<boolean> {
  const cacheKey = `${vendorId}:${featureKey}`
  if (featureCache.has(cacheKey)) {
    return featureCache.get(cacheKey)!
  }

  try {
    // 1. Check for an explicit override first (highest priority)
    const override = await db.vendorFeatureOverride.findUnique({
      where: { vendorId_featureId: { vendorId, featureKey } },
    })

    if (override) {
      featureCache.set(cacheKey, override.enabled)
      return override.enabled
    }

    // 2. Check the vendor's plan
    const vendorPlan = await db.vendorPlan.findUnique({
      where: { vendorId },
      include: { plan: { include: { planFeatures: true } } },
    })

    if (vendorPlan) {
      const hasFeature = vendorPlan.plan.planFeatures.some(
        (pf) => pf.featureId === featureKey
      )
      featureCache.set(cacheKey, hasFeature)
      return hasFeature
    }

    // 3. No plan = no features
    featureCache.set(cacheKey, false)
    return false
  } catch (err) {
    console.error(`[entitlement] hasFeature check failed for ${vendorId}:${featureKey}`, err)
    return false
  }
}

/**
 * Clear the in-memory feature cache.
 * Call this after plan/override changes.
 */
export function clearFeatureCache() {
  featureCache.clear()
}