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
import { getMarketingConfig, type MarketingConfig } from "./config";

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
  // ── Phase 2 — additional fields used by the expanded Segment filters ──
  /** Household name (for demographics / name-contains filter). */
  householdName: string;
  /** Household address line (for geographic-area filter — case-insensitive contains). */
  householdAddress: string;
  /** Max autonomy level reached across categories (1-5). 0 if never onboarding. */
  maxAutonomyLevel: number;
  /** Customer value tier (derived from RFM segment). HIGH | MEDIUM | LOW */
  customerValue: "HIGH" | "MEDIUM" | "LOW";
  /** Activity level — derived from lifecycle stage. ACTIVE | INACTIVE */
  activityLevel: "ACTIVE" | "INACTIVE";
  /** Marketing engagement — derived from voucher behaviour. ENGAGED | NOT_ENGAGED */
  marketingEngagement: "ENGAGED" | "NOT_ENGAGED";
  /** Account age in days (from household.createdAt). */
  accountAgeDays: number;
  /** Acquisition source (PILOT_COHORT | PUBLIC_CODE | PARTNERSHIP_REFERRAL | ORGANIC | OTHER). */
  acquisitionSource: string;
  /** Most recent active subscription tier (HOME | CARE). null if no active subscription. */
  subscriptionTier: "HOME" | "CARE" | null;
}

const ALL_CATEGORIES = [
  "CLEANING", "LAUNDRY", "AIRCON", "PLUMBING", "ELECTRICAL",
  "PAINTING", "PEST_CONTROL", "HANDYMAN", "LOCKSMITH", "APPLIANCE_REPAIR",
];

// ── RFM Scoring ──
//
// The scoring functions are pure (no DB) so they accept an optional
// `config` parameter. When omitted, they fall back to the default
// marketing config — preserving backwards compatibility with callers
// that haven't been updated to pass config explicitly.

const DEFAULT_CONFIG: MarketingConfig = {
  reactivationRate: 0.3,
  defaultDiscountValue: 15,
  avgOrderValueCents: 5000,
  rfmRecencyThresholds: [30, 60, 90, 180],
  rfmFrequencyThresholds: [1, 3, 6, 10],
  rfmMonetaryThresholds: [5000, 10000, 30000, 50000],
  voucherExpiryNoticeDays: 3,
};

export function scoreRecency(
  daysSinceLastOrder: number | null,
  config: Pick<MarketingConfig, "rfmRecencyThresholds"> = DEFAULT_CONFIG,
): number {
  if (daysSinceLastOrder === null) return 1; // never ordered
  const [t1, t2, t3, t4] = config.rfmRecencyThresholds;
  if (daysSinceLastOrder <= t1) return 5;
  if (daysSinceLastOrder <= t2) return 4;
  if (daysSinceLastOrder <= t3) return 3;
  if (daysSinceLastOrder <= t4) return 2;
  return 1;
}

export function scoreFrequency(
  totalOrders: number,
  config: Pick<MarketingConfig, "rfmFrequencyThresholds"> = DEFAULT_CONFIG,
): number {
  const [f1, f2, f3, f4] = config.rfmFrequencyThresholds;
  if (totalOrders >= f4) return 5;
  if (totalOrders >= f3) return 4;
  if (totalOrders >= f2) return 3;
  if (totalOrders >= f1) return 2;
  return 1;
}

