/**
 * Behaviour Engine
 * ================
 * Computes per-household behavioural metrics from transactional data.
 * Uses RFM (Recency, Frequency, Monetary) scoring + churn risk + lifecycle stage.
 *
 * Data sources:
 * - Task table (completed/verified tasks → recency, frequency, monetary)
 * - Household cached fields (lastOrderAt, totalOrders, totalSpentCents)
 * - HouseholdCategoryAutonomy (per-category engagement level)
 * - CodeRedemption / Voucher (voucher behaviour)
 *
 * The engine does NOT modify the database — it's a read-only analytics layer.
 * Use updateHouseholdCachedStats() to persist the computed values.
 */

import { db } from "@/lib/db";
import type { ServiceCategory } from "@prisma/client";

// ── Types ──

export interface HouseholdBehaviour {
  householdId: string;
  // Recency
  lastOrderAt: Date | null;
  daysSinceLastOrder: number | null;
  // Frequency
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  // Monetary
  totalSpentCents: number;
  avgOrderValueCents: number;
  // Category behaviour
  categoriesUsed: string[];
  categoriesNeverTried: string[];
  // Trends
  orderFrequency: "INCREASING" | "STABLE" | "DECLINING" | "NEW" | "DORMANT";
  // RFM Score (1-5 each)
  recencyScore: number;
  frequencyScore: number;
  monetaryScore: number;
  rfmSegment: string;
  // Churn risk
  churnRisk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  // Lifecycle stage
  lifecycleStage: "NEW" | "ACTIVE" | "REGULAR" | "DECLINING" | "LAPSED" | "REACTIVATED";
  // Voucher behaviour
  vouchersClaimed: number;
  vouchersRedeemed: number;
  vouchersExpired: number;
}

const ALL_CATEGORIES = [
  "CLEANING", "LAUNDRY", "AIRCON", "PLUMBING", "ELECTRICAL",
  "PAINTING", "PEST_CONTROL", "HANDYMAN", "LOCKSMITH", "APPLIANCE_REPAIR",
];

// ── RFM Scoring ──

export function scoreRecency(daysSinceLastOrder: number | null): number {
  if (daysSinceLastOrder === null) return 1; // never ordered
  if (daysSinceLastOrder <= 30) return 5;
  if (daysSinceLastOrder <= 60) return 4;
  if (daysSinceLastOrder <= 90) return 3;
  if (daysSinceLastOrder <= 180) return 2;
  return 1;
}

export function scoreFrequency(totalOrders: number): number {
  if (totalOrders >= 10) return 5;
  if (totalOrders >= 6) return 4;
  if (totalOrders >= 3) return 3;
  if (totalOrders >= 1) return 2;
  return 1;
}

export function scoreMonetary(totalSpentCents: number): number {
  const spent = totalSpentCents / 100; // convert to dollars
  if (spent >= 500) return 5;
  if (spent >= 300) return 4;
  if (spent >= 100) return 3;
  if (spent >= 50) return 2;
  return 1;
}

export function getRfmSegment(r: number, f: number, m: number): string {
  if (r >= 4 && f >= 4 && m >= 4) return "Champions";
  if (r >= 4 && f >= 3) return "Loyal";
  if (r >= 4 && f <= 2) return "Recent";
  if (r >= 3 && f >= 3) return "Regular";
  if (r >= 2 && f >= 2) return "About to Sleep";
  if (r <= 2 && f >= 2) return "At Risk";
  if (r <= 2 && f <= 1) return "Lost";
  if (r >= 4 && f <= 1 && m <= 1) return "New";
  return "Average";
}

// ── Churn Risk ──

export function calculateChurnRisk(
  daysSinceLastOrder: number | null,
  totalOrders: number,
  orderFrequency: string,
): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  if (daysSinceLastOrder === null && totalOrders === 0) return "LOW"; // new, never ordered — not churn risk yet
  if (daysSinceLastOrder === null) return "CRITICAL"; // registered but never ordered

  if (daysSinceLastOrder <= 30 && totalOrders >= 3) return "LOW";
  if (daysSinceLastOrder <= 30) return "MEDIUM"; // recent but few orders
  if (daysSinceLastOrder <= 60 && orderFrequency === "DECLINING") return "HIGH";
  if (daysSinceLastOrder <= 90 && totalOrders >= 3) return "HIGH";
  if (daysSinceLastOrder > 90) return "CRITICAL";
  if (daysSinceLastOrder > 60) return "HIGH";
  return "MEDIUM";
}

