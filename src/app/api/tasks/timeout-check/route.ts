import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { TaskStatus, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client"
import { VENDOR_ACCEPTANCE_TIMEOUT_MINUTES, MAX_MATCH_ATTEMPTS } from "@/lib/constants"
import { emitVendorNotification, emitTaskDispatched } from "@/lib/events"

/**
 * POST /api/tasks/timeout-check
 *
 * Checks all tasks in MATCHING status where acceptTimeoutAt has passed.
 * For each expired task:
 *   1. Cancels the active booking
 *   2. Attempts to auto-re-route to next vendor (if attempts < MAX_MATCH_ATTEMPTS)
 *   3. If no more vendors or max attempts reached, escalates to ops
 *
 * Can be called by a cron job or on-demand by ops.
 */
export async function POST() {
  try {
    const now = new Date()

    // Find all MATCHING tasks whose acceptance timeout has expired
    const expiredTasks = await db.task.findMany({
      where: {
        status: TaskStatus.MATCHING,
        acceptTimeoutAt: { lte: now },
      },
      include: {
        bookings: {
          where: { status: { in: ["assigned"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    })

    if (expiredTasks.length === 0) {
      return NextResponse.json({ checked: 0, expired: 0, processed: 0 })
    }

    let processed = 0

    for (const task of expiredTasks) {
      const activeBooking = task.bookings[0]
      if (!activeBooking) continue

      const meta = (task.metadata as Record<string, unknown> | null) ?? {}
      const matchAttempts = (meta.matchAttempts as number) ?? 1

      try {
        // Cancel the expired booking
        await db.booking.update({
          where: { id: activeBooking.id },
          data: { status: "cancelled", cancelledAt: now },
        })

        // Notify household: vendor didn't respond (anonymous)
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
              body: `The service provider did not respond in time. We're matching you with another provider.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          })
        }

        // Auto-re-route if under max attempts
        if (matchAttempts < MAX_MATCH_ATTEMPTS) {
          const { getSuggestedVendors } = await import("@/lib/routing")
          const suggestions = await getSuggestedVendors(task.id)

          // Get already-tried vendor IDs
          const cancelledBookings = await db.booking.findMany({
            where: { taskId: task.id, status: "cancelled" },
            select: { vendorId: true },
          })
          const triedIds = new Set([
            ...cancelledBookings.map((b) => b.vendorId),
            activeBooking.vendorId,
          ])

          const nextVendor = suggestions.find((s) => !triedIds.has(s.vendor.id))

          if (nextVendor) {
            const acceptTimeout = new Date(now.getTime() + VENDOR_ACCEPTANCE_TIMEOUT_MINUTES * 60 * 1000)

            // Create new booking with next vendor
            await db.booking.create({
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

            // Update task metadata and reset timeout
            await db.task.update({
              where: { id: task.id },
              data: {
                acceptTimeoutAt: acceptTimeout,
                metadata: {
                  ...meta,
                  matchAttempts: matchAttempts + 1,
                  currentMatchVendorId: nextVendor.vendor.id,
                },
              },
            })

            // Notify new vendor
            const timeoutVendorNotification = await db.notification.create({
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
              notificationId: timeoutVendorNotification.id,
              eventType: NotificationEventType.TASK_DISPATCHED,
              title: "New Booking Request",
              body: `You have a new ${task.category.toLowerCase()} booking request. Please accept within ${VENDOR_ACCEPTANCE_TIMEOUT_MINUTES} minutes.`,
              referenceType: "task",
              referenceId: task.id,
              householdId: task.householdId,
              category: task.category,
            }).catch(() => {})

            const newBookingForEmit = await db.booking.findFirst({ where: { taskId: task.id, vendorId: nextVendor.vendor.id, status: "assigned" }, select: { id: true, scheduledStart: true } })
            if (newBookingForEmit) {
              emitTaskDispatched({
                taskId: task.id,
                bookingId: newBookingForEmit.id,
                vendorId: nextVendor.vendor.id,
                householdId: task.householdId,
                category: task.category,
                scheduledStart: newBookingForEmit.scheduledStart?.toISOString(),
                responseDeadline: acceptTimeout.toISOString(),
              }).catch(() => {})
            }

            console.log(
              `[timeout] Auto-routed task ${task.id} to vendor ${nextVendor.vendor.name} (attempt ${matchAttempts + 1})`
            )
          } else {
            // No more vendors — escalate to ops
            await db.task.update({
              where: { id: task.id },
              data: {
                acceptTimeoutAt: null, // Clear timeout to avoid repeated processing
                metadata: {
                  ...meta,
                  matchAttempts: matchAttempts + 1,
                  currentMatchVendorId: null,
                  needsOpsIntervention: true,
                },
              },
            })

            // Notify household
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

            console.log(`[timeout] No more vendors for task ${task.id} — escalated to ops`)
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

          console.log(`[timeout] Max attempts reached for task ${task.id} — escalated to ops`)
        }

        processed++
      } catch (err) {
        console.error(`[timeout] Error processing expired task ${task.id}:`, err)
      }
    }

    return NextResponse.json({
      checked: expiredTasks.length,
      expired: expiredTasks.length,
      processed,
    })
  } catch (error) {
    console.error("POST /api/tasks/timeout-check error:", error)
    return NextResponse.json(
      { error: "Failed to check acceptance timeouts" },
      { status: 500 }
    )
  }
}
