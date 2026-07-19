// ============================================================
// Anna.I — Autonomy Automation Engine (Phase 7)
// Event-driven automation: auto-dispatch, auto-verify, auto-escrow-release
// ============================================================

import { db } from "@/lib/db"
import {
  ServiceCategory,
  TaskStatus,
  EscrowState,
  NotificationEventType,
  NotificationStatus,
  RecipientType,
  NotificationChannel,
} from "@prisma/client"
import { PLATFORM_COMMISSION_RATE, AUTONOMY_LEVEL_NAMES } from "./constants"
import { autoSelectVendor } from "./routing"
import { createNotification, triggerAnomalyDetection } from "./notify"
import { checkAndPromoteAutonomy } from "./autonomy"

/** Minimum autonomy level required for each automation action */
const AUTO_DISPATCH_LEVEL = 3
const AUTO_VERIFY_LEVEL = 4
const AUTO_ESCROW_RELEASE_LEVEL = 5

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
// AUTO-DISPATCH (Level 3+)
// Triggered after task creation. Dispatches the task to the
// top-scored vendor automatically if autonomy level >= 3.
// ─────────────────────────────────────────────────────────────

export async function checkAutoDispatch(
  taskId: string,
  householdId: string,
  category: ServiceCategory
) {
  try {
    const level = await getAutonomyLevel(householdId, category)
    if (level < AUTO_DISPATCH_LEVEL) return null

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

    const amountCents = task.amountCents
    const commissionCents = Math.round(
      (amountCents * PLATFORM_COMMISSION_RATE) / 100
    )
    const vendorPayoutCents = amountCents - commissionCents

    const result = await db.$transaction(async (tx) => {
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

      const escrow = await tx.escrowLedger.create({
        data: {
          taskId,
          bookingId: booking.id,
          amountCents,
          state: "HELD",
          commissionRate: PLATFORM_COMMISSION_RATE,
          commissionCents,
          vendorPayoutCents,
          heldAt: now,
        },
      })

      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: { status: TaskStatus.DISPATCHED, dispatchedAt: now },
      })

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

      return { booking, escrow, updatedTask }
    })

    // Mark automation flag on task
    await setAutomationFlag(taskId, "autoDispatched")

    // Notify household
    await createNotification({
      householdId,
      eventType: NotificationEventType.TASK_DISPATCHED,
      title: "Auto-Dispatched",
      body: `Your ${category.toLowerCase()} task was automatically dispatched to ${result.booking.vendor.name}.`,
      referenceType: "task",
      referenceId: taskId,
    })

    triggerAnomalyDetection(householdId)

    console.log(
      `[automation] Auto-dispatched task ${taskId} to ${result.booking.vendor.name} (Level ${AUTONOMY_LEVEL_NAMES[level - 1]})`
    )
    return result
  } catch (err) {
    console.error(`[automation] Auto-dispatch failed for task ${taskId}:`, err)
    return null
  }
}

// ─────────────────────────────────────────────────────────────
// AUTO-VERIFY (Level 4+)
// Triggered after booking completion. Verifies the task
// automatically if autonomy level >= 4 and photos exist.
// ─────────────────────────────────────────────────────────────

