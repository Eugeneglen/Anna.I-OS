import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { EscrowState } from "@prisma/client"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Verify vendor exists
    const vendor = await db.vendor.findUnique({
      where: { id },
      select: { id: true },
    })

    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
    }

    // Get all booking IDs for this vendor
    const vendorBookings = await db.booking.findMany({
      where: { vendorId: id },
      select: { id: true },
    })

    const bookingIds = vendorBookings.map((b) => b.id)

    // ── Total earned: sum of vendorPayoutCents from RELEASED escrow entries ──
    const releasedEntries = await db.escrowLedger.findMany({
      where: {
        bookingId: { in: bookingIds },
        state: EscrowState.RELEASED,
      },
      select: { vendorPayoutCents: true, bookingId: true },
    })

    const totalEarned = releasedEntries.reduce(
      (sum, e) => sum + e.vendorPayoutCents,
      0
    )

    // ── Pending payout: sum from HELD escrow entries ──
    const heldEntries = await db.escrowLedger.findMany({
      where: {
        bookingId: { in: bookingIds },
        state: EscrowState.HELD,
      },
      select: { vendorPayoutCents: true },
    })

    const pendingPayout = heldEntries.reduce(
      (sum, e) => sum + e.vendorPayoutCents,
      0
    )

    // ── Completed bookings count ──
    const totalCompleted = await db.booking.count({
      where: { vendorId: id, status: "completed" },
    })

    // ── Average rating ──
    const ratingAgg = await db.booking.aggregate({
      where: { vendorId: id, status: "completed", rating: { not: null } },
      _avg: { rating: true },
    })

    const averageRating = ratingAgg._avg.rating ?? 0

    // ── This month breakdown ──
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    // Completed bookings this month
    const thisMonthCompleted = await db.booking.count({
      where: {
        vendorId: id,
        status: "completed",
        completedAt: { gte: monthStart },
      },
    })

    // Earned this month (RELEASED escrow for bookings completed this month)
    const thisMonthCompletedBookingIds = (
      await db.booking.findMany({
        where: {
          vendorId: id,
          status: "completed",
          completedAt: { gte: monthStart },
        },
        select: { id: true },
      })
    ).map((b) => b.id)

    const thisMonthReleased = await db.escrowLedger.findMany({
      where: {
        bookingId: { in: thisMonthCompletedBookingIds },
        state: EscrowState.RELEASED,
      },
      select: { vendorPayoutCents: true },
    })

    const thisMonthEarned = thisMonthReleased.reduce(
      (sum, e) => sum + e.vendorPayoutCents,
      0
    )

    // Pending this month (HELD escrow for bookings completed this month)
    const thisMonthHeld = await db.escrowLedger.findMany({
      where: {
        bookingId: { in: thisMonthCompletedBookingIds },
        state: EscrowState.HELD,
      },
      select: { vendorPayoutCents: true },
    })

    const thisMonthPending = thisMonthHeld.reduce(
      (sum, e) => sum + e.vendorPayoutCents,
      0
    )

    // ── Recent 10 completed bookings with payout ──
    const recentBookings = await db.booking.findMany({
      where: { vendorId: id, status: "completed" },
      orderBy: { completedAt: "desc" },
      take: 10,
      include: {
        task: {
          select: {
            category: true,
            household: {
              select: { name: true, address: true },
            },
          },
        },
        escrowEntries: {
          select: { vendorPayoutCents: true, state: true },
        },
      },
    })

    const recent = recentBookings.map((b) => {
      const released = b.escrowEntries
        .filter((e) => e.state === EscrowState.RELEASED)
        .reduce((sum, e) => sum + e.vendorPayoutCents, 0)
      const held = b.escrowEntries
        .filter((e) => e.state === EscrowState.HELD)
        .reduce((sum, e) => sum + e.vendorPayoutCents, 0)

      return {
        id: b.id,
        category: b.task.category,
        householdName: b.task.household.name,
        address: b.task.household.address,
        completedAt: b.completedAt,
        rating: b.rating,
        payoutCents: released || held || 0,
        payoutState: released > 0 ? "released" : "held",
      }
    })

    return NextResponse.json({
      totalEarned,
      pendingPayout,
      totalCompleted,
      averageRating: Math.round(averageRating * 100) / 100,
      thisMonth: {
        earned: thisMonthEarned,
        completed: thisMonthCompleted,
        pending: thisMonthPending,
      },
      recent,
    })
  } catch (error) {
    console.error("GET /api/vendors/[id]/earnings error:", error)
    return NextResponse.json(
      { error: "Failed to fetch vendor earnings" },
      { status: 500 }
    )
  }
}