export function scoreMonetary(
  totalSpentCents: number,
  config: Pick<MarketingConfig, "rfmMonetaryThresholds"> = DEFAULT_CONFIG,
): number {
  // Monetary thresholds are stored in cents (consistent with the rest of the system).
  const [m1, m2, m3, m4] = config.rfmMonetaryThresholds;
  if (totalSpentCents >= m4) return 5;
  if (totalSpentCents >= m3) return 4;
  if (totalSpentCents >= m2) return 3;
  if (totalSpentCents >= m1) return 2;
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
//
// `calculateChurnRisk` uses RFM recency + frequency thresholds. The
// thresholds come from the marketing config so they can be tuned via
// platform_config without a code change.

export function calculateChurnRisk(
  daysSinceLastOrder: number | null,
  totalOrders: number,
  orderFrequency: string,
  config: Pick<MarketingConfig, "rfmRecencyThresholds" | "rfmFrequencyThresholds"> = DEFAULT_CONFIG,
): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
  const [recencyRecent, recencyMid, recencyLate, recencyLapsed] = config.rfmRecencyThresholds;
  const [, , freqRegular] = config.rfmFrequencyThresholds;

  if (daysSinceLastOrder === null && totalOrders === 0) return "LOW"; // new, never ordered — not churn risk yet
  if (daysSinceLastOrder === null) return "CRITICAL"; // registered but never ordered

  if (daysSinceLastOrder <= recencyRecent && totalOrders >= freqRegular) return "LOW";
  if (daysSinceLastOrder <= recencyRecent) return "MEDIUM"; // recent but few orders
  if (daysSinceLastOrder <= recencyMid && orderFrequency === "DECLINING") return "HIGH";
  if (daysSinceLastOrder <= recencyLate && totalOrders >= freqRegular) return "HIGH";
  if (daysSinceLastOrder > recencyLate) return "CRITICAL";
  if (daysSinceLastOrder > recencyMid) return "HIGH";
  return "MEDIUM";
}

// ── Lifecycle Stage ──
//
// Uses the recency thresholds from marketing config (recencyMid,
// recencyRecent, and an intermediate midpoint) plus the
// `rfmFrequencyThresholds` regular-customer cutoff.