// ── Lifecycle Stage ──

export function determineLifecycleStage(
  daysSinceLastOrder: number | null,
  totalOrders: number,
  accountAgeDays: number,
  orderFrequency: string,
): "NEW" | "ACTIVE" | "REGULAR" | "DECLINING" | "LAPSED" | "REACTIVATED" {
  if (totalOrders === 0 && accountAgeDays <= 30) return "NEW";
  if (totalOrders === 0) return "NEW"; // registered but never ordered

  if (daysSinceLastOrder === null) return "NEW";

  if (daysSinceLastOrder > 90) return "LAPSED";
  if (orderFrequency === "DECLINING" && daysSinceLastOrder > 45) return "DECLINING";
  if (totalOrders >= 5 && daysSinceLastOrder <= 30) return "REGULAR";
  if (daysSinceLastOrder <= 30) return "ACTIVE";

  // If they were lapsed but ordered recently, they're reactivated
  if (totalOrders >= 2 && daysSinceLastOrder <= 45) return "ACTIVE";

  return "ACTIVE";
}

// ── Order Frequency Trend ──

function determineOrderFrequency(
  tasks: { createdAt: Date; status: string }[],
): "INCREASING" | "STABLE" | "DECLINING" | "NEW" | "DORMANT" {
  const completed = tasks.filter(
    (t) => t.status === "COMPLETED" || t.status === "VERIFIED" || t.status === "ESCROW_RELEASED",
  );

  if (completed.length === 0) return "DORMANT";
  if (completed.length === 1) return "NEW";

  // Compare first half vs second half of orders
  const sorted = completed.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const midpoint = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, midpoint);
  const secondHalf = sorted.slice(midpoint);

  if (firstHalf.length === 0 || secondHalf.length === 0) return "STABLE";

  const firstSpan = firstHalf[firstHalf.length - 1].createdAt.getTime() - firstHalf[0].createdAt.getTime();
  const secondSpan = secondHalf[secondHalf.length - 1].createdAt.getTime() - secondHalf[0].createdAt.getTime();

  if (firstSpan === 0) return "INCREASING";
  const ratio = secondSpan / firstSpan;

  if (ratio < 0.7) return "INCREASING"; // orders coming faster
  if (ratio > 1.5) return "DECLINING"; // orders slowing down
  return "STABLE";
}

// ── Main: compute behaviour for a single household ──

