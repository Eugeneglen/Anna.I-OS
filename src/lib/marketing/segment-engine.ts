/**
 * Segment Engine
 * ==============
 * Dynamic customer segmentation — evaluates filters against household data
 * and maintains dynamic membership (households enter/leave as behaviour changes).
 *
 * Uses transactional data (Task history) + cached Household fields for performance.
 * Segments are stored as JSON filters in the Segment.filters column.
 */

import { db } from "@/lib/db";
import { computeAllHouseholdBehaviours, type HouseholdBehaviour } from "./behaviour-engine";

// ── Filter Types ──

export interface SegmentFilters {
  // Recency
  lastOrderDaysMin?: number;
  lastOrderDaysMax?: number;
  // Frequency
  minOrders?: number;
  maxOrders?: number;
  // Monetary
  minTotalSpendCents?: number;
  maxTotalSpendCents?: number;
  minAvgOrderValueCents?: number;
  // Category
  categoriesUsed?: string[];
  categoriesNeverTried?: string[];
  // Account
  minAccountAgeDays?: number;
  maxAccountAgeDays?: number;
  // Subscription
  subscriptionTier?: "HOME" | "CARE";
  // RFM
  rfmSegment?: string;
  churnRisk?: string[];
  lifecycleStage?: string[];
  // Acquisition
  acquisitionSource?: string[];
  // ── Phase 2 — expanded filter types (Fix 9) ──
  /** Customer value tier (derived from RFM segment). HIGH | MEDIUM | LOW */
  customerValue?: "HIGH" | "MEDIUM" | "LOW";
  /** Minimum vouchers redeemed (number). */
  minVouchersRedeemed?: number;
  /** Geographic area — case-insensitive substring match on household address. */
  geographicArea?: string;
  /** Demographics — case-insensitive substring match on household name/fullName. */
  nameContains?: string;
  /** Activity level (derived from lifecycle stage). ACTIVE | INACTIVE */
  activityLevel?: "ACTIVE" | "INACTIVE";
  /** Marketing engagement (derived from voucher behaviour). ENGAGED | NOT_ENGAGED */
  marketingEngagement?: "ENGAGED" | "NOT_ENGAGED";
  /** Minimum max-autonomy-level reached across categories (1-5). */
  minAutonomyLevel?: number;
}

// ── Create a segment ──

export async function createSegment(params: {
  name: string;
  description?: string;
  filters: SegmentFilters;
  createdById?: string;
  createdByName: string;
}): Promise<{ id: string; name: string }> {
  const segment = await db.segment.create({
    data: {
      name: params.name,
      description: params.description || null,
      filters: params.filters as unknown as Record<string, unknown>,
      createdById: params.createdById,
      createdByName: params.createdByName,
    },
  });

  // Immediately compute members
  await computeSegmentMembers(segment.id);

  return { id: segment.id, name: segment.name };
}

// ── Preview member count without creating a segment ──

export async function previewSegmentMembers(
  filters: SegmentFilters,
): Promise<{ count: number; sampleHouseholdIds: string[] }> {
  const behaviours = await computeAllHouseholdBehaviours();
  const matching = behaviours.filter((b) => matchesFilters(b, filters));
  return {
    count: matching.length,
    sampleHouseholdIds: matching.slice(0, 10).map((b) => b.householdId),
  };
}

// ── Compute segment members (dynamic — re-evaluates all households) ──

export async function computeSegmentMembers(
  segmentId: string,
): Promise<{ added: number; removed: number; total: number }> {
  const segment = await db.segment.findUnique({
    where: { id: segmentId },
    select: { filters: true },
  });

  if (!segment) throw new Error("Segment not found");

  const filters = segment.filters as unknown as SegmentFilters;
  const behaviours = await computeAllHouseholdBehaviours();
  const matchingHouseholdIds = new Set(
    behaviours.filter((b) => matchesFilters(b, filters)).map((b) => b.householdId),
  );

  // Get existing members
  const existingMembers = await db.segmentMember.findMany({
    where: { segmentId },
    select: { id: true, householdId: true },
  });
  const existingHouseholdIds = new Set(existingMembers.map((m) => m.householdId));

  // Determine adds and removes
  const toAdd = [...matchingHouseholdIds].filter((id) => !existingHouseholdIds.has(id));
  const toRemove = existingMembers.filter((m) => !matchingHouseholdIds.has(m.householdId));

  // Add new members
  for (const householdId of toAdd) {
    const behaviour = behaviours.find((b) => b.householdId === householdId);
    await db.segmentMember.create({
      data: {
        segmentId,
        householdId,
        reason: {
          lastOrderAt: behaviour?.lastOrderAt?.toISOString() || null,
          totalOrders: behaviour?.totalOrders || 0,
          totalSpentCents: behaviour?.totalSpentCents || 0,
          rfmSegment: behaviour?.rfmSegment || "Unknown",
          churnRisk: behaviour?.churnRisk || "LOW",
        } as unknown as Record<string, unknown>,
      },
    });
  }

  // Remove non-matching members
  if (toRemove.length > 0) {
    await db.segmentMember.deleteMany({
      where: { id: { in: toRemove.map((m) => m.id) } },
    });
  }

  // Update segment stats
  await db.segment.update({
    where: { id: segmentId },
    data: {
      memberCount: matchingHouseholdIds.size,
      lastComputedAt: new Date(),
    },
  });

  return {
    added: toAdd.length,
    removed: toRemove.length,
    total: matchingHouseholdIds.size,
  };
}

// ── Archive a segment ──

