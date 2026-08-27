/**
 * AI Insight Engine
 * =================
 * Generates actionable marketing recommendations from behaviour analytics.
 * Scans all households + produces prioritised insights with suggested actions.
 */

import { computeAllHouseholdBehaviours, detectCrossSellOpportunities, type HouseholdBehaviour } from "./behaviour-engine";
import type { SegmentFilters } from "./segment-engine";

// ── Types ──

export interface MarketingInsight {
  type: "REACTIVATION" | "CROSS_SELL" | "UPSELL" | "FREQUENCY" | "CHURN_PREVENTION" | "LOYALTY" | "NEW_SERVICE";
  title: string;
  detail: string;
  householdIds: string[];
  priority: "HIGH" | "MEDIUM" | "LOW";
  recommendedAction: {
    campaignType: string;
    discountType: string;
    discountValue: number;
    targetCategory?: string;
    segmentFilters: SegmentFilters;
  };
  estimatedImpact: {
    potentialOrders: number;
    potentialRevenueCents: number;
    potentialDiscountCents: number;
    estimatedROI: number;
  };
}

// ── Generate all insights ──

export async function generateInsights(): Promise<MarketingInsight[]> {
  const behaviours = await computeAllHouseholdBehaviours();
  const crossSell = await detectCrossSellOpportunities();

  const insights: MarketingInsight[] = [];

  // 1. Reactivation
  insights.push(...generateReactivationInsights(behaviours));

  // 2. Cross-sell
  insights.push(...generateCrossSellInsights(crossSell));

  // 3. Churn prevention
  insights.push(...generateChurnPreventionInsights(behaviours));

  // 4. Loyalty rewards
  insights.push(...generateLoyaltyInsights(behaviours));

  // 5. New customer follow-up
  insights.push(...generateNewCustomerInsights(behaviours));

  // Sort by priority
  const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  insights.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return insights;
}

// ── Reactivation insights ──

function generateReactivationInsights(behaviours: HouseholdBehaviour[]): MarketingInsight[] {
  const lapsed = behaviours.filter(
    (b) => b.daysSinceLastOrder !== null && b.daysSinceLastOrder > 90 && b.totalOrders >= 1,
  );

  if (lapsed.length === 0) return [];

  const totalPrevSpend = lapsed.reduce((s, b) => s + b.totalSpentCents, 0);
  const potentialOrders = lapsed.length;
  const potentialRevenueCents = Math.round(totalPrevSpend * 0.3); // assume 30% reactivation rate
  const discountValue = 10; // $10 off
  const potentialDiscountCents = potentialOrders * discountValue * 100;

  return [{
    type: "REACTIVATION",
    title: `${lapsed.length} household${lapsed.length > 1 ? "s" : ""} haven't ordered in 90+ days`,
    detail: lapsed.length === 1
      ? `Last order was ${lapsed[0].daysSinceLastOrder} days ago. Previously ordered ${lapsed[0].totalOrders} time(s) totaling $${(lapsed[0].totalSpentCents / 100).toFixed(2)}. A reactivation voucher could win them back.`
      : `${lapsed.length} households haven't ordered in 90+ days. They previously ordered ${lapsed.reduce((s, b) => s + b.totalOrders, 0)} times totaling $${(totalPrevSpend / 100).toFixed(2)}. A reactivation campaign could recover ~30% of them.`,
    householdIds: lapsed.map((b) => b.householdId),
    priority: "HIGH",
    recommendedAction: {
      campaignType: "PUBLIC_PROMO",
      discountType: "FIXED_AMOUNT",
      discountValue,
      segmentFilters: { lastOrderDaysMin: 90, minOrders: 1 },
    },
    estimatedImpact: {
      potentialOrders,
      potentialRevenueCents,
      potentialDiscountCents,
      estimatedROI: potentialDiscountCents > 0 ? Math.round((potentialRevenueCents / potentialDiscountCents) * 10) / 10 : 0,
    },
  }];
}

// ── Cross-sell insights ──

