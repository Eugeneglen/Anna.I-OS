import { NextRequest, NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { computeAllHouseholdBehaviours, detectCrossSellOpportunities } from "@/lib/marketing/behaviour-engine";
import {
  checkRateLimit,
  opsRateKey,
  rateLimitResponsePayload,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { get, set, MARKETING_CACHE_KEYS } from "@/lib/cache";

// GET /api/ops/marketing/behaviour — aggregated behaviour analytics
//
// Fix 19 — server-side in-memory cache (60s TTL). The endpoint runs two
// expensive aggregates (`computeAllHouseholdBehaviours` + the cross-sell
// pass) on every call — without a cache, an ops dashboard auto-refresh
// loop pegs the DB even with the rate-limit guard. The cache is keyed
// globally (not per-user) because the underlying data is the same for
// every viewer. Mutations (campaign created, voucher issued, redemption
// applied, voucher expired) call `invalidateBehaviourCache()` to drop
// the entry so the next read fetches fresh data.
const BEHAVIOUR_CACHE_TTL_MS = 60_000;

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

    // ── Fix 17 — rate limit behaviour insights per ops user ──
    // 30 requests / minute. This endpoint runs two full-table scans
    // (computeAllHouseholdBehaviours + detectCrossSellOpportunities) on
    // every call, so an infinite-refresh loop pegs the DB. Auth +
    // permission checks first.
    const rlKey = opsRateKey(session.userId, "behaviour-insights");
    if (!checkRateLimit(rlKey, RATE_LIMITS.behaviourInsights.limit, RATE_LIMITS.behaviourInsights.windowMs)) {
      return NextResponse.json(rateLimitResponsePayload(rlKey), { status: 429 });
    }

    // ── Fix 19 — short-circuit on cache hit ──
    // Auth + permission + rate-limit checks still run on every request,
    // so cached responses stay access-controlled. Only the expensive
    // Prisma aggregates are skipped on a hit.
    const cached = get<unknown>(MARKETING_CACHE_KEYS.behaviour);
    if (cached !== null) {
      return NextResponse.json(cached);
    }

    // ── Fix 18 — compute behaviours ONCE and reuse for cross-sell ──
    // Previously this called computeAllHouseholdBehaviours() then
    // detectCrossSellOpportunities() (which internally called
    // computeAllHouseholdBehaviours() AGAIN). The batch refactor +
    // parameter pass-through means a single GET now does exactly ONE
    // constant-query aggregation pass instead of 3N×2.
    const behaviours = await computeAllHouseholdBehaviours();
    const crossSell = await detectCrossSellOpportunities(behaviours);

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

    const payload = {
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
      // Fix 14 — Never-Ordered drill-down. Surface the households with
      // 0 completed orders (capped to the first 200 for safety) so the
      // "Never Ordered" KPI card can show a dialog listing them without
      // making a second round-trip. Additive only — existing consumers
      // that don't read this field are unaffected.
      neverOrderedHouseholds: behaviours
        .filter((b) => b.totalOrders === 0)
        .slice(0, 200)
        .map((b) => ({ id: b.householdId, name: b.householdName || "Unnamed" })),
      rfmDistribution: rfmDist,
      lapseAnalysis,
      categoryUsage: catUsage,
      // ── Drill-down payload ──
      //
      // Surface per-household behaviour so the Insights tab can show
      // contextual drill-down dialogs (RFM segment members, churn risk
      // members, lifecycle stage members, lapse buckets, cross-sell
      // eligible households, KPI drill-downs for "Avg Orders / HH" and
      // "Avg Spend / HH"). This is ADDITIVE — every existing field on
      // the response keeps the same shape.
      //
      // We cap the array at 500 households to bound the JSON payload.
      // `behaviours` is already in createdAt-asc order from the
      // batched query — the frontend sorts as needed per dialog.
      households: behaviours.slice(0, 500).map((b) => ({
        id: b.householdId,
        name: b.householdName || "Unnamed",
        totalOrders: b.totalOrders,
        totalSpendCents: b.totalSpentCents,
        avgOrderValueCents: b.avgOrderValueCents,
        rfmSegment: b.rfmSegment,
        churnRisk: b.churnRisk,
        lifecycleStage: b.lifecycleStage,
        lastOrderAt: b.lastOrderAt ? b.lastOrderAt.toISOString() : null,
        daysSinceLastOrder: b.daysSinceLastOrder,
        categoriesUsed: b.categoriesUsed,
      })),
      // Fix 14 — additive `householdIds` per cross-sell row so the
      // Insights tab can drill into the exact eligible households
      // without re-running the cross-sell detection client-side.
      crossSellOpportunities: crossSell.slice(0, 5).map((o) => ({
        from: o.from,
        to: o.to,
        eligibleHouseholds: o.eligibleHouseholds,
        householdIds: o.householdIds,
      })),
      churnRisk,
      lifecycleStages: lifecycle,
      insights,
    };

    // Cache the computed payload (60s TTL). Mutations invalidate via
    // invalidateBehaviourCache() — see campaign-service.ts +
    // voucher-engine.ts.
    set(MARKETING_CACHE_KEYS.behaviour, payload, BEHAVIOUR_CACHE_TTL_MS);

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[/api/ops/marketing/behaviour GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
