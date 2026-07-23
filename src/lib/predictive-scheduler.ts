// ============================================================
// Anna.I — Predictive Scheduler (Phase 4)
// Rule-based statistical cycle learning + pre-booking
// ============================================================
//
// CANONICAL REMAP (per CLAUDE.md):
//   Phase 4 = Predictive Scheduler → ACTIVE (this file)
//   Enables: Level 4 (Predictive Pre-Booking) of the Autonomy Ladder
//
// How it works:
//   1. After a closed-loop cycle completes (verified + escrow released),
//      check if the household is at Level 4+ for that category.
//   2. If yes, analyze the household's last N completed bookings for
//      that category to learn the median booking interval.
//   3. If enough data (>= PREDICTIVE_MIN_BOOKINGS), predict the next
//      booking date = last booking's scheduled start + median interval.
//   4. Create a PREDICTED task with a lockAt deadline (48hrs before
//      scheduled start). Before lockAt, the household can cancel or edit.
//   5. After lockAt, the task transitions to CREATED and normal
//      dispatch flow kicks in (auto-dispatch if L3+).
//
// Key design choices:
//   - Rule-based/statistical, NOT AI-judged (pilot requirement)
//   - Median interval for outlier robustness
//   - 48-hour cancel window is configurable per CLAUDE.md
//   - Photo verification and escrow release remain MANUAL at all levels
//   - This is the core Predictive mechanism feeding the Household Graph
// ============================================================

import { db } from "@/lib/db"
import {
  ServiceCategory,
  TaskStatus,
  NotificationEventType,
} from "@prisma/client"
import {
  PREDICTIVE_LOCK_HOURS,
  PREDICTIVE_MIN_BOOKINGS,
  PREDICTIVE_MAX_HISTORY,
  PREDICTIVE_DEFAULT_CYCLE_DAYS,
  PREDICTIVE_MAX_FUTURE_DAYS,
  AUTONOMY_LEVEL_NAMES,
} from "./constants"
import { createNotification } from "./notify"
import { triggerAutomationOnTaskCreated } from "./automation"

// ─────────────────────────────────────────────────────────────
// Cycle Learning
// ─────────────────────────────────────────────────────────────

interface CycleInsight {
  /** Learned median interval in days (null = not enough data) */
  medianDays: number | null
  /** Number of completed bookings analyzed */
  sampleSize: number
  /** Individual intervals in days (for debugging/analytics) */
  intervals: number[]
  /** Whether we have enough data to make a prediction */
  canPredict: boolean
}

/**
 * Analyze a household's booking history for a given category
 * to learn the typical cycle interval.
 *
 * Algorithm:
 * 1. Fetch last N tasks with status VERIFIED or ESCROW_RELEASED
 * 2. Sort by scheduledStart (or createdAt) ascending
 * 3. Calculate day-deltas between consecutive tasks
 * 4. Return median of those deltas
 *
 * Returns null median if < PREDICTIVE_MIN_BOOKINGS samples.
 */
export async function learnHouseholdCycle(
  householdId: string,
  category: ServiceCategory
): Promise<CycleInsight> {
  const completedTasks = await db.task.findMany({
    where: {
      householdId,
      category,
      status: { in: [TaskStatus.VERIFIED, TaskStatus.ESCROW_RELEASED] },
    },
    orderBy: [
      { scheduledStart: "asc" },
      { createdAt: "asc" },
    ],
    select: {
      id: true,
      scheduledStart: true,
      createdAt: true,
    },
    take: PREDICTIVE_MAX_HISTORY,
  })

  if (completedTasks.length < PREDICTIVE_MIN_BOOKINGS) {
    return {
      medianDays: null,
      sampleSize: completedTasks.length,
      intervals: [],
      canPredict: false,
    }
  }

  // Calculate intervals between consecutive bookings
  const intervals: number[] = []
  for (let i = 1; i < completedTasks.length; i++) {
    const prev = completedTasks[i - 1]
    const curr = completedTasks[i]
    const prevDate = new Date(prev.scheduledStart ?? prev.createdAt)
    const currDate = new Date(curr.scheduledStart ?? curr.createdAt)
    const diffMs = currDate.getTime() - prevDate.getTime()
    const diffDays = diffMs / (1000 * 60 * 60 * 24)
    // Sanity: ignore intervals < 1 day or > 90 days (likely anomalies)
    if (diffDays >= 1 && diffDays <= 90) {
      intervals.push(Math.round(diffDays))
    }
  }

  if (intervals.length < 2) {
    return {
      medianDays: null,
      sampleSize: completedTasks.length,
      intervals,
      canPredict: false,
    }
  }

  // Calculate median
  const sorted = [...intervals].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const medianDays =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid]

  return {
    medianDays,
    sampleSize: completedTasks.length,
    intervals,
    canPredict: true,
  }
}