export function determineLifecycleStage(
  daysSinceLastOrder: number | null,
  totalOrders: number,
  accountAgeDays: number,
  orderFrequency: string,
  config: Pick<MarketingConfig, "rfmRecencyThresholds" | "rfmFrequencyThresholds"> = DEFAULT_CONFIG,
): "NEW" | "ACTIVE" | "REGULAR" | "DECLINING" | "LAPSED" | "REACTIVATED" {
  const [recencyRecent, recencyMid, recencyLate] = config.rfmRecencyThresholds;
  // "Regular" customer frequency — third bucket of rfmFrequencyThresholds (defaults to 6).
  const freqRegular = config.rfmFrequencyThresholds[2];
  // Midpoint between recencyRecent (30) and recencyMid (60) — used for "declining" detection.
  const recencyMidpoint = Math.round((recencyRecent + recencyMid) / 2);

  if (totalOrders === 0 && accountAgeDays <= recencyRecent) return "NEW";
  if (totalOrders === 0) return "NEW"; // registered but never ordered

  if (daysSinceLastOrder === null) return "NEW";

  if (daysSinceLastOrder > recencyLate) return "LAPSED";
  if (orderFrequency === "DECLINING" && daysSinceLastOrder > recencyMidpoint) return "DECLINING";
  if (totalOrders >= freqRegular && daysSinceLastOrder <= recencyRecent) return "REGULAR";
  if (daysSinceLastOrder <= recencyRecent) return "ACTIVE";

  // If they were lapsed but ordered recently, they're reactivated
  if (totalOrders >= 2 && daysSinceLastOrder <= recencyMidpoint) return "ACTIVE";

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
//
// `computeHouseholdBehaviour` keeps its original per-household signature
// (it's called from the household intelligence panel + cached-stats
// backfill). The shared "pure" computation lives in
// `computeBehaviourFromData()` below — both the single-household path
// and the batched all-households path funnel through it, guaranteeing
// identical output shape.

// Types for the in-memory data the pure helper consumes. Mirrors the
// Prisma select shapes used in `computeHouseholdBehaviour` exactly, so
// the same code path can be reused by both call sites without
// duplicating the per-household aggregation logic.

type BehaviourHousehold = {
  id: string;
  name: string | null;
  fullName: string | null;
  address: string | null;
  createdAt: Date;
  lastOrderAt: Date | null;
  totalOrders: number | null;
  totalSpentCents: number | null;
  acquisitionSource: string | null;
};

type BehaviourTask = {
  householdId: string;
  status: string;
  category: string | null;
  amountCents: number | null;
  discountCents: number | null;
  finalAmountCents: number | null;
  createdAt: Date;
  completedAt: Date | null;
  verifiedAt: Date | null;
};

type BehaviourVoucher = {
  householdId: string;
  status: string;
  origin?: string | null; // F22 — undefined/null treated as MARKETING (pre-F22 rows)
};

type BehaviourAutonomyRow = {
  householdId: string;
  currentLevel: number;
};

type BehaviourSubscription = {
  householdId: string;
  tier: string;
  status: string;
  createdAt: Date;
};

/**
 * Pure helper: compute a single household's behaviour from pre-fetched
 * in-memory data. No DB access — both `computeHouseholdBehaviour` (single)
 * and `computeAllHouseholdBehaviours` (batched) call into this so the
 * output shape is identical regardless of how the data was fetched.
 */
function computeBehaviourFromData(params: {
  householdId: string;
  household: BehaviourHousehold | null;
  tasks: BehaviourTask[];
  vouchers: BehaviourVoucher[];
  autonomyRows: BehaviourAutonomyRow[];
  subscriptions: BehaviourSubscription[];
  config: MarketingConfig;
}): HouseholdBehaviour {
  const { householdId, household, tasks, vouchers, autonomyRows, subscriptions, config } = params;

  const completedTasks = tasks.filter(
    (t) => t.status === "COMPLETED" || t.status === "VERIFIED" || t.status === "ESCROW_RELEASED",
  );
  const cancelledTasks = tasks.filter((t) => t.status === "CANCELLED");

  // Recency — pick the most recent completed/verified timestamp.
  // Mirrors the original logic which preferred completedAt then fell
  // back to verifiedAt. We sort the completed set in-memory (newest
  // first) so the first element is the most recent, matching the
  // original `orderBy: { createdAt: "desc" }` + `[0]` access pattern.
  const sortedCompleted = [...completedTasks].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const lastCompleted =
    sortedCompleted[0]?.completedAt || sortedCompleted[0]?.verifiedAt || null;
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

  // RFM — pass the loaded config so thresholds come from platform_config
  const recencyScore = scoreRecency(daysSinceLastOrder, config);
  const frequencyScore = scoreFrequency(totalOrders, config);
  const monetaryScore = scoreMonetary(totalSpentCents, config);
  const rfmSegment = getRfmSegment(recencyScore, frequencyScore, monetaryScore);

  // Churn risk
  const churnRisk = calculateChurnRisk(daysSinceLastOrder, totalOrders, orderFrequency, config);

  // Lifecycle
  const accountAgeDays = household
    ? Math.floor((Date.now() - household.createdAt.getTime()) / (1000 * 60 * 60 * 24))
    : 0;
  const lifecycleStage = determineLifecycleStage(
    daysSinceLastOrder,
    totalOrders,
    accountAgeDays,
    orderFrequency,
    config,
  );

  // Vouchers — F22: only MARKETING vouchers count toward engagement
  // (policy R3: "behaviour segmentation counts only marketing-voucher
  // engagement"). REFUND_CREDIT is the household's own money and
  // SERVICE_RECOVERY is dispute goodwill — neither is promo engagement.
  const marketingVouchers = vouchers.filter((v) => v.origin === undefined || v.origin === "MARKETING");
  const vouchersClaimed = marketingVouchers.filter((v) => v.status === "CLAIMED").length;
  const vouchersRedeemed = marketingVouchers.filter((v) => v.status === "USED").length;
  const vouchersExpired = marketingVouchers.filter((v) => v.status === "EXPIRED").length;

  // Phase 2 — derived fields for expanded segment filters
  const maxAutonomyLevel = autonomyRows.length > 0
    ? autonomyRows.reduce((max, r) => Math.max(max, r.currentLevel), 0)
    : 0;

  const customerValue: "HIGH" | "MEDIUM" | "LOW" = (() => {
    if (rfmSegment === "Champions" || rfmSegment === "Loyal") return "HIGH";
    if (rfmSegment === "At Risk" || rfmSegment === "Lost") return "LOW";
    return "MEDIUM";
  })();

  const activityLevel: "ACTIVE" | "INACTIVE" = (() => {
    if (lifecycleStage === "DECLINING" || lifecycleStage === "LAPSED") return "INACTIVE";
    return "ACTIVE";
  })();

  const marketingEngagement: "ENGAGED" | "NOT_ENGAGED" =
    vouchersClaimed > 0 || vouchersRedeemed > 0 ? "ENGAGED" : "NOT_ENGAGED";

  // Subscription tier — most recent active subscription wins; fall back to most recent of any status.
  // `subscriptions` is assumed already sorted by createdAt desc (we sort
  // in the batched query), so `find()` returns the most recent ACTIVE.
  const subscriptionTier: "HOME" | "CARE" | null = (() => {
    if (subscriptions.length === 0) return null;
    const active = subscriptions.find((s) => s.status === "ACTIVE");
    const pick = active || subscriptions[0];
    return (pick?.tier === "CARE" ? "CARE" : "HOME");
  })();

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
    // Phase 2 — expanded-segment filter fields
    householdName: household?.fullName || household?.name || "",
    householdAddress: household?.address || "",
    maxAutonomyLevel,
    customerValue,
    activityLevel,
    marketingEngagement,
    accountAgeDays,
    acquisitionSource: household?.acquisitionSource || "ORGANIC",
    subscriptionTier,
  };
}

