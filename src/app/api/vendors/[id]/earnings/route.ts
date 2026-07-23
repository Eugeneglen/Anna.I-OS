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

    // ── CHART DATA: Category breakdown (all-time) ──
    const categoryBookings = await db.booking.findMany({
      where: { vendorId: id, status: "completed" },
      include: {
        task: { select: { category: true } },
        escrowEntries: {
          select: { vendorPayoutCents: true, state: true, commissionCents: true },
        },
      },
    })

    const categoryMap = new Map<string, { earned: number; commission: number; count: number }>()

    for (const booking of categoryBookings) {
      const category = booking.task.category
      const existing = categoryMap.get(category) || { earned: 0, commission: 0, count: 0 }

      for (const entry of booking.escrowEntries) {
        if (entry.state === EscrowState.RELEASED) {
          existing.earned += entry.vendorPayoutCents
          existing.commission += entry.commissionCents
        }
      }
      existing.count += 1
      categoryMap.set(category, existing)
    }

    const byCategory = Array.from(categoryMap.entries()).map(([category, data]) => ({
      category,
      earned: data.earned,
      commission: data.commission,
      count: data.count,
    })).sort((a, b) => b.earned - a.earned)

    // ── CHART DATA: Weekly earnings trend (last 12 weeks) ──
    const twelveWeeksAgo = new Date(now)
    twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84)
    twelveWeeksAgo.setHours(0, 0, 0, 0)

    const weeklyCompletedBookings = await db.booking.findMany({
      where: {
        vendorId: id,
        status: "completed",
        completedAt: { gte: twelveWeeksAgo },
      },
      include: {
        escrowEntries: {
          select: { vendorPayoutCents: true, state: true },
        },
      },
      orderBy: { completedAt: "asc" },
    })

    // Group by ISO week
    const weekMap = new Map<string, { earned: number; jobs: number; weekStart: string }>()

    // Initialize empty weeks
    for (let w = 11; w >= 0; w--) {
      const d = new Date(now)
      d.setDate(d.getDate() - w * 7)
      // Find Monday of that week
      const day = d.getDay()
      const monday = new Date(d)
      monday.setDate(d.getDate() - ((day + 6) % 7))
      monday.setHours(0, 0, 0, 0)
      const key = monday.toISOString().slice(0, 10)
      weekMap.set(key, { earned: 0, jobs: 0, weekStart: key })
    }

    for (const booking of weeklyCompletedBookings) {
      if (!booking.completedAt) continue
      const completed = new Date(booking.completedAt)
      const day = completed.getDay()
      const monday = new Date(completed)
      monday.setDate(completed.getDate() - ((day + 6) % 7))
      monday.setHours(0, 0, 0, 0)
      const key = monday.toISOString().slice(0, 10)

      const existing = weekMap.get(key) || { earned: 0, jobs: 0, weekStart: key }
      for (const entry of booking.escrowEntries) {
        if (entry.state === EscrowState.RELEASED) {
          existing.earned += entry.vendorPayoutCents
        }
      }
      existing.jobs += 1
      weekMap.set(key, existing)
    }

    const weeklyTrend = Array.from(weekMap.values()).map((w) => ({
      week: w.weekStart,
      earned: w.earned,
      jobs: w.jobs,
    }))

    // ── CHART DATA: Payout state distribution ──
    const allEscrowEntries = await db.escrowLedger.findMany({
      where: { bookingId: { in: bookingIds } },
      select: { state: true, vendorPayoutCents: true, commissionCents: true, amountCents: true },
    })

    const payoutDistribution: { state: string; payoutCents: number; commissionCents: number; count: number }[] = []
    const payoutStates: EscrowState[] = [EscrowState.HELD, EscrowState.RELEASED, EscrowState.DISPUTED, EscrowState.REFUNDED]
    for (const state of payoutStates) {
      const entries = allEscrowEntries.filter((e) => e.state === state)
      if (entries.length === 0) continue
      payoutDistribution.push({
        state,
        payoutCents: entries.reduce((s, e) => s + e.vendorPayoutCents, 0),
        commissionCents: entries.reduce((s, e) => s + e.commissionCents, 0),
        count: entries.length,
      })
    }

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
      charts: {
        byCategory,
        weeklyTrend,
        payoutDistribution,
      },
    })
  } catch (error) {
    console.error("[earnings] Error:", error instanceof Error ? error.message + "\n" + error.stack : error)
    return NextResponse.json(
      { error: "Failed to fetch vendor earnings" },
      { status: 500 }
    )
  }
}