export async function computeHouseholdBehaviour(householdId: string): Promise<HouseholdBehaviour> {
  const [tasks, household, vouchers] = await Promise.all([
    db.task.findMany({
      where: { householdId, cancelledAt: null },
      select: {
        id: true,
        status: true,
        category: true,
        amountCents: true,
        discountCents: true,
        finalAmountCents: true,
        createdAt: true,
        completedAt: true,
        verifiedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.household.findUnique({
      where: { id: householdId },
      select: {
        id: true,
        createdAt: true,
        lastOrderAt: true,
        totalOrders: true,
        totalSpentCents: true,
      },
    }),
    db.voucher.findMany({
      where: { householdId },
      select: { id: true, status: true },
    }),
  ]);

  const completedTasks = tasks.filter(
    (t) => t.status === "COMPLETED" || t.status === "VERIFIED" || t.status === "ESCROW_RELEASED",
  );
  const cancelledTasks = tasks.filter((t) => t.status === "CANCELLED");

  // Recency
  const lastCompleted = completedTasks[0]?.completedAt || completedTasks[0]?.verifiedAt || null;
  const daysSinceLastOrder = lastCompleted
    ? Math.floor((Date.now() - new Date(lastCompleted).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // Frequency
  const totalOrders = completedTasks.length;
  const cancelledOrders = cancelledTasks.length;

  // Monetary
  const totalSpentCents = completedTasks.reduce(
    (sum, t) => sum + (t.finalAmountCents || t.amountCents || 0),
    0,
  );
  const avgOrderValueCents = totalOrders > 0 ? Math.round(totalSpentCents / totalOrders) : 0;

  // Categories
  const categoriesUsed = [...new Set(completedTasks.map((t) => t.category as string))];
  const categoriesNeverTried = ALL_CATEGORIES.filter((c) => !categoriesUsed.includes(c));

  // Trends
  const orderFrequency = determineOrderFrequency(tasks);

  // RFM
  const recencyScore = scoreRecency(daysSinceLastOrder);
  const frequencyScore = scoreFrequency(totalOrders);
  const monetaryScore = scoreMonetary(totalSpentCents);
  const rfmSegment = getRfmSegment(recencyScore, frequencyScore, monetaryScore);

  // Churn risk
  const churnRisk = calculateChurnRisk(daysSinceLastOrder, totalOrders, orderFrequency);

  // Lifecycle
  const accountAgeDays = household
    ? Math.floor((Date.now() - household.createdAt.getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const lifecycleStage = determineLifecycleStage(daysSinceLastOrder, totalOrders, accountAgeDays, orderFrequency);

  // Vouchers
  const vouchersClaimed = vouchers.filter((v) => v.status === "CLAIMED").length;
  const vouchersRedeemed = vouchers.filter((v) => v.status === "USED").length;
  const vouchersExpired = vouchers.filter((v) => v.status === "EXPIRED").length;

  return {
    householdId,
    lastOrderAt: lastCompleted ? new Date(lastCompleted) : null,
    daysSinceLastOrder,
    totalOrders,
    completedOrders: totalOrders,
    cancelledOrders,
    totalSpentCents,
    avgOrderValueCents,
    categoriesUsed,
    categoriesNeverTried,
    orderFrequency,
    recencyScore,
    frequencyScore,
    monetaryScore,
    rfmSegment,
    churnRisk,
    lifecycleStage,
    vouchersClaimed,
    vouchersRedeemed,
    vouchersExpired,
  };
}

// ── Batch: compute for all households ──

export async function computeAllHouseholdBehaviours(): Promise<HouseholdBehaviour[]> {
  const households = await db.household.findMany({
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  const behaviours: HouseholdBehaviour[] = [];
  for (const h of households) {
    const behaviour = await computeHouseholdBehaviour(h.id);
    behaviours.push(behaviour);
  }
  return behaviours;
}

// ── Update cached stats on the Household row ──

export async function updateHouseholdCachedStats(householdId: string): Promise<void> {
  const tasks = await db.task.findMany({
    where: {
      householdId,
      status: { in: ["COMPLETED", "VERIFIED", "ESCROW_RELEASED"] },
    },
    select: {
      finalAmountCents: true,
      amountCents: true,
      completedAt: true,
      verifiedAt: true,
    },
    orderBy: { completedAt: "desc" },
  });

  const totalOrders = tasks.length;
  const totalSpentCents = tasks.reduce(
    (sum, t) => sum + (t.finalAmountCents || t.amountCents || 0),
    0,
  );
  const lastOrderAt = tasks[0]?.completedAt || tasks[0]?.verifiedAt || null;

  await db.household.update({
    where: { id: householdId },
    data: {
      totalOrders,
      totalSpentCents,
      lastOrderAt: lastOrderAt ? new Date(lastOrderAt) : null,
    },
  });
}

// ── Cross-sell opportunity detection ──

export interface CrossSellOpportunity {
  from: string;
  to: string;
  eligibleHouseholds: number;
  householdIds: string[];
}

export async function detectCrossSellOpportunities(): Promise<CrossSellOpportunity[]> {
  const behaviours = await computeAllHouseholdBehaviours();
  const opportunities: CrossSellOpportunity[] = [];

  for (const from of ALL_CATEGORIES) {
    for (const to of ALL_CATEGORIES) {
      if (from === to) continue;
      const eligible = behaviours.filter(
        (b) => b.categoriesUsed.includes(from) && b.categoriesNeverTried.includes(to),
      );
      if (eligible.length > 0) {
        opportunities.push({
          from,
          to,
          eligibleHouseholds: eligible.length,
          householdIds: eligible.map((b) => b.householdId),
        });
      }
    }
  }

  // Sort by most eligible households
  return opportunities.sort((a, b) => b.eligibleHouseholds - a.eligibleHouseholds);
}
