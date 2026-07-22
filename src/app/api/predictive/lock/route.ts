import { NextResponse } from "next/server"
import { lockOverduePredictions } from "@/lib/predictive-scheduler"

/**
 * POST /api/predictive/lock
 *
 * Lock all overdue predicted tasks (past their lockAt deadline).
 * Transitions PREDICTED → CREATED, triggering normal dispatch flow.
 *
 * Designed to be called by a cron job or manually by ops.
 * Returns the count of tasks that were locked.
 */
export async function POST() {
  try {
    const count = await lockOverduePredictions()
    return NextResponse.json({
      success: true,
      lockedCount: count,
      message: count === 0
        ? "No overdue predictions to lock"
        : `Locked ${count} predicted task${count > 1 ? "s" : ""}`,
    })
  } catch (error) {
    console.error("POST /api/predictive/lock error:", error)
    return NextResponse.json(
      { error: "Failed to lock predictions" },
      { status: 500 }
    )
  }
}
