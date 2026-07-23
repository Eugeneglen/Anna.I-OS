import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(monthStart.getTime() - 1);

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
      tasksLast30Days,
      bookingsLast30Days,
      tasksPrevMonthCount,
      tasksPrevMonth,
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

      // 13. Tasks created in last 30 days (for daily chart)
      db.task.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true, status: true, amountCents: true, category: true },
      }),

      // 14. Bookings in last 30 days (for vendor utilization chart)
      db.booking.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { vendorId: true, status: true, createdAt: true },
      }),

      // 15. Tasks previous month (for KPI comparison)
      db.task.count({
        where: { createdAt: { gte: prevMonthStart, lt: monthStart } },
      }),

      // 16. Revenue previous month
      db.task.findMany({
        where: {
          createdAt: { gte: prevMonthStart, lt: monthStart },
          status: { in: ["COMPLETED", "VERIFIED", "ESCROW_RELEASED"] },
        },
        select: { amountCents: true },
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

    // ── CHART DATA: Daily trend (last 30 days) ──
    const dailyMap = new Map<string, { date: string; tasksCreated: number; revenueCents: number; tasksCompleted: number }>();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const key = d.toISOString().slice(0, 10);
      dailyMap.set(key, { date: key, tasksCreated: 0, revenueCents: 0, tasksCompleted: 0 });
    }
    for (const t of tasksLast30Days) {
      const key = t.createdAt.toISOString().slice(0, 10);
      const entry = dailyMap.get(key);
      if (entry) {
        entry.tasksCreated++;
        if (t.status === "COMPLETED" || t.status === "VERIFIED" || t.status === "ESCROW_RELEASED") {
          entry.revenueCents += t.amountCents || 0;
          entry.tasksCompleted++;
        }
      }
    }
    const dailyTrend = Array.from(dailyMap.values());

    // ── CHART DATA: Vendor utilization (last 30 days) ──
    const vendorUtilMap = new Map<string, { vendorId: string; vendorName: string; total: number; completed: number; inProgress: number; cancelled: number }>();
    for (const b of bookingsLast30Days) {
      const entry = vendorUtilMap.get(b.vendorId) || { vendorId: b.vendorId, vendorName: "", total: 0, completed: 0, inProgress: 0, cancelled: 0 };
      entry.total++;
      if (b.status === "completed") entry.completed++;
      else if (b.status === "in_progress") entry.inProgress++;
      else if (b.status === "cancelled") entry.cancelled++;
      vendorUtilMap.set(b.vendorId, entry);
    }
    const vendorUtilization = Array.from(vendorUtilMap.values()).sort((a, b) => b.total - a.total);
    const utilVendorIds = vendorUtilization.map((v) => v.vendorId);
    if (utilVendorIds.length) {
      const utilNames = Object.fromEntries(
        (await db.vendor.findMany({ where: { id: { in: utilVendorIds } }, select: { id: true, name: true } }))
          .map((v) => [v.id, v.name])
      );
      for (const v of vendorUtilization) v.vendorName = utilNames[v.vendorId] || "Unknown";
    }

    // ── CHART DATA: Category revenue breakdown (all-time completed tasks) ──
    const categoryRevenueMap = new Map<string, { category: string; revenueCents: number; count: number }>();
    for (const t of allTasks) {
      if (t.status !== "COMPLETED" && t.status !== "VERIFIED" && t.status !== "ESCROW_RELEASED") continue;
      const entry = categoryRevenueMap.get(t.category) || { category: t.category, revenueCents: 0, count: 0 };
      entry.revenueCents += t.amountCents || 0;
      entry.count++;
      categoryRevenueMap.set(t.category, entry);
    }
    const categoryBreakdown = Array.from(categoryRevenueMap.values()).sort((a, b) => b.revenueCents - a.revenueCents);

    // ── CHART DATA: Day-of-week pattern (all-time bookings) ──
    const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const dowMap = new Map<number, { day: string; dayIndex: number; tasks: number; bookings: number; revenueCents: number }>();
    for (let i = 0; i < 7; i++) {
      dowMap.set(i, { day: DAYS[i], dayIndex: i, tasks: 0, bookings: 0, revenueCents: 0 });
    }
    for (const t of allTasks) {
      const dow = t.createdAt.getDay();
      const jsDow = dow === 0 ? 6 : dow - 1; // Convert Sun=0 to Mon=0 index
      const entry = dowMap.get(jsDow)!;
      entry.tasks++;
      if (t.status === "COMPLETED" || t.status === "VERIFIED" || t.status === "ESCROW_RELEASED") {
        entry.revenueCents += t.amountCents || 0;
      }
    }
    for (const b of allBookings) {
      const dow = b.createdAt.getDay();
      const jsDow = dow === 0 ? 6 : dow - 1;
      dowMap.get(jsDow)!.bookings++;
    }
    const dayOfWeekPattern = Array.from(dowMap.values()).sort((a, b) => a.dayIndex - b.dayIndex);

    // ── CHART DATA: Weekly completion trend (last 12 weeks) ──
    const twelveWeeksAgo = new Date(now);
    twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84);
    twelveWeeksAgo.setHours(0, 0, 0, 0);
    const weekMap = new Map<string, { week: string; created: number; completed: number }>();
    for (let w = 11; w >= 0; w--) {
      const d = new Date(now);
      d.setDate(d.getDate() - w * 7);
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      monday.setHours(0, 0, 0, 0);
      const key = monday.toISOString().slice(0, 10);
      weekMap.set(key, { week: key, created: 0, completed: 0 });
    }
    for (const t of allTasks) {
      if (t.createdAt < twelveWeeksAgo) continue;
      const day = t.createdAt.getDay();
      const monday = new Date(t.createdAt);
      monday.setDate(t.createdAt.getDate() - ((day + 6) % 7));
      monday.setHours(0, 0, 0, 0);
      const key = monday.toISOString().slice(0, 10);
      const entry = weekMap.get(key);
      if (entry) {
        entry.created++;
        if (t.status === "COMPLETED" || t.status === "VERIFIED" || t.status === "ESCROW_RELEASED") {
          entry.completed++;
        }
      }
    }
    const completionTrend = Array.from(weekMap.values());

    // ── KPI COMPARISON: previous month ──
    const revenuePrevMonth = tasksPrevMonth.reduce((s, t) => s + (t.amountCents || 0), 0);
    const tasksChange = tasksPrevMonthCount > 0 ? ((tasksThisMonth - tasksPrevMonthCount) / tasksPrevMonthCount) * 100 : null;
    const revenueChange = revenuePrevMonth > 0 ? ((revenueThisMonth - revenuePrevMonth) / revenuePrevMonth) * 100 : null;

    return NextResponse.json({
      kpis: {
        householdCount,
        activeVendorCount,
        tasksThisMonth,
        tasksThisMonthChange: tasksChange !== null ? parseFloat(tasksChange.toFixed(1)) : null,
        completionRate: parseFloat(completionRate),
        avgRating: parseFloat(avgRating),
        escrowHeldCents: escrowHeld._sum.amountCents || 0,
        revenueThisMonthCents: revenueThisMonth,
        revenueThisMonthChange: revenueChange !== null ? parseFloat(revenueChange.toFixed(1)) : null,
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
      charts: {
        dailyTrend,
        vendorUtilization,
        categoryBreakdown,
        dayOfWeekPattern,
        completionTrend,
      },
    });
  } catch (error) {
    console.error("[/api/ops/analytics GET]", error instanceof Error ? error.message + "\n" + error.stack : String(error));
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
