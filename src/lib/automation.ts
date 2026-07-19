// ============================================================
// Anna.I — Autonomy Automation Engine
// Event-driven automation: auto-dispatch (Level 3)
// ============================================================
//
// CANONICAL REMAP (per CLAUDE.md):
//   L3 = Auto-Dispatch          → ACTIVE (this file)
//   L4 = Predictive Pre-Booking → LOCKED (requires Phase 4 — Predictive Scheduler)
//   L5 = Full Autonomous         → LOCKED (requires Phase 5 — NLU/Write-Capable)
//
// Photo verification and escrow release remain MANUAL at all levels.
// This is the core Closed-Loop brand promise — it does not soften
// as a household earns more autonomy. (CLAUDE.md, Autonomy Ladder)
// ============================================================

import { db } from "@/lib/db"
import {
  ServiceCategory,
  TaskStatus,
  NotificationEventType,
} from "@prisma/client"
import { PLATFORM_COMMISSION_RATE, AUTONOMY_LEVEL_NAMES } from "./constants"
import { autoSelectVendor } from "./routing"
import { createNotification, triggerAnomalyDetection } from "./notify"

/** Minimum autonomy level required for auto-dispatch */
const AUTO_DISPATCH_LEVEL = 3

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
  checkAutoDispatch(taskId, householdId, category).catch(() => {})
}