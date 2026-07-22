import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/**
 * Check whether a vendor has access to a given feature.
 *
 * A vendor's effective feature set = plan's default features, with
 * vendor_feature_overrides applied on top. This is the single
 * canonical function for all feature-gate checks.
 *
 * @param vendorId  The vendor's database ID
 * @param featureKey  The feature key (e.g. "team_management", "advanced_analytics")
 * @returns true if the vendor has the feature enabled, false otherwise
 */
export async function hasFeature(
  vendorId: string,
  featureKey: string
): Promise<boolean> {
  // 1. Check for an explicit override first (highest priority)
  const override = await db.vendorFeatureOverride.findUnique({
    where: { vendorId_featureId: { vendorId, featureId: featureKey } },
  });

  if (override) {
    return override.enabled;
  }

  // 2. Fall back to the vendor's plan defaults
  const vendorPlan = await db.vendorPlan.findUnique({
    where: { vendorId },
    include: {
      plan: {
        include: {
          planFeatures: {
            include: { feature: true },
          },
        },
      },
    },
  });

  if (!vendorPlan) {
    return false;
  }

  return vendorPlan.plan.planFeatures.some(
    (pf) => pf.feature.key === featureKey
  );
}

/**
 * Get a vendor's full effective feature set (all feature keys they have enabled).
 * Useful for rendering feature-gated UI sections in bulk.
 */
export async function getVendorFeatures(
  vendorId: string
): Promise<string[]> {
  const vendorPlan = await db.vendorPlan.findUnique({
    where: { vendorId },
    include: {
      plan: {
        include: {
          planFeatures: {
            include: { feature: true },
          },
        },
      },
    },
  });

  if (!vendorPlan) return [];

  // Start with plan defaults
  const featureMap = new Map<string, boolean>();
  for (const pf of vendorPlan.plan.planFeatures) {
    featureMap.set(pf.feature.key, true);
  }

  // Apply overrides
  const overrides = await db.vendorFeatureOverride.findMany({
    where: { vendorId },
  });
  for (const o of overrides) {
    const feature = await db.feature.findUnique({ where: { id: o.featureId } });
    if (feature) {
      featureMap.set(feature.key, o.enabled);
    }
  }

  return Array.from(featureMap.entries())
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
}