// ─────────────────────────────────────────────────────────────
// Autonomy Level Check
// ─────────────────────────────────────────────────────────────

/** Minimum autonomy level required for predictive pre-booking */
const PREDICTIVE_MIN_LEVEL = 4

async function getAutonomyLevel(
  householdId: string,
  category: ServiceCategory
): Promise<number> {
  const autonomy = await db.householdCategoryAutonomy.findUnique({
    where: { householdId_category: { householdId, category } },
  })
  return autonomy?.currentLevel ?? 1
}

// ─────────────────────────────────────────────────────────────
// Predictive Task Creation
// ─────────────────────────────────────────────────────────────

interface PredictiveTaskResult {
  success: boolean
  taskId?: string
  scheduledStart?: Date
  lockAt?: Date
  cycleInsight?: CycleInsight
  reason?: string
}

/**
 * Create a predicted task for a household+category based on learned cycles.
 *
 * This is the main entry point, called after escrow release for L4+ households.
 *
 * Returns detailed result for logging/notifications.
 */
export async function createPredictiveBooking(
  householdId: string,
  category: ServiceCategory,
  previousTaskId: string
): Promise<PredictiveTaskResult> {
  try {
    // 1. Check autonomy level
    const level = await getAutonomyLevel(householdId, category)
    if (level < PREDICTIVE_MIN_LEVEL) {
      return {
        success: false,
        reason: `Autonomy level ${level} < ${PREDICTIVE_MIN_LEVEL} (${AUTONOMY_LEVEL_NAMES[PREDICTIVE_MIN_LEVEL - 1]} required)`,
      }
    }

    // 2. Learn the household's cycle
    const insight = await learnHouseholdCycle(householdId, category)
    if (!insight.canPredict || insight.medianDays === null) {
      return {
        success: false,
        reason: `Insufficient cycle data (${insight.sampleSize} bookings, need ${PREDICTIVE_MIN_BOOKINGS})`,
        cycleInsight: insight,
      }
    }

    // 3. Calculate predicted date
    //    Use the most recent completed task's scheduled start as the anchor
    const lastTask = await db.task.findFirst({
      where: {
        householdId,
        category,
        status: { in: [TaskStatus.VERIFIED, TaskStatus.ESCROW_RELEASED] },
      },
      orderBy: [
        { scheduledStart: "desc" },
        { createdAt: "desc" },
      ],
      select: {
        id: true,
        scheduledStart: true,
        createdAt: true,
        instructions: true,
        amountCents: true,
        jobTypeId: true,
      },
    })

    if (!lastTask) {
      return { success: false, reason: "No completed task found as prediction anchor" }
    }

    const anchorDate = new Date(lastTask.scheduledStart ?? lastTask.createdAt)
    const predictedDate = new Date(anchorDate)
    predictedDate.setDate(predictedDate.getDate() + Math.round(insight.medianDays))

    // 4. Guard: don't predict too far in the future
    const now = new Date()
    const daysUntilPrediction = (predictedDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    if (daysUntilPrediction > PREDICTIVE_MAX_FUTURE_DAYS) {
      return {
        success: false,
        reason: `Predicted date is ${Math.round(daysUntilPrediction)} days out (max ${PREDICTIVE_MAX_FUTURE_DAYS})`,
        cycleInsight: insight,
      }
    }

    // Guard: don't predict in the past
    if (daysUntilPrediction < 0) {
      // Predicted date is in the past — use default cycle instead
      predictedDate.setTime(now.getTime() + PREDICTIVE_DEFAULT_CYCLE_DAYS * 24 * 60 * 60 * 1000)
    }

    // Set scheduled time to 10:00 AM SGT for clean UX
    predictedDate.setHours(10, 0, 0, 0)

    // 5. Calculate lock deadline
    const lockDate = new Date(predictedDate)
    lockDate.setHours(lockDate.getHours() - PREDICTIVE_LOCK_HOURS)

    // 6. Check for existing active prediction for this household+category
    const existingPrediction = await db.task.findFirst({
      where: {
        householdId,
        category,
        status: TaskStatus.PREDICTED,
        cancelledAt: null,
      },
    })

    if (existingPrediction) {
      return {
        success: false,
        reason: `Active prediction already exists (task ${existingPrediction.id})`,
        cycleInsight: insight,
      }
    }

    // 7. Create the predicted task
    const task = await db.task.create({
      data: {
        householdId,
        category,
        status: TaskStatus.PREDICTED,
        instructions: lastTask.instructions,
        amountCents: lastTask.amountCents,
        jobTypeId: lastTask.jobTypeId,
        scheduledStart: predictedDate,
        lockAt: lockDate,
        metadata: {
          predicted: true,
          predictedFrom: previousTaskId,
          predictedLevel: level,
          cycleMedianDays: Math.round(insight.medianDays),
          cycleSampleSize: insight.sampleSize,
        },
      },
    })

    // 8. Notify the household
    const categoryLabel = category.charAt(0) + category.slice(1).toLowerCase().replace(/_/g, " ")
    const scheduledStr = predictedDate.toLocaleDateString("en-SG", {
      weekday: "short",
      day: "numeric",
      month: "short",
    })
    const lockStr = lockDate.toLocaleDateString("en-SG", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })

    await createNotification({
      householdId,
      eventType: NotificationEventType.PREDICTIVE_SUGGESTION,
      title: "Anna.I Predicted Your Next Service",
      body: `Based on your routine, Anna.I has pre-booked ${categoryLabel} for ${scheduledStr}. You can cancel or edit until ${lockStr}.`,
      referenceType: "task",
      referenceId: task.id,
    })

    console.log(
      `[predictive] Created predicted task ${task.id} for ${category} at ${predictedStr} ` +
      `(lock: ${lockStr}, cycle: ${Math.round(insight.medianDays)}d, level: ${AUTONOMY_LEVEL_NAMES[level - 1]})`
    )

    return {
      success: true,
      taskId: task.id,
      scheduledStart: predictedDate,
      lockAt: lockDate,
      cycleInsight: insight,
    }
  } catch (err) {
    console.error(`[predictive] Failed to create predictive booking for ${householdId}/${category}:`, err)
    return { success: false, reason: String(err) }
  }
}

