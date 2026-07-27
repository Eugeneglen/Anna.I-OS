// ============================================================
// Anna.I — Autonomy Automation Engine
// Event-driven automation: auto-match (Level 3)
// ============================================================
//
// CANONICAL REMAP (per CLAUDE.md):
//   L3 = Auto-Match             → ACTIVE (this file)
//   L4 = Predictive Pre-Booking → LOCKED (requires Phase 4)
//   L5 = Full Autonomous         → LOCKED (requires Phase 5)
//
// Photo verification and escrow release remain MANUAL at all levels.
// ============================================================

import { db } from "@/lib/db"
import {
  ServiceCategory,
  TaskStatus,
  NotificationChannel,
  NotificationEventType,
  NotificationStatus,
  RecipientType,
} from "@prisma/client"
import { AUTONOMY_LEVEL_NAMES, VENDOR_ACCEPTANCE_TIMEOUT_MINUTES } from "./constants"
import { autoSelectVendor } from "./routing"
import { triggerAnomalyDetection } from "./notify"
import { emitVendorNotification, emitTaskDispatched } from "./events"

/** Minimum autonomy level required for auto-match */
const AUTO_MATCH_LEVEL = 3

/** Helper: get current autonomy level for a household+category */
async function getAutonomyLevel(
  householdId: string,
  category: string
): Promise<number> {
  const autonomy = await db.householdCategoryAutonomy.findUnique({
    where: { householdId_category: { householdId, category } },
  })
  return autonomy?.currentLevel ?? 1
}

/** Helper: set automation flag on task metadata */
async function setAutomationFlag(
  taskId: string,
  flag: string
) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { metadata: true },
  })
  const meta = (task?.metadata as Record<string, unknown> | null) ?? {}
  await db.task.update({
    where: { id: taskId },
    data: { metadata: { ...meta, [flag]: true } },
  })
}

// ─────────────────────────────────────────────────────────────
// AUTO-MATCH (Level 3+)
// Triggered after task creation. Matches the task to the
// top-scored vendor automatically if autonomy level >= 3.
// Task goes to MATCHING (not dispatched). Escrow is NOT held
// until the vendor accepts.
// ─────────────────────────────────────────────────────────────

export async function checkAutoMatch(
  taskId: string,
  householdId: string,
  category: ServiceCategory
) {
  try {
    const level = await getAutonomyLevel(householdId, category)
    if (level < AUTO_MATCH_LEVEL) return null

    // Re-fetch task to confirm it's still CREATED
    const task = await db.task.findUnique({ where: { id: taskId } })
    if (!task || task.status !== TaskStatus.CREATED) return null

    // Auto-select vendor via routing engine
    const suggestion = await autoSelectVendor(taskId)
    const vendorId = suggestion.vendor.id

    const now = new Date()
    const start =
      task.scheduledStart ??
      (function () {
        const d = new Date()
        d.setDate(d.getDate() + 1)
        d.setHours(10, 0, 0, 0)
        return d
      })()

    const result = await db.$transaction(async (tx) => {
      // Create tentative Booking (escrow NOT held)
      const booking = await tx.booking.create({
        data: {
          taskId,
          vendorId,
          scheduledStart: start,
          status: "assigned",
          dispatchedAt: now,
        },
        include: {
          vendor: { select: { id: true, name: true } },
        },
      })

      // Update task status → MATCHING (NOT DISPATCHED)
      const acceptTimeout = new Date(now.getTime() + VENDOR_ACCEPTANCE_TIMEOUT_MINUTES * 60 * 1000)
      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.MATCHING,
          dispatchedAt: now,
          acceptTimeoutAt: acceptTimeout,
          metadata: {
            autoMatched: true,
            matchAttempts: 1,
            currentMatchVendorId: vendorId,
          },
        },
      })

      // Update VendorHouseholdAffinity
      await tx.vendorHouseholdAffinity.upsert({
        where: {
          householdId_vendorId_category: {
            householdId,
            vendorId,
            category,
          },
        },
        create: {
          householdId,
          vendorId,
          category,
          bookingCount: 1,
          lastAssignedAt: now,
        },
        update: {
          bookingCount: { increment: 1 },
          lastAssignedAt: now,
        },
      })

      // ANONYMOUS notification for household
      const members = await tx.familyMember.findMany({
        where: { householdId },
        select: { id: true },
      })

      for (const member of members) {
        await tx.notification.create({
          data: {
            householdId,
            recipientType: RecipientType.HOUSEHOLD_MEMBER,
            memberId: member.id,
            channel: NotificationChannel.WHATSAPP,
            eventType: NotificationEventType.VENDOR_MATCHED,
            title: "Searching for Provider",
            body: `We're automatically finding the best service provider for your ${category.toLowerCase()} task.`,
            status: NotificationStatus.PENDING,
            referenceType: "task",
            referenceId: taskId,
          },
        })
      }

      // Notify the matched vendor
      const vendorNotification = await tx.notification.create({
        data: {
          householdId,
          recipientType: RecipientType.VENDOR,
          vendorId,
          channel: NotificationChannel.WHATSAPP,
          eventType: NotificationEventType.TASK_DISPATCHED,
          title: "New Booking Request",
          body: `You have a new ${category.toLowerCase()} booking request. Please accept within 15 minutes.`,
          status: NotificationStatus.PENDING,
          referenceType: "task",
          referenceId: taskId,
        },
      })

      return { booking, updatedTask, vendorNotification }
    })

    // Real-time: push notification + dispatch event to vendor room
    emitVendorNotification({
      vendorId,
      notificationId: result.vendorNotification.id,
      eventType: NotificationEventType.TASK_DISPATCHED,
      title: "New Booking Request",
      body: `You have a new ${category.toLowerCase()} booking request. Please accept within 15 minutes.`,
      referenceType: "task",
      referenceId: taskId,
      householdId,
      category,
    }).catch(() => {})

    emitTaskDispatched({
      taskId,
      bookingId: result.booking.id,
      vendorId,
      householdId,
      category,
      scheduledStart: start.toISOString(),
      responseDeadline: new Date(now.getTime() + VENDOR_ACCEPTANCE_TIMEOUT_MINUTES * 60 * 1000).toISOString(),
    }).catch(() => {})

    // Mark automation flag
    await setAutomationFlag(taskId, "autoMatched")

    // Background anomaly detection
    triggerAnomalyDetection(householdId)

    console.log(
      `[automation] Auto-matched task ${taskId} to ${result.booking.vendor.name} (Level ${AUTONOMY_LEVEL_NAMES[level - 1]})`
    )
    return result
  } catch (err) {
    console.error(`[automation] Auto-match failed for task ${taskId}:`, err)
    return null
  }
}

// ─────────────────────────────────────────────────────────────
// FIRE-AND-FORGET TRIGGER
// ─────────────────────────────────────────────────────────────

/**
 * Fire-and-forget automation check after a task is created.
 * Call this from the task creation route.
 */
export function triggerAutomationOnTaskCreated(
  taskId: string,
  householdId: string,
  category: ServiceCategory
) {
  checkAutoMatch(taskId, householdId, category).catch(() => {})
}