export async function computeHouseholdBehaviour(householdId: string): Promise<HouseholdBehaviour> {
  // Read marketing config once per call (cached in-memory after first read).
  const config = await getMarketingConfig();

  const [tasks, household, vouchers, autonomyRows, subscriptions] = await Promise.all([
    db.task.findMany({
      where: { householdId, cancelledAt: null },
      select: {
        householdId: true,
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
        name: true,
        fullName: true,
        address: true,
        createdAt: true,
        lastOrderAt: true,
        totalOrders: true,
        totalSpentCents: true,
        acquisitionSource: true,
      },
    }),
    db.voucher.findMany({
      where: { householdId },
      select: { householdId: true, status: true, origin: true },
    }),
    // Phase 2 — fetch the household's per-category autonomy rows so we can
    // surface `maxAutonomyLevel` for the Autonomy Level segment filter.
    db.householdCategoryAutonomy.findMany({
      where: { householdId },
      select: { householdId: true, currentLevel: true },
    }),
    // Phase 2 — fetch subscriptions so we can surface `subscriptionTier`
    // for the Membership segment filter.
    db.subscription.findMany({
      where: { householdId },
      select: { householdId: true, tier: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return computeBehaviourFromData({
    householdId,
    household,
    tasks,
    vouchers,
    autonomyRows,
    subscriptions,
    config,
  });
}

// ── Batch: compute for all households ──
//
// Fix 18 — replaces the previous "3N queries" (one household list + 3
// queries per household inside `computeHouseholdBehaviour`) with a
// constant 5 batched queries (households, tasks, vouchers, autonomy
// rows, subscriptions). Results are grouped by householdId in memory
// and the per-household computation is delegated to the same
// `computeBehaviourFromData` helper used by the single-household path
// — guaranteeing the output shape is byte-for-byte identical to the
// previous implementation.
//
// Why 5 batched queries instead of 3 (tasks/household/vouchers)?
// The single-household path also reads autonomy rows + subscriptions
// to populate `maxAutonomyLevel` + `subscriptionTier` (Phase 2 segment
// filters). Batching only tasks/household/vouchers would force the
// all-households path back into per-household queries for the other
// two tables, defeating the optimization. We batch ALL five tables so
// the constant-query claim holds regardless of household count.
//
// Output ordering is preserved: households are fetched in createdAt
// asc order, and we map over that exact list when emitting behaviours.

export async function computeAllHouseholdBehaviours(): Promise<HouseholdBehaviour[]> {
  // Read marketing config once (cached in-memory after first read).
  const config = await getMarketingConfig();

  // 1 batched query: households (the "driving" set — we iterate over this).
  const households = await db.household.findMany({
    select: {
      id: true,
      name: true,
      fullName: true,
      address: true,
      createdAt: true,
      lastOrderAt: true,
      totalOrders: true,
      totalSpentCents: true,
      acquisitionSource: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (households.length === 0) return [];

  const householdIds = households.map((h) => h.id);

  // 4 batched queries (run concurrently) — `where householdId IN [...]`.
  const [allTasks, allVouchers, allAutonomyRows, allSubscriptions] = await Promise.all([
    db.task.findMany({
      where: { householdId: { in: householdIds }, cancelledAt: null },
      select: {
        householdId: true,
        status: true,
        category: true,
        amountCents: true,
        discountCents: true,
        finalAmountCents: true,
        createdAt: true,
        completedAt: true,
        verifiedAt: true,
      },
    }),
    db.voucher.findMany({
      where: { householdId: { in: householdIds } },
      select: { householdId: true, status: true, origin: true },
    }),
    db.householdCategoryAutonomy.findMany({
      where: { householdId: { in: householdIds } },
      select: { householdId: true, currentLevel: true },
    }),
    db.subscription.findMany({
      where: { householdId: { in: householdIds } },
      select: { householdId: true, tier: true, status: true, createdAt: true },
      // Sort by createdAt desc so the helper's `find(s => s.status==="ACTIVE")`
      // picks the most recent ACTIVE sub when no ACTIVE exists; falls back to
      // `subscriptions[0]` (most recent of any status).
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Group the four lists by householdId in memory. We pre-seed every
  // householdId with an empty array so the per-household computation
  // doesn't have to handle "missing household" branches separately.
  const tasksByHousehold = new Map<string, BehaviourTask[]>();
  const vouchersByHousehold = new Map<string, BehaviourVoucher[]>();
  const autonomyByHousehold = new Map<string, BehaviourAutonomyRow[]>();
  const subscriptionsByHousehold = new Map<string, BehaviourSubscription[]>();
  for (const id of householdIds) {
    tasksByHousehold.set(id, []);
    vouchersByHousehold.set(id, []);
    autonomyByHousehold.set(id, []);
    subscriptionsByHousehold.set(id, []);
  }
  for (const t of allTasks) {
    tasksByHousehold.get(t.householdId)?.push(t);
  }
  for (const v of allVouchers) {
    vouchersByHousehold.get(v.householdId)?.push(v);
  }
  for (const a of allAutonomyRows) {
    autonomyByHousehold.get(a.householdId)?.push(a);
  }
  for (const s of allSubscriptions) {
    subscriptionsByHousehold.get(s.householdId)?.push(s);
  }

  // Map over the households list (preserving createdAt asc order) and
  // delegate to the pure helper. No DB access inside the loop.
  const behaviours: HouseholdBehaviour[] = [];
  for (const household of households) {
    behaviours.push(
      computeBehaviourFromData({
        householdId: household.id,
        household,
        tasks: tasksByHousehold.get(household.id) ?? [],
        vouchers: vouchersByHousehold.get(household.id) ?? [],
        autonomyRows: autonomyByHousehold.get(household.id) ?? [],
        subscriptions: subscriptionsByHousehold.get(household.id) ?? [],
        config,
      }),
    );
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

/**
 * Detect cross-sell opportunities (households using category A that have
 * never tried category B).
 *
 * Fix 18 — `behaviours` is now an OPTIONAL parameter. When supplied,
 * the caller's already-computed array is reused (no second
 * `computeAllHouseholdBehaviours()` call). When omitted, the function
 * falls back to fetching fresh — preserving backwards compatibility
 * with any caller that hasn't been updated to pass behaviours through.
 *
 * The behaviour route now passes the same array it already computed
 * for its overview stats, so a single behaviour GET request triggers
 * exactly ONE `computeAllHouseholdBehaviours()` call instead of three
 * (one for the overview + one for cross-sell + one for any segment
 * preview triggered downstream).
 */
export async function detectCrossSellOpportunities(
  behaviours?: HouseholdBehaviour[],
): Promise<CrossSellOpportunity[]> {
  const list = behaviours ?? (await computeAllHouseholdBehaviours());
  const opportunities: CrossSellOpportunity[] = [];

  for (const from of ALL_CATEGORIES) {
    for (const to of ALL_CATEGORIES) {
      if (from === to) continue;
      const eligible = list.filter(
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
