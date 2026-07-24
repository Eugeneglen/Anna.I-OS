import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { TaskStatus, VendorStatus, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client"
import { autoSelectVendor } from "@/lib/routing"
import { triggerAnomalyDetection } from "@/lib/notify"
import { emitTaskStatusChanged, emitBookingStatusChanged } from "@/lib/events"
import { VENDOR_ACCEPTANCE_TIMEOUT_MINUTES, MAX_MATCH_ATTEMPTS } from "@/lib/constants"

const matchSchema = z.object({
  vendorId: z.string().min(1).optional(),
  scheduledStart: z.string().transform((v) => new Date(v)).optional(),
  scheduledEnd: z.string().transform((v) => new Date(v)).optional(),
})

/**
 * POST /api/tasks/[id]/dispatch — Initiate vendor matching.
 * Backward-compatible route name; now implements the MATCHING flow.
 *
 * Flow: CREATED → MATCHING (creates tentative booking, escrow NOT held yet)
 * On vendor rejection: stays MATCHING → auto-re-routes to next vendor
 * On vendor acceptance: MATCHING → ACCEPTED (+ escrow held)
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const parsed = matchSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      )
    }

    const { scheduledStart, scheduledEnd } = parsed.data

    // Validate task exists and is in a matchable state (CREATED or MATCHING for re-match)
    const task = await db.task.findUnique({ where: { id } })
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }
    if (task.status !== TaskStatus.CREATED && task.status !== TaskStatus.MATCHING) {
      return NextResponse.json(
        { error: `Task cannot be matched — current status is ${task.status}` },
        { status: 409 }
      )
    }

    // Default scheduledStart
    const start = scheduledStart ?? task.scheduledStart ?? (function () {
      const d = new Date()
      d.setDate(d.getDate() + 1)
      d.setHours(10, 0, 0, 0)
      return d
    })()

    // Resolve vendorId: use explicit or auto-select
    let vendorId = parsed.data.vendorId
    let autoSelected = false

    // Build list of vendors already tried (from previous cancelled bookings)
    const previousBookings = await db.booking.findMany({
      where: { taskId: id, status: "cancelled" },
      select: { vendorId: true },
    })
    const triedVendorIds = new Set(previousBookings.map((b) => b.vendorId))

    if (!vendorId) {
      // Get all suggestions, skip already-tried vendors
      const { getSuggestedVendors } = await import("@/lib/routing")
      const suggestions = await getSuggestedVendors(id)
      const untried = suggestions.filter((s) => !triedVendorIds.has(s.vendor.id))

      if (untried.length === 0) {
        // All vendors exhausted — notify ops
        const members = await db.familyMember.findMany({
          where: { householdId: task.householdId },
          select: { id: true },
        })
        for (const member of members) {
          await db.notification.create({
            data: {
              householdId: task.householdId,
              recipientType: RecipientType.HOUSEHOLD_MEMBER,
              memberId: member.id,
              channel: NotificationChannel.WHATSAPP,
              eventType: NotificationEventType.SYSTEM_ALERT,
              title: "Matching In Progress",
              body: "We're still searching for the best service provider for your task. Our team has been notified.",
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          })
        }
        // Keep task in MATCHING (ops will handle)
        return NextResponse.json(
          { error: "All available vendors have been tried. Ops has been notified.", task, needsOps: true },
          { status: 202 }
        )
      }

      vendorId = untried[0].vendor.id
      autoSelected = true
    } else {
      // Validate explicit vendorId
      const vendor = await db.vendor.findUnique({ where: { id: vendorId } })
      if (!vendor) {
        return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
      }
      if (vendor.status !== VendorStatus.ACTIVE) {
        return NextResponse.json(
          { error: `Vendor is not active — current status is ${vendor.status}` },
          { status: 409 }
        )
      }
      try {
        const cats: string[] = JSON.parse(vendor.categories)
        if (!cats.includes(task.category)) {
          return NextResponse.json(
            { error: `Vendor does not serve ${task.category} category` },
            { status: 409 }
          )
        }
      } catch {
        return NextResponse.json({ error: "Vendor categories data is invalid" }, { status: 500 })
      }
    }

    // If re-matching, cancel any existing active booking
    if (task.status === TaskStatus.MATCHING) {
      const activeBooking = await db.booking.findFirst({
        where: { taskId: id, status: { in: ["assigned"] } },
      })
      if (activeBooking) {
        await db.booking.update({
          where: { id: activeBooking.id },
          data: { status: "cancelled", cancelledAt: new Date() },
        })
      }
    }

    const now = new Date()
    const matchAttempts = ((task.metadata as Record<string, any>)?.matchAttempts ?? 0) + 1

    const result = await db.$transaction(async (tx) => {
      // Create tentative Booking (escrow NOT held yet)
      const booking = await tx.booking.create({
        data: {
          taskId: id,
          vendorId,
          scheduledStart: start,
          scheduledEnd: scheduledEnd ?? null,
          status: "assigned",
          dispatchedAt: now,
        },
        include: {
          vendor: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              categories: true,
              status: true,
            },
          },
        },
      })

      // Update task status → MATCHING
      const meta = (task.metadata as Record<string, unknown> | null) ?? {}
      const acceptTimeout = new Date(now.getTime() + VENDOR_ACCEPTANCE_TIMEOUT_MINUTES * 60 * 1000)
      const updatedTask = await tx.task.update({
        where: { id },
        data: {
          status: TaskStatus.MATCHING,
          dispatchedAt: now,
          acceptTimeoutAt: acceptTimeout,
          metadata: {
            ...meta,
            matchAttempts,
            currentMatchVendorId: vendorId,
          },
        },
        include: {
          bookings: {
            include: {
              vendor: {
                select: { id: true, name: true, email: true, phone: true, categories: true, status: true },
              },
            },
          },
          escrowEntries: true,
          jobType: { select: { id: true, name: true, slug: true } },
          quotation: { select: { id: true, totalCents: true, breakdown: true } },
        },
      })

      // Update VendorHouseholdAffinity (booking count, not completed)
      await tx.vendorHouseholdAffinity.upsert({
        where: {
          householdId_vendorId_category: {
            householdId: task.householdId,
            vendorId,
            category: task.category,
          },
        },
        create: {
          householdId: task.householdId,
          vendorId,
          category: task.category,
          bookingCount: 1,
          lastAssignedAt: now,
        },
        update: {
          bookingCount: { increment: 1 },
          lastAssignedAt: now,
        },
      })

      // Create ANONYMOUS notification for household (do NOT reveal vendor name)
      const members = await tx.familyMember.findMany({
        where: { householdId: task.householdId },
        select: { id: true },
      })

      for (const member of members) {
        await tx.notification.create({
          data: {
            householdId: task.householdId,
            recipientType: RecipientType.HOUSEHOLD_MEMBER,
            memberId: member.id,
            channel: NotificationChannel.WHATSAPP,
            eventType: NotificationEventType.VENDOR_MATCHED,
            title: "Searching for Provider",
            body: `We're finding the best service provider for your ${task.category.toLowerCase()} task. You'll be notified once a provider is confirmed.`,
            status: NotificationStatus.PENDING,
            referenceType: "task",
            referenceId: task.id,
          },
        })
      }

      // Notify the vendor about the new booking opportunity
      await tx.notification.create({
        data: {
          householdId: task.householdId,
          recipientType: RecipientType.VENDOR,
          vendorId,
          channel: NotificationChannel.WHATSAPP,
          eventType: NotificationEventType.TASK_DISPATCHED,
          title: "New Booking Request",
          body: `You have a new ${task.category.toLowerCase()} booking request. Please accept or decline within 15 minutes.`,
          status: NotificationStatus.PENDING,
          referenceType: "task",
          referenceId: task.id,
        },
      })

      return { booking, updatedTask }
    })

    // Background anomaly detection
    triggerAnomalyDetection(task.householdId)

    // Real-time event (anonymous — no vendor name)
    emitTaskStatusChanged({
      id: task.id,
      category: task.category,
      status: "MATCHING",
      previousStatus: task.status,
      householdId: task.householdId,
    }).catch(() => {})

    return NextResponse.json(
      { task: result.updatedTask, booking: result.booking, autoSelected, matchAttempts },
      { status: 201 }
    )
  } catch (error) {
    console.error("POST /api/tasks/[id]/dispatch (match) error:", error)
    const message = error instanceof Error ? error.message : "Failed to start matching"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
