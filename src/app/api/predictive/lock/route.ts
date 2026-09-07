import { NextResponse } from "next/server"
import { NextRequest } from "next/server"
import { lockOverduePredictions } from "@/lib/predictive-scheduler"
import { getHouseholdSession } from "@/lib/household-auth"
import { getOpsSession } from "@/lib/ops-auth"
import { isCronRequest } from "@/lib/cron-auth"

/**
 * POST /api/predictive/lock
 *
 * Lock all overdue predicted tasks (past their lockAt deadline).
 * Transitions PREDICTED → CREATED, triggering normal dispatch flow.
 *
 * Designed to be called by a cron job or manually by ops.
 * FIX-1a: previously fully unauthenticated. Now accepts (mirroring
 * /api/tasks/timeout-check):
 *   - the internal cron service via timing-safe `x-cron-secret`
 *   - an ops session (manual console trigger)
 *   - a household session (the underlying sweep in
 *     src/lib/predictive-scheduler is a global, idempotent lock pass —
 *     the guard stops anonymous triggering of dispatch side effects)
 * Returns the count of tasks that were locked.
 */
export async function POST(request: NextRequest) {
  try {
    const cron = isCronRequest(request.headers)

    if (!cron) {
      const [hhSession, opsSession] = await Promise.all([
        getHouseholdSession(),
        getOpsSession(),
      ])
      if (!hhSession && !opsSession) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
    }

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
