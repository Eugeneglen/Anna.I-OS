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

  return true; // all checks passed
}