// ─────────────────────────────────────────────────────────────
// Lock Predicted Tasks
// ─────────────────────────────────────────────────────────────

/**
 * Find all PREDICTED tasks past their lockAt deadline and
 * transition them to CREATED so normal dispatch flow kicks in.
 *
 * Designed to be called by a cron job or API endpoint.
 * Returns count of tasks that were locked.
 */
export async function lockOverduePredictions(): Promise<number> {
  const now = new Date()

  // Find predicted tasks that are past their lock deadline
  const overdueTasks = await db.task.findMany({
    where: {
      status: TaskStatus.PREDICTED,
      lockAt: { lte: now },
      cancelledAt: null,
    },
    select: { id: true, householdId: true, category: true, scheduledStart: true },
  })

  if (overdueTasks.length === 0) return 0

  let lockedCount = 0

  for (const task of overdueTasks) {
    try {
      // Transition to CREATED
      await db.task.update({
        where: { id: task.id },
        data: {
          status: TaskStatus.CREATED,
          metadata: {
            ...(await db.task.findUnique({ where: { id: task.id }, select: { metadata: true } }))
              ?.metadata ?? {},
            predictedLocked: true,
            lockedAt: now.toISOString(),
          },
        },
      })

      // Notify household that the prediction is now confirmed
      const categoryLabel = task.category
        .charAt(0) + task.category.slice(1).toLowerCase().replace(/_/g, " ")
      const scheduledStr = new Date(task.scheduledStart!).toLocaleDateString("en-SG", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })

      await createNotification({
        householdId: task.householdId,
        eventType: NotificationEventType.TASK_CREATED,
        title: "Predicted Booking Confirmed",
        body: `Your ${categoryLabel} booking for ${scheduledStr} is now confirmed and will be dispatched shortly.`,
        referenceType: "task",
        referenceId: task.id,
      })

      // Trigger auto-dispatch for L3+ households (automation.ts handles level check)
      triggerAutomationOnTaskCreated(task.id, task.householdId, task.category as ServiceCategory)

      lockedCount++
    } catch (err) {
      console.error(`[predictive] Failed to lock task ${task.id}:`, err)
    }
  }

  if (lockedCount > 0) {
    console.log(`[predictive] Locked ${lockedCount} overdue predicted tasks`)
  }

  return lockedCount
}

