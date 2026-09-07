import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { editPredictiveTask } from "@/lib/predictive-scheduler"
import { guardTaskAccess, guardErrorResponse } from "@/lib/api-guards"

const schema = z.object({
  scheduledStart: z.string().datetime().optional(),
  instructions: z.string().optional(),
  amountCents: z.number().int().positive().optional(),
})

// ── P5b (AUDIT-3, POLICE-4 finding #2): catalog price authority on ──
// predicted-task edits. Predicted tasks can carry a jobTypeId (copied from
// their anchor task by the predictive scheduler), and this route used to
// accept ANY positive client amountCents — a household could set a $0.01
// price on a predicted task, let it auto-lock → dispatch → escrow at the
// forged price. Same precedence as POST /api/tasks (P5):
//   jobTypeId present → ServiceJobType.basePriceCents is authoritative
//   no jobTypeId      → ad-hoc amount, sanity-capped.
const MAX_ADHOC_TASK_CENTS = 10_000_000 // $100k — matches the manual-create cap

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // ── F21 auth gate (audit C7 family) ── predictive task edits change
    // money-relevant fields (amountCents): owning household or ops only.
    const guard = await guardTaskAccess(id)
    if (!guard.ok) return guardErrorResponse(guard)

    const body = await request.json()
    const parsed = schema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      )
    }

    const updates: { scheduledStart?: Date; instructions?: string; amountCents?: number } = {}
    if (parsed.data.scheduledStart) {
      updates.scheduledStart = new Date(parsed.data.scheduledStart)
    }
    if (parsed.data.instructions !== undefined) {
      updates.instructions = parsed.data.instructions
    }
    if (parsed.data.amountCents !== undefined) {
      // ── P5b: catalog authority + ad-hoc cap (see header comment) ──
      const task = await db.task.findUnique({
        where: { id },
        select: { jobTypeId: true },
      })
      if (task?.jobTypeId) {
        const jobType = await db.serviceJobType.findUnique({
          where: { id: task.jobTypeId },
          select: { basePriceCents: true },
        })
        if (jobType) {
          // Ops catalog price wins — the client-sent amount is ignored.
          updates.amountCents = jobType.basePriceCents
        } else {
          // Job type vanished (shouldn't happen — delete is referentially
          // guarded); reject rather than persist an unanchored price.
          return NextResponse.json(
            { error: "Catalog job type for this task no longer exists", code: "JOB_TYPE_NOT_FOUND" },
            { status: 409 }
          )
        }
      } else {
        // Ad-hoc predicted task (no catalog job type): keep the client
        // amount but sanity-cap it like the manual-create path.
        if (parsed.data.amountCents > MAX_ADHOC_TASK_CENTS) {
          return NextResponse.json(
            {
              error: `Amount exceeds the maximum allowed (SGD $${(MAX_ADHOC_TASK_CENTS / 100).toLocaleString()}).`,
              code: "AMOUNT_TOO_LARGE",
            },
            { status: 400 }
          )
        }
        updates.amountCents = parsed.data.amountCents
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updates provided" }, { status: 400 })
    }

    const result = await editPredictiveTask(id, updates)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 409 })
    }

    return NextResponse.json({ success: true, task: result.task })
  } catch (error) {
    console.error("PATCH /api/tasks/[id]/edit-predictive error:", error)
    return NextResponse.json(
      { error: "Failed to edit predicted task" },
      { status: 500 }
    )
  }
}