function generateCrossSellInsights(
  crossSell: Array<{ from: string; to: string; eligibleHouseholds: number; householdIds: string[] }>,
): MarketingInsight[] {
  return crossSell.slice(0, 3).map((opp) => ({
    type: "CROSS_SELL" as const,
    title: `${opp.eligibleHouseholds} household${opp.eligibleHouseholds > 1 ? "s" : ""} use ${opp.from} but never tried ${opp.to}`,
    detail: `These households regularly book ${opp.from} but have never tried ${opp.to}. A targeted ${opp.to} voucher could introduce them to a new service.`,
    householdIds: opp.householdIds,
    priority: "MEDIUM" as const,
    recommendedAction: {
      campaignType: "CROSS_SELL",
      discountType: "PERCENTAGE",
      discountValue: 15,
      targetCategory: opp.to,
      segmentFilters: { categoriesUsed: [opp.from], categoriesNeverTried: [opp.to] },
    },
    estimatedImpact: {
      potentialOrders: Math.max(1, Math.round(opp.eligibleHouseholds * 0.2)),
      potentialRevenueCents: opp.eligibleHouseholds * 5000, // assume $50 avg order
      potentialDiscountCents: opp.eligibleHouseholds * 750, // 15% of $50
      estimatedROI: 6.7,
    },
  }));
}

// ── Churn prevention insights ──

function generateChurnPreventionInsights(behaviours: HouseholdBehaviour[]): MarketingInsight[] {
  const atRisk = behaviours.filter((b) => b.churnRisk === "HIGH" || b.churnRisk === "CRITICAL");

  if (atRisk.length === 0) return [];

  return [{
    type: "CHURN_PREVENTION",
    title: `${atRisk.length} household${atRisk.length > 1 ? "s" : ""} at ${atRisk[0].churnRisk} churn risk`,
    detail: `These customers show declining order frequency or haven't ordered in 60+ days. A retention voucher (no minimum spend, 30-day expiry) could prevent churn.`,
    householdIds: atRisk.map((b) => b.householdId),
    priority: "HIGH",
    recommendedAction: {
      campaignType: "PUBLIC_PROMO",
      discountType: "FIXED_AMOUNT",
      discountValue: 5,
      segmentFilters: { churnRisk: ["HIGH", "CRITICAL"] },
    },
    estimatedImpact: {
      potentialOrders: Math.max(1, Math.round(atRisk.length * 0.4)),
      potentialRevenueCents: atRisk.length * 4000,
      potentialDiscountCents: atRisk.length * 500,
      estimatedROI: 8.0,
    },
  }];
}

// ── Loyalty insights ──

function generateLoyaltyInsights(behaviours: HouseholdBehaviour[]): MarketingInsight[] {
  const champions = behaviours.filter((b) => b.rfmSegment === "Champions" || (b.totalOrders >= 5 && b.totalSpentCents >= 30000));

  if (champions.length === 0) return [];

  return [{
    type: "LOYALTY",
    title: `${champions.length} champion household${champions.length > 1 ? "s" : ""} deserve a reward`,
    detail: `These customers have ordered ${champions.reduce((s, b) => s + b.totalOrders, 0)} times totaling $${(champions.reduce((s, b) => s + b.totalSpentCents, 0) / 100).toFixed(2)}. A loyalty voucher would reinforce their relationship.`,
    householdIds: champions.map((b) => b.householdId),
    priority: "LOW",
    recommendedAction: {
      campaignType: "UPGRADE",
      discountType: "FIXED_AMOUNT",
      discountValue: 15,
      segmentFilters: { minOrders: 5, minTotalSpendCents: 30000 },
    },
    estimatedImpact: {
      potentialOrders: champions.length,
      potentialRevenueCents: champions.length * 8000,
      potentialDiscountCents: champions.length * 1500,
      estimatedROI: 5.3,
    },
  }];
}

// ── New customer insights ──

function generateNewCustomerInsights(behaviours: HouseholdBehaviour[]): MarketingInsight[] {
  const newCustomers = behaviours.filter(
    (b) => b.totalOrders === 1 && b.daysSinceLastOrder !== null && b.daysSinceLastOrder <= 30,
  );

  if (newCustomers.length === 0) return [];

  return [{
    type: "NEW_SERVICE",
    title: `${newCustomers.length} household${newCustomers.length > 1 ? "s" : ""} completed their first order recently`,
    detail: `These customers just placed their first order. A "welcome back" voucher (10% off next order, 30-day expiry) would encourage a second purchase and build the habit loop.`,
    householdIds: newCustomers.map((b) => b.householdId),
    priority: "MEDIUM",
    recommendedAction: {
      campaignType: "FIRST_TIME",
      discountType: "PERCENTAGE",
      discountValue: 10,
      segmentFilters: { minOrders: 1, maxOrders: 1 },
    },
    estimatedImpact: {
      potentialOrders: Math.max(1, Math.round(newCustomers.length * 0.5)),
      potentialRevenueCents: newCustomers.length * 4000,
      potentialDiscountCents: newCustomers.length * 400,
      estimatedROI: 10.0,
    },
  }];
}
