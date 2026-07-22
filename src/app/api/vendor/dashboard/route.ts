import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getVendorSession } from "@/lib/vendor-auth";
import { BookingStatus, TaskStatus, EscrowState } from "@prisma/client";

export async function GET() {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const vendorId = session.vendorId;
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    // Parallel queries for dashboard stats
    const [
      todayBookings,
      upcomingCount,
      activeCount,
      weekEarnings,
      monthEarnings,
      totalEarnings,
      totalCompleted,
      avgRatingResult,
      pendingEscrow,
    ] = await Promise.all([
      // Today's bookings
      db.booking.findMany({
        where: {
          vendorId,
          scheduledStart: { gte: todayStart },
          status: { not: "cancelled" },
        },
        include: {
          task: {
            select: {
              category: true,
              amountCents: true,
              instructions: true,
              household: { select: { name: true, address: true, unitNumber: true } },
            },
          },
          assignedStaff: { select: { id: true, name: true } },
        },
        orderBy: { scheduledStart: "asc" },
      }),

      // Count upcoming (assigned + accepted)
      db.booking.count({
        where: {
          vendorId,
          status: { in: ["assigned", "accepted"] },
        },
      }),

      // Count in progress
      db.booking.count({
        where: {
          vendorId,
          status: "in_progress",
        },
      }),

      // This week earnings (released escrow)
      db.escrowLedger.aggregate({
        where: {
          releasedAt: { gte: weekStart },
          state: EscrowState.RELEASED,
          booking: { vendorId },
        },
        _sum: { vendorPayoutCents: true },
      }),

      // This month earnings
      db.escrowLedger.aggregate({
        where: {
          releasedAt: { gte: monthStart },
          state: EscrowState.RELEASED,
          booking: { vendorId },
        },
        _sum: { vendorPayoutCents: true },
      }),

      // All time earnings
      db.escrowLedger.aggregate({
        where: {
          state: EscrowState.RELEASED,
          booking: { vendorId },
        },
        _sum: { vendorPayoutCents: true },
      }),

      // Total completed
      db.booking.count({
        where: {
          vendorId,
          status: "completed",
        },
      }),

      // Average rating
      db.booking.aggregate({
        where: {
          vendorId,
          status: "completed",
          rating: { not: null },
        },
        _avg: { rating: true },
      }),

      // Pending escrow (held)
      db.escrowLedger.aggregate({
        where: {
          state: EscrowState.HELD,
          booking: { vendorId },
        },
        _sum: { vendorPayoutCents: true },
      }),
    ]);

    const todayJobs = todayBookings.map((b) => ({
      id: b.id,
      status: b.status,
      category: b.task.category,
      amountCents: b.task.amountCents,
      instructions: b.task.instructions,
      scheduledStart: b.scheduledStart.toISOString(),
      scheduledEnd: b.scheduledEnd?.toISOString() ?? null,
      householdName: b.task.household.name,
      address: b.task.household.address,
      unitNumber: b.task.household.unitNumber,
      assignedStaff: b.assignedStaff ? { id: b.assignedStaff.id, name: b.assignedStaff.name } : null,
    }));

    return NextResponse.json({
      stats: {
        todayJobs: todayJobs.length,
        upcoming: upcomingCount,
        active: activeCount,
        totalCompleted,
        avgRating: avgRatingResult._avg.rating?.toFixed(1) ?? null,
        weekEarnings: weekEarnings._sum.vendorPayoutCents ?? 0,
        monthEarnings: monthEarnings._sum.vendorPayoutCents ?? 0,
        totalEarnings: totalEarnings._sum.vendorPayoutCents ?? 0,
        pendingPayout: pendingEscrow._sum.vendorPayoutCents ?? 0,
      },
      todayJobs,
    });
  } catch (error) {
    console.error("[/api/vendor/dashboard GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