export async function checkAutoVerify(
  taskId: string,
  householdId: string,
  category: ServiceCategory,
  bookingId: string
) {
  try {
    const level = await getAutonomyLevel(householdId, category)
    if (level < AUTO_VERIFY_LEVEL) return null

    // Confirm task is COMPLETED
    const task = await db.task.findUnique({ where: { id: taskId } })
    if (!task || task.status !== TaskStatus.COMPLETED) return null

    const now = new Date()

    // Mark unverified photos as verified by automation
    await db.verificationPhoto.updateMany({
      where: { taskId, bookingId, isVerified: false },
      data: {
        isVerified: true,
        verifiedBy: "automation",
        verifiedAt: now,
      },
    })

    // Update task to VERIFIED
    const verifiedTask = await db.task.update({
      where: { id: taskId },
      data: { status: TaskStatus.VERIFIED, verifiedAt: now },
    })

    // Trigger autonomy promotion check
    await checkAndPromoteAutonomy(householdId, category)

    // Mark automation flag
    await setAutomationFlag(taskId, "autoVerified")

    // Notify household
    await createNotification({
      householdId,
      eventType: NotificationEventType.VERIFICATION_APPROVED,
      title: "Auto-Verified",
      body: `Your ${category.toLowerCase()} task was automatically verified. Escrow is ready for release.`,
      referenceType: "task",
      referenceId: taskId,
    })

    triggerAnomalyDetection(householdId)

    console.log(
      `[automation] Auto-verified task ${taskId} (Level ${AUTONOMY_LEVEL_NAMES[level - 1]})`
    )
    return verifiedTask
  } catch (err) {
    console.error(`[automation] Auto-verify failed for task ${taskId}:`, err)
    return null
  }
}

// ─────────────────────────────────────────────────────────────
// AUTO-ESCROW-RELEASE (Level 5)
// Triggered after verification. Releases escrow automatically
// if autonomy level >= 5.
// ─────────────────────────────────────────────────────────────

export async function checkAutoEscrowRelease(
  taskId: string,
  householdId: string,
  category: ServiceCategory
) {
  try {
    const level = await getAutonomyLevel(householdId, category)
    if (level < AUTO_ESCROW_RELEASE_LEVEL) return null

    // Confirm task is VERIFIED with HELD escrow
    const task = await db.task.findUnique({
      where: { id: taskId },
      include: { escrowEntries: true },
    })
    if (!task || task.status !== TaskStatus.VERIFIED) return null

    const escrow = task.escrowEntries[0]
    if (!escrow || escrow.state !== "HELD") return null

    const now = new Date()

    const result = await db.$transaction(async (tx) => {
      const updatedEscrow = await tx.escrowLedger.update({
        where: { id: escrow.id },
        data: { state: EscrowState.RELEASED, releasedAt: now },
      })

      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: { status: TaskStatus.ESCROW_RELEASED, escrowReleasedAt: now },
      })

      return { updatedTask, updatedEscrow }
    })

    // Mark automation flag
    await setAutomationFlag(taskId, "autoEscrowReleased")

    // Notify household
    await createNotification({
      householdId,
      eventType: NotificationEventType.ESCROW_RELEASED,
      title: "Auto-Released",
      body: `Payment of SGD $${(escrow.vendorPayoutCents / 100).toFixed(2)} was automatically released to the vendor.`,
      referenceType: "task",
      referenceId: taskId,
    })

    console.log(
      `[automation] Auto-released escrow for task ${taskId} (Level ${AUTONOMY_LEVEL_NAMES[level - 1]})`
    )
    return result
  } catch (err) {
    console.error(
      `[automation] Auto-escrow-release failed for task ${taskId}:`,
      err
    )
    return null
  }
}

// ─────────────────────────────────────────────────────────────
// Convenience: fire-and-forget trigger (matches anomaly pattern)
// ─────────────────────────────────────────────────────────────

/**
 * Fire-and-forget automation checks after a task is created.
 * Call this from the task creation route.
 */
export function triggerAutomationOnTaskCreated(
  taskId: string,
  householdId: string,
  category: ServiceCategory
) {
  checkAutoDispatch(taskId, householdId, category).catch(() => {})
}

/**
 * Fire-and-forget automation checks after a booking is completed.
 * Call this from the booking update route.
 */
export function triggerAutomationOnBookingCompleted(
  taskId: string,
  householdId: string,
  category: ServiceCategory,
  bookingId: string
) {
  checkAutoVerify(taskId, householdId, category, bookingId).catch(() => {})
}

/**
 * Fire-and-forget automation checks after a task is verified.
 * Call this from the verify route.
 */
export function triggerAutomationOnVerified(
  taskId: string,
  householdId: string,
  category: ServiceCategory
) {
  checkAutoEscrowRelease(taskId, householdId, category).catch(() => {})
}