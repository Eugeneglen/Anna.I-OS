import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { TaskStatus, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client"
import { BOOKING_STATUS_TRANSITIONS, PLATFORM_COMMISSION_RATE, VENDOR_ACCEPTANCE_TIMEOUT_MINUTES, MAX_MATCH_ATTEMPTS } from "@/lib/constants"
import { triggerAnomalyDetection } from "@/lib/notify"
import { emitTaskStatusChanged, emitBookingStatusChanged, emitVendorNotification, emitTaskDispatched } from "@/lib/events"

const ACTION_STATUS_MAP: Record<string, string> = {
  accept: "accepted",
  complete: "completed",
  reject: "cancelled",
}

const patchVendorBookingSchema = z.object({
  action: z.enum(["accept", "complete", "reject"]),
  completionNotes: z.string().max(1000).optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; bookingId: string }> }
) {
  try {
    const { id: vendorId, bookingId } = await params

    const body = await request.json()
    const parsed = patchVendorBookingSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      )
    }

    const { action, completionNotes } = parsed.data
    const newStatus = ACTION_STATUS_MAP[action]

    // Fetch booking with task
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: { task: true },
    })

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 })
    }

    // Verify booking belongs to this vendor
    if (booking.vendorId !== vendorId) {
      return NextResponse.json(
        { error: "Booking does not belong to this vendor" },
        { status: 403 }
      )
    }

    // Validate state machine transition
    const allowedTransitions = BOOKING_STATUS_TRANSITIONS[booking.status] ?? []
    if (!allowedTransitions.includes(newStatus)) {
      return NextResponse.json(
        { error: `Cannot transition from "${booking.status}" to "${newStatus}"` },
        { status: 409 }
      )
    }

    const now = new Date()
    const updateData: Record<string, unknown> = { status: newStatus }

    if (action === "accept") {
      updateData.acceptedAt = now
    }

    if (action === "complete") {
      updateData.actualEnd = now
      updateData.completedAt = now
      if (completionNotes) {
        updateData.completionNotes = completionNotes
      }
    }

    if (action === "reject") {
      updateData.cancelledAt = now
    }

    const updatedBooking = await db.booking.update({
      where: { id: bookingId },
      data: updateData,
      include: {
        task: {
          select: {
            id: true,
            category: true,
            householdId: true,
            amountCents: true,
            scheduledStart: true,
          },
        },
        assignedStaff: {
          select: { id: true, name: true, role: true },
        },
      },
    })

    // ────────────────────────────────────────────────
    // ACCEPT: Hold escrow, transition task → ACCEPTED/SCHEDULED
    // ────────────────────────────────────────────────
    if (action === "accept") {
      const task = booking.task
      const amountCents = task.amountCents
      const commissionCents = Math.round((amountCents * PLATFORM_COMMISSION_RATE) / 100)
      const vendorPayoutCents = amountCents - commissionCents

      // Hold escrow (this is the ONLY place escrow is created)
      await db.escrowLedger.create({
        data: {
          taskId: task.id,
          bookingId,
          amountCents,
          state: "HELD",
          commissionRate: PLATFORM_COMMISSION_RATE,
          commissionCents,
          vendorPayoutCents,
          heldAt: now,
        },
      })

      // Determine if task should go to SCHEDULED directly (if it has a scheduledStart)
      const hasSchedule = task.scheduledStart != null
      const newTaskStatus = hasSchedule ? TaskStatus.SCHEDULED : TaskStatus.ACCEPTED
      const taskUpdateData: Record<string, unknown> = {
        status: newTaskStatus,
        acceptedAt: now,
      }
      if (hasSchedule) {
        taskUpdateData.scheduledAt = now
      }

      await db.task.update({
        where: { id: task.id },
        data: taskUpdateData,
      })

      // Notify household: vendor accepted (NOW reveal vendor name)
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
            eventType: NotificationEventType.VENDOR_ACCEPTED,
            title: "Provider Accepted",
            body: `A service provider has accepted your ${task.category.toLowerCase()} task. Escrow of SGD $${(amountCents / 100).toFixed(2)} has been secured.`,
            status: NotificationStatus.PENDING,
            referenceType: "task",
            referenceId: task.id,
          },
        })

        // If scheduled, also send schedule notification
        if (hasSchedule) {
          const schedDate = new Date(task.scheduledStart!)
          const dateStr = schedDate.toLocaleDateString("en-SG", { weekday: "long", day: "numeric", month: "short" })
          const timeStr = schedDate.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })

          await db.notification.create({
            data: {
              householdId: task.householdId,
              recipientType: RecipientType.HOUSEHOLD_MEMBER,
              memberId: member.id,
              channel: NotificationChannel.WHATSAPP,
              eventType: NotificationEventType.VENDOR_SCHEDULED,
              title: "Task Scheduled",
              body: `Your ${task.category.toLowerCase()} task is scheduled for ${dateStr} at ${timeStr}.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          })
        }
      }

      // Real-time events
      emitTaskStatusChanged({
        id: task.id,
        category: task.category,
        status: newTaskStatus,
        previousStatus: task.status,
        householdId: task.householdId,
      }).catch(() => {})

      emitBookingStatusChanged({
        id: bookingId,
        status: "accepted",
        previousStatus: booking.status,
        vendorName: undefined, // don't reveal in event
        vendorId,
        householdId: task.householdId,
        category: task.category,
      }).catch(() => {})

      return NextResponse.json({ booking: updatedBooking, taskStatus: newTaskStatus })
    }

    // ────────────────────────────────────────────────
    // COMPLETE: Vendor finishes → COMPLETED (works from accepted)
    // ────────────────────────────────────────────────
    if (action === "complete") {
      await db.task.update({
        where: { id: booking.taskId },
        data: { status: TaskStatus.COMPLETED, completedAt: now },
      })

      triggerAnomalyDetection(booking.task.householdId)

      return NextResponse.json({ booking: updatedBooking })
    }

    // ────────────────────────────────────────────────
    // REJECT: Vendor declined → AUTO-RE-ROUTE
    // ────────────────────────────────────────────────
    if (action === "reject") {
      const task = booking.task
      const meta = (task.metadata as Record<string, unknown> | null) ?? {}
      const matchAttempts = (meta.matchAttempts as number) ?? 1

      // Notify household: vendor declined (anonymous)
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
            eventType: NotificationEventType.VENDOR_REJECTED,
            title: "Searching Again",
            body: `The service provider could not accept your ${task.category.toLowerCase()} task. We're matching you with another provider.`,
            status: NotificationStatus.PENDING,
            referenceType: "task",
            referenceId: task.id,
          },
        })
      }

      // Auto-re-route: try next vendor
      if (matchAttempts < MAX_MATCH_ATTEMPTS) {
        try {
          const { getSuggestedVendors } = await import("@/lib/routing")
          const suggestions = await getSuggestedVendors(task.id)

          // Get already-tried vendor IDs
          const cancelledBookings = await db.booking.findMany({
            where: { taskId: task.id, status: "cancelled" },
            select: { vendorId: true },
          })
          const triedIds = new Set([
            ...cancelledBookings.map((b) => b.vendorId),
            vendorId, // the rejecting vendor
          ])

          const nextVendor = suggestions.find((s) => !triedIds.has(s.vendor.id))

          if (nextVendor) {
            // Create new booking with next vendor
            const newBooking = await db.booking.create({
              data: {
                taskId: task.id,
                vendorId: nextVendor.vendor.id,
                scheduledStart: task.scheduledStart ?? (function () {
                  const d = new Date()
                  d.setDate(d.getDate() + 1)
                  d.setHours(10, 0, 0, 0)
                  return d
                })(),
                status: "assigned",
                dispatchedAt: now,
              },
            })

            // Update affinity for new vendor
            await db.vendorHouseholdAffinity.upsert({
              where: {
                householdId_vendorId_category: {
                  householdId: task.householdId,
                  vendorId: nextVendor.vendor.id,
                  category: task.category,
                },
              },
              create: {
                householdId: task.householdId,
                vendorId: nextVendor.vendor.id,
                category: task.category,
                bookingCount: 1,
                lastAssignedAt: now,
              },
              update: {
                bookingCount: { increment: 1 },
                lastAssignedAt: now,
              },
            })

            // Update task metadata + reset acceptance timeout
            const newAcceptTimeout = new Date(now.getTime() + VENDOR_ACCEPTANCE_TIMEOUT_MINUTES * 60 * 1000)
            await db.task.update({
              where: { id: task.id },
              data: {
                acceptTimeoutAt: newAcceptTimeout,
                metadata: {
                  ...meta,
                  matchAttempts: matchAttempts + 1,
                  currentMatchVendorId: nextVendor.vendor.id,
                },
              },
            })

            // Notify new vendor
            const rerouteVendorNotification = await db.notification.create({
              data: {
                householdId: task.householdId,
                recipientType: RecipientType.VENDOR,
                vendorId: nextVendor.vendor.id,
                channel: NotificationChannel.WHATSAPP,
                eventType: NotificationEventType.TASK_DISPATCHED,
                title: "New Booking Request",
                body: `You have a new ${task.category.toLowerCase()} booking request. Please accept within ${VENDOR_ACCEPTANCE_TIMEOUT_MINUTES} minutes.`,
                status: NotificationStatus.PENDING,
                referenceType: "task",
                referenceId: task.id,
              },
            })

            // Real-time: push notification + dispatch event to vendor room
            emitVendorNotification({
              vendorId: nextVendor.vendor.id,
              notificationId: rerouteVendorNotification.id,
              eventType: NotificationEventType.TASK_DISPATCHED,
              title: "New Booking Request",
              body: `You have a new ${task.category.toLowerCase()} booking request. Please accept within ${VENDOR_ACCEPTANCE_TIMEOUT_MINUTES} minutes.`,
              referenceType: "task",
              referenceId: task.id,
              householdId: task.householdId,
              category: task.category,
            }).catch(() => {})

            emitTaskDispatched({
              taskId: task.id,
              bookingId: newBooking.id,
              vendorId: nextVendor.vendor.id,
              householdId: task.householdId,
              category: task.category,
              scheduledStart: newBooking.scheduledStart?.toISOString(),
              responseDeadline: new Date(now.getTime() + VENDOR_ACCEPTANCE_TIMEOUT_MINUTES * 60 * 1000).toISOString(),
            }).catch(() => {})

            // Keep task in MATCHING (it was already MATCHING)
            console.log(`[match] Auto-routed task ${task.id} to next vendor ${nextVendor.vendor.name} (attempt ${matchAttempts + 1})`)
          } else {
            // No more vendors available
            await db.task.update({
              where: { id: task.id },
              data: {
                acceptTimeoutAt: null,
                metadata: {
                  ...meta,
                  matchAttempts: matchAttempts + 1,
                  currentMatchVendorId: null,
                },
              },
            })
            // Notify ops for manual intervention
            await db.notification.create({
              data: {
                householdId: task.householdId,
                recipientType: RecipientType.HOUSEHOLD_MEMBER,
                memberId: members[0]?.id,
                channel: NotificationChannel.WHATSAPP,
                eventType: NotificationEventType.SYSTEM_ALERT,
                title: "Matching In Progress",
                body: "We're working on finding a service provider for your task.",
                status: NotificationStatus.PENDING,
                referenceType: "task",
                referenceId: task.id,
              },
            })
          }
        } catch (err) {
          console.error(`[match] Auto-re-route failed for task ${task.id}:`, err)
        }
      } else {
        // Max attempts reached — escalate to ops
        await db.task.update({
          where: { id: task.id },
          data: {
            acceptTimeoutAt: null,
            metadata: {
              ...meta,
              matchAttempts,
              currentMatchVendorId: null,
              needsOpsIntervention: true,
            },
          },
        })
      }

      // Task stays in MATCHING
      return NextResponse.json({ booking: updatedBooking, autoRouted: true })
    }

    return NextResponse.json({ booking: updatedBooking })
  } catch (error) {
    console.error("PATCH /api/vendors/[id]/bookings/[bookingId] error:", error)
    return NextResponse.json(
      { error: "Failed to update booking" },
      { status: 500 }
    )
  }
}