// ─────────────────────────────────────────────────────────────
// Cancel Predicted Task
// ─────────────────────────────────────────────────────────────

/**
 * Cancel a predicted task. Only allowed before lockAt.
 * Sets cancelledAt and cancelReason but preserves the record for analytics.
 */
export async function cancelPredictiveTask(
  taskId: string,
  reason: string = "Household cancelled"
): Promise<{ success: boolean; error?: string }> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      status: true,
      lockAt: true,
      cancelledAt: true,
      householdId: true,
      category: true,
      scheduledStart: true,
    },
  })

  if (!task) {
    return { success: false, error: "Task not found" }
  }

  if (task.status !== TaskStatus.PREDICTED) {
    return { success: false, error: `Task is not PREDICTED (status: ${task.status})` }
  }

  if (task.cancelledAt) {
    return { success: false, error: "Task already cancelled" }
  }

  // Check if past lock deadline
  if (task.lockAt && new Date() > new Date(task.lockAt)) {
    return { success: false, error: "Past lock deadline — cannot cancel" }
  }

  await db.task.update({
    where: { id: taskId },
    data: {
      cancelledAt: new Date(),
      cancelReason: reason,
    },
  })

  console.log(`[predictive] Cancelled predicted task ${taskId}: ${reason}`)
  return { success: true }
}

// ─────────────────────────────────────────────────────────────
// Edit Predicted Task
// ─────────────────────────────────────────────────────────────

export async function editPredictiveTask(
  taskId: string,
  updates: {
    scheduledStart?: Date
    instructions?: string
    amountCents?: number
  }
): Promise<{ success: boolean; error?: string; task?: any }> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      status: true,
      lockAt: true,
      cancelledAt: true,
    },
  })

  if (!task) {
    return { success: false, error: "Task not found" }
  }

  if (task.status !== TaskStatus.PREDICTED) {
    return { success: false, error: `Task is not PREDICTED (status: ${task.status})` }
  }

  if (task.cancelledAt) {
    return { success: false, error: "Task already cancelled" }
  }

  // Check if past lock deadline
  if (task.lockAt && new Date() > new Date(task.lockAt)) {
    return { success: false, error: "Past lock deadline — cannot edit" }
  }

  // If rescheduling, recalculate lockAt
  const data: Record<string, any> = {}
  if (updates.scheduledStart) {
    data.scheduledStart = updates.scheduledStart
    const newLock = new Date(updates.scheduledStart)
    newLock.setHours(newLock.getHours() - PREDICTIVE_LOCK_HOURS)
    data.lockAt = newLock
  }
  if (updates.instructions !== undefined) {
    data.instructions = updates.instructions
  }
  if (updates.amountCents !== undefined) {
    data.amountCents = updates.amountCents
  }

  const updated = await db.task.update({
    where: { id: taskId },
    data,
  })

  console.log(`[predictive] Edited predicted task ${taskId}`)
  return { success: true, task: updated }
}

// ─────────────────────────────────────────────────────────────
// Fire-and-Forget Trigger (Entry Point)
// ─────────────────────────────────────────────────────────────

/**
 * Fire-and-forget predictive scheduling check after escrow release.
 * Call this from the escrow release route.
 *
 * This is the integration point: after a complete closed-loop cycle
 * (verify → escrow release), we check if the household is L4+ and
 * pre-book their next service.
 */
export function triggerPredictiveScheduling(
  householdId: string,
  category: ServiceCategory,
  previousTaskId: string
) {
  createPredictiveBooking(householdId, category, previousTaskId).catch((err) => {
    console.error("[predictive] Background predictive scheduling failed:", err)
  })
}