export async function archiveSegment(segmentId: string): Promise<void> {
  await db.segmentMember.deleteMany({ where: { segmentId } });
  await db.segment.update({
    where: { id: segmentId },
    data: { status: "ARCHIVED", memberCount: 0 },
  });
}

// ── Unarchive a segment (reactivate) ──
// Phase 2 Fix 12 — restores an ARCHIVED segment to ACTIVE status and
// recomputes its members so it is immediately usable again. Mirrors the
// createSegment flow: status flip first, then a fresh member computation.

export async function unarchiveSegment(
  segmentId: string,
): Promise<{ total: number; added: number; removed: number }> {
  // Restore ACTIVE status — the segment becomes visible in lists again.
  await db.segment.update({
    where: { id: segmentId },
    data: { status: "ACTIVE" },
  });

  // Recompute members from the stored filters (may restore prior members
  // and/or pick up changes that happened while the segment was archived).
  const result = await computeSegmentMembers(segmentId);
  return { total: result.total, added: result.added, removed: result.removed };
}

// ── Filter matching logic ──

function matchesFilters(behaviour: HouseholdBehaviour, filters: SegmentFilters): boolean {
  // Recency
  if (filters.lastOrderDaysMin !== undefined) {
    if (behaviour.daysSinceLastOrder === null || behaviour.daysSinceLastOrder < filters.lastOrderDaysMin) {
      return false;
    }
  }
  if (filters.lastOrderDaysMax !== undefined) {
    if (behaviour.daysSinceLastOrder === null || behaviour.daysSinceLastOrder > filters.lastOrderDaysMax) {
      return false;
    }
  }

  // Frequency
  if (filters.minOrders !== undefined && behaviour.totalOrders < filters.minOrders) {
    return false;
  }
  if (filters.maxOrders !== undefined && behaviour.totalOrders > filters.maxOrders) {
    return false;
  }

  // Monetary
  if (filters.minTotalSpendCents !== undefined && behaviour.totalSpentCents < filters.minTotalSpendCents) {
    return false;
  }
  if (filters.maxTotalSpendCents !== undefined && behaviour.totalSpentCents > filters.maxTotalSpendCents) {
    return false;
  }
  if (filters.minAvgOrderValueCents !== undefined && behaviour.avgOrderValueCents < filters.minAvgOrderValueCents) {
    return false;
  }

  // Categories used
  if (filters.categoriesUsed && filters.categoriesUsed.length > 0) {
    if (!filters.categoriesUsed.some((c) => behaviour.categoriesUsed.includes(c))) {
      return false;
    }
  }

  // Categories never tried
  if (filters.categoriesNeverTried && filters.categoriesNeverTried.length > 0) {
    if (!filters.categoriesNeverTried.some((c) => behaviour.categoriesNeverTried.includes(c))) {
      return false;
    }
  }

  // Account age
  if (filters.minAccountAgeDays !== undefined && behaviour.accountAgeDays < filters.minAccountAgeDays) {
    return false;
  }
  if (filters.maxAccountAgeDays !== undefined && behaviour.accountAgeDays > filters.maxAccountAgeDays) {
    return false;
  }

  // Subscription tier (membership)
  if (filters.subscriptionTier && behaviour.subscriptionTier !== filters.subscriptionTier) {
    return false;
  }

  // Acquisition source (referral source)
  if (filters.acquisitionSource && filters.acquisitionSource.length > 0) {
    if (!filters.acquisitionSource.includes(behaviour.acquisitionSource)) {
      return false;
    }
  }

  // RFM
  if (filters.rfmSegment && behaviour.rfmSegment !== filters.rfmSegment) {
    return false;
  }

  // Churn risk
  if (filters.churnRisk && filters.churnRisk.length > 0) {
    if (!filters.churnRisk.includes(behaviour.churnRisk)) {
      return false;
    }
  }

  // Lifecycle stage
  if (filters.lifecycleStage && filters.lifecycleStage.length > 0) {
    if (!filters.lifecycleStage.includes(behaviour.lifecycleStage)) {
      return false;
    }
  }

  // ── Phase 2 — expanded filters (Fix 9) ──

  // Customer value (derived from RFM segment)
  if (filters.customerValue && behaviour.customerValue !== filters.customerValue) {
    return false;
  }

  // Voucher usage — minimum vouchers redeemed
  if (
    filters.minVouchersRedeemed !== undefined &&
    behaviour.vouchersRedeemed < filters.minVouchersRedeemed
  ) {
    return false;
  }

  // Geographic area — case-insensitive substring match on address
  if (filters.geographicArea && filters.geographicArea.trim().length > 0) {
    const needle = filters.geographicArea.trim().toLowerCase();
    if (!behaviour.householdAddress.toLowerCase().includes(needle)) {
      return false;
    }
  }

  // Demographics — case-insensitive substring match on household name
  if (filters.nameContains && filters.nameContains.trim().length > 0) {
    const needle = filters.nameContains.trim().toLowerCase();
    if (!behaviour.householdName.toLowerCase().includes(needle)) {
      return false;
    }
  }

  // Activity level
  if (filters.activityLevel && behaviour.activityLevel !== filters.activityLevel) {
    return false;
  }

  // Marketing engagement
  if (
    filters.marketingEngagement &&
    behaviour.marketingEngagement !== filters.marketingEngagement
  ) {
    return false;
  }

  // Autonomy level — household's max autonomy across categories must be >= threshold
  if (
    filters.minAutonomyLevel !== undefined &&
    behaviour.maxAutonomyLevel < filters.minAutonomyLevel
  ) {
    return false;
  }

  return true; // all checks passed
}
