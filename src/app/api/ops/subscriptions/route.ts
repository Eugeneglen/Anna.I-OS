import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession, hasMinRole } from "@/lib/ops-auth";

// ── GET /api/ops/subscriptions ──
// Ops listing of all subscriptions with household info, stats, filters
export async function GET(req: NextRequest) {
  const session = await getOpsSession();
  if (!session || !hasMinRole(session.role, "COORDINATOR")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const tier = searchParams.get("tier");       // HOME | CARE
  const status = searchParams.get("status");    // ACTIVE | CANCELLED | PAST_DUE
  const search = searchParams.get("search");    // household name or email
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 50);

  try {
    // Build where clause
    const where: Record<string, unknown> = {};
    if (tier) where.tier = tier;
    if (status) where.status = status;
    if (search) {
      where.household = {
        OR: [
          { name: { contains: search } },
          { email: { contains: search } },
        ],
      };
    }

    // Count for pagination
    const total = await db.subscription.count({ where });

    // Fetch subscriptions with household data
    const subscriptions = await db.subscription.findMany({
      where,
      include: {
        household: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            postalCode: true,
            activeCategories: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Enrich with per-household stats (task count, total spend)
    const enriched = await Promise.all(
      subscriptions.map(async (sub) => {
        const [taskCount, totalSpend] = await Promise.all([
          db.task.count({
            where: {
              householdId: sub.householdId,
              status: { in: ["COMPLETED", "VERIFIED", "ESCROW_RELEASED"] },
            },
          }),
          db.escrowLedger.aggregate({
            where: {
              task: { householdId: sub.householdId },
              state: "RELEASED",
            },
            _sum: { amountCents: true },
          }),
        ]);

        return {
          id: sub.id,
          householdId: sub.householdId,
          tier: sub.tier,
          status: sub.status,
          priceCents: sub.priceCents,
          billingCycleStart: sub.billingCycleStart,
          billingCycleEnd: sub.billingCycleEnd,
          nextBillingDate: sub.nextBillingDate,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          createdAt: sub.createdAt,
          updatedAt: sub.updatedAt,
          household: sub.household,
          stats: {
            completedTasks: taskCount,
            totalSpendCents: totalSpend._sum.amountCents || 0,
          },
        };
      })
    );

    // Summary KPIs
    const [activeCount, careCount, homeCount, mrrResult] = await Promise.all([
      db.subscription.count({ where: { status: "ACTIVE" } }),
      db.subscription.count({ where: { status: "ACTIVE", tier: "CARE" } }),
      db.subscription.count({ where: { status: "ACTIVE", tier: "HOME" } }),
      db.subscription.aggregate({
        where: { status: "ACTIVE" },
        _sum: { priceCents: true },
      }),
    ]);

    return NextResponse.json({
      subscriptions: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        totalActive: activeCount,
        activeHome: homeCount,
        activeCare: careCount,
        totalMrrCents: mrrResult._sum.priceCents || 0,
      },
    });
  } catch (error) {
    console.error("[OPS Subscriptions GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
