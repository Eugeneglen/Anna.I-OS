import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Run all independent queries in parallel
    const [
      householdCount,
      activeVendorCount,
      tasksThisMonth,
      allTasks,
      allBookings,
      escrowHeld,
      tasksByStatus,
      tasksByCategory,
      activeAnomalies,
      vendorPerformance,
      recentTasks,
      subscriptionsByTier,
    ] = await Promise.all([
      // 1. Total households
      db.household.count(),

      // 2. Active vendors
      db.vendor.count({ where: { status: "ACTIVE" } }),

      // 3. Tasks created this month
      db.task.count({
        where: { createdAt: { gte: monthStart } },
      }),

      // 4. All tasks (for completion rate)
      db.task.findMany({
        select: { status: true, category: true, createdAt: true, amountCents: true },
      }),

      // 5. All bookings (for avg rating)
      db.booking.findMany({
        select: { rating: true, status: true, vendorId: true, createdAt: true },
      }),

      // 6. Total escrow held (in cents)
      db.escrowLedger.aggregate({
        _sum: { amountCents: true },
        where: { state: "HELD" },
      }),

      // 7. Tasks by status
      db.task.groupBy({
        by: ["status"],
        _count: { status: true },
      }),

      // 8. Tasks by category
      db.task.groupBy({
        by: ["category"],
        _count: { category: true },
      }),

      // 9. Active anomalies
      db.anomaly.findMany({
        where: { status: { in: ["ACTIVE", "ACKNOWLEDGED"] } },
        select: { id: true, type: true, severity: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),

      // 10. Vendor performance (top 10 by completed bookings)
      db.booking.groupBy({
        by: ["vendorId"],
        where: { status: "completed" },
        _count: { id: true },
        _avg: { rating: true },
        orderBy: { _count: { id: "desc" } },
        take: 10,
      }),

      // 11. Recent 10 tasks for activity feed
      db.task.findMany({
        select: {
          id: true,
          category: true,
          status: true,
          amountCents: true,
          createdAt: true,
          household: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),

      // 12. Subscriptions by tier
      db.subscription.groupBy({
        by: ["tier"],
        where: { status: "ACTIVE" },
        _count: { tier: true },
      }),
    ]);

    // Derive metrics
    const completedTasks = allTasks.filter(
      (t) =>
        t.status === "COMPLETED" ||
        t.status === "VERIFIED" ||
        t.status === "ESCROW_RELEASED"
    ).length;
    const totalRated = allBookings.filter((b) => b.rating !== null);
    const avgRating =
      totalRated.length > 0
        ? (
            totalRated.reduce((s, b) => s + (b.rating as number), 0) /
            totalRated.length
          ).toFixed(1)
        : "0.0";

    const completionRate =
      allTasks.length > 0
        ? ((completedTasks / allTasks.length) * 100).toFixed(1)
        : "0.0";

    const revenueThisMonth = allTasks
      .filter(
        (t) =>
          t.createdAt >= monthStart &&
          (t.status === "COMPLETED" ||
            t.status === "VERIFIED" ||
            t.status === "ESCROW_RELEASED")
      )
      .reduce((s, t) => s + (t.amountCents || 0), 0);

    // Anomaly severity counts
    const anomalySeverityCounts: Record<string, number> = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
    };
    for (const a of activeAnomalies) {
      anomalySeverityCounts[a.severity] =
        (anomalySeverityCounts[a.severity] || 0) + 1;
    }

    // Vendor names lookup
    const vendorIds = vendorPerformance.map((v) => v.vendorId);
    const vendorNames = vendorIds.length
      ? await db.vendor
          .findMany({
            where: { id: { in: vendorIds } },
            select: { id: true, name: true },
          })
          .then((vs) =>
            Object.fromEntries(vs.map((v) => [v.id, v.name]))
          )
      : {};

    return NextResponse.json({
      kpis: {
        householdCount,
        activeVendorCount,
        tasksThisMonth,
        completionRate: parseFloat(completionRate),
        avgRating: parseFloat(avgRating),
        escrowHeldCents: escrowHeld._sum.amountCents || 0,
        revenueThisMonthCents: revenueThisMonth,
        activeAnomalyCount: activeAnomalies.length,
      },
      tasksByStatus: tasksByStatus.map((s) => ({
        status: s.status,
        count: s._count.status,
      })),
      tasksByCategory: tasksByCategory.map((c) => ({
        category: c.category,
        count: c._count.category,
      })),
      subscriptionsByTier: subscriptionsByTier.map((s) => ({
        tier: s.tier,
        count: s._count.tier,
      })),
      vendorPerformance: vendorPerformance.map((v) => ({
        vendorId: v.vendorId,
        vendorName: vendorNames[v.vendorId] || "Unknown",
        completedBookings: v._count.id,
        avgRating: v._avg.rating ? parseFloat(v._avg.rating.toFixed(1)) : null,
      })),
      recentTasks,
      anomalies: activeAnomalies,
      anomalySeverityCounts,
    });
  } catch (error) {
    console.error("[/api/ops/analytics GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}