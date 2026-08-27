import { NextRequest, NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { computeAllHouseholdBehaviours, detectCrossSellOpportunities } from "@/lib/marketing/behaviour-engine";

// GET /api/ops/marketing/behaviour — aggregated behaviour analytics
export async function GET(_req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await hasPermission(session, "marketing", "view");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const behaviours = await computeAllHouseholdBehaviours();
    const crossSell = await detectCrossSellOpportunities();

    // Overview
    const total = behaviours.length;
    const activeCustomers = behaviours.filter((b) => b.daysSinceLastOrder !== null && b.daysSinceLastOrder <= 30).length;
    const lapsedCustomers = behaviours.filter((b) => b.daysSinceLastOrder !== null && b.daysSinceLastOrder > 90).length;
    const newCustomers = behaviours.filter((b) => b.totalOrders === 1 && b.daysSinceLastOrder !== null && b.daysSinceLastOrder <= 30).length;
    const neverOrdered = behaviours.filter((b) => b.totalOrders === 0).length;
    const avgOrders = total > 0 ? behaviours.reduce((s, b) => s + b.totalOrders, 0) / total : 0;
    const avgSpend = total > 0 ? behaviours.reduce((s, b) => s + b.totalSpentCents, 0) / total : 0;
    const totalRevenue = behaviours.reduce((s, b) => s + b.totalSpentCents, 0);

    // RFM distribution
    const rfmDist: Record<string, number> = {};
    for (const b of behaviours) {
      rfmDist[b.rfmSegment] = (rfmDist[b.rfmSegment] || 0) + 1;
    }

    // Lapse analysis
    const lapseAnalysis = {
      "30days": behaviours.filter((b) => b.daysSinceLastOrder !== null && b.daysSinceLastOrder > 30).length,
      "60days": behaviours.filter((b) => b.daysSinceLastOrder !== null && b.daysSinceLastOrder > 60).length,
      "90days": behaviours.filter((b) => b.daysSinceLastOrder !== null && b.daysSinceLastOrder > 90).length,
      "180days": behaviours.filter((b) => b.daysSinceLastOrder !== null && b.daysSinceLastOrder > 180).length,
    };

    // Category usage
    const catUsage: Record<string, number> = {};
    for (const b of behaviours) {
      for (const c of b.categoriesUsed) {
        catUsage[c] = (catUsage[c] || 0) + 1;
      }
    }

    // Churn risk
    const churnRisk = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    for (const b of behaviours) {
      churnRisk[b.churnRisk]++;
    }

    // Lifecycle stages
    const lifecycle: Record<string, number> = {};
    for (const b of behaviours) {
      lifecycle[b.lifecycleStage] = (lifecycle[b.lifecycleStage] || 0) + 1;
    }

    // Insights
    const insights: Array<{
      type: string;
      title: string;
      detail: string;
      householdIds: string[];
      priority: string;
    }> = [];

    // Reactivation insight
    const lapsedWithHistory = behaviours.filter(
      (b) => b.daysSinceLastOrder !== null && b.daysSinceLastOrder > 90 && b.totalOrders >= 1,
    );
    if (lapsedWithHistory.length > 0) {
      insights.push({
        type: "REACTIVATION",
        title: `${lapsedWithHistory.length} household${lapsedWithHistory.length > 1 ? "s" : ""} haven't ordered in 90+ days`,
        detail: lapsedWithHistory.length === 1
          ? `${lapsedWithHistory[0].householdId.slice(-8)} last ordered ${lapsedWithHistory[0].daysSinceLastOrder} days ago. Previously ordered ${lapsedWithHistory[0].totalOrders} time(s) totaling $${(lapsedWithHistory[0].totalSpentCents / 100).toFixed(2)}. Consider a reactivation voucher.`
          : `${lapsedWithHistory.length} households haven't ordered in 90+ days. Consider a reactivation campaign with a limited-time voucher.`,
        householdIds: lapsedWithHistory.map((b) => b.householdId),
        priority: "HIGH",
      });
    }

    // Cross-sell insight
    if (crossSell.length > 0) {
      const top = crossSell[0];
      insights.push({
        type: "CROSS_SELL",
        title: `${top.eligibleHouseholds} household${top.eligibleHouseholds > 1 ? "s" : ""} use ${top.from} but never tried ${top.to}`,
        detail: `A ${top.to.toLowerCase()} voucher could be tested against this segment.`,
        householdIds: top.householdIds,
        priority: "MEDIUM",
      });
    }

    // Churn prevention
    const atRisk = behaviours.filter((b) => b.churnRisk === "HIGH" || b.churnRisk === "CRITICAL");
    if (atRisk.length > 0) {
      insights.push({
        type: "CHURN_PREVENTION",
        title: `${atRisk.length} household${atRisk.length > 1 ? "s" : ""} at ${atRisk[0].churnRisk} churn risk`,
        detail: `Consider a retention voucher for these at-risk customers.`,
        householdIds: atRisk.map((b) => b.householdId),
        priority: "HIGH",
      });
    }

    return NextResponse.json({
      overview: {
        totalHouseholds: total,
        activeCustomers,
        lapsedCustomers,
        newCustomers,
        neverOrdered,
        avgOrdersPerHousehold: Math.round(avgOrders * 10) / 10,
        avgSpendPerHouseholdCents: Math.round(avgSpend),
        totalRevenueCents: totalRevenue,
      },
      rfmDistribution: rfmDist,
      lapseAnalysis,
      categoryUsage: catUsage,
      crossSellOpportunities: crossSell.slice(0, 5).map((o) => ({
        from: o.from,
        to: o.to,
        eligibleHouseholds: o.eligibleHouseholds,
      })),
      churnRisk,
      lifecycleStages: lifecycle,
      insights,
    });
  } catch (error) {
    console.error("[/api/ops/marketing/behaviour GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
