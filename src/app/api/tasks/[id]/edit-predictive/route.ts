import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { editPredictiveTask } from "@/lib/predictive-scheduler"
import { guardTaskAccess, guardErrorResponse } from "@/lib/api-guards"
import { quoteJobType } from "@/lib/service-authority"

const schema = z.object({
  scheduledStart: z.string().datetime().optional(),
  instructions: z.string().optional(),
  amountCents: z.number().int().positive().optional(),
})

// ── Service/Pricing/Availability Authority (supersedes P5b/POLICE-4) ──
// Catalog price authority on predicted-task CONFIRMATION. Predicted
// tasks carry a jobTypeId (copied from their anchor task by the
// predictive scheduler, which also carries the anchor quotation's
// field answers in metadata.quotedConfig so the job scope survives).
// On confirmation the price is re-computed from the LIVE catalogue via
// calculateQuote() — never the client-sent amountCents, never the
// stale anchor amount:
//   jobTypeId present → live catalogue quote (units/multipliers/add-ons)
//   no jobTypeId      → ad-hoc custom request, sanity-capped.
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
      // ── Catalogue authority + ad-hoc cap (see header comment) ──
      const task = await db.task.findUnique({
        where: { id },
        select: { jobTypeId: true, metadata: true },
      })
      if (task?.jobTypeId) {
        // Carry the anchor quotation's field answers (units etc.) so the
        // confirm-time re-price keeps the same job scope.
        let fieldValues: Record<string, number> | undefined
        let selectedAddOns: string[] | undefined
        const meta = task.metadata as Record<string, unknown> | null
        const carried = meta?.quotedConfig as Record<string, unknown> | undefined
        if (carried && typeof carried === "object") {
          const fv = carried.fieldValues
          if (fv && typeof fv === "object" && !Array.isArray(fv)) {
            fieldValues = fv as Record<string, number>
          }
          const sa = carried.selectedAddOns
          if (Array.isArray(sa)) selectedAddOns = sa.filter((s): s is string => typeof s === "string")
        }
        const authority = await quoteJobType(task.jobTypeId, { fieldValues, selectedAddOns })
        if (!authority.ok) {
          if (authority.code === "INACTIVE") {
            return NextResponse.json(
              { error: authority.message, code: "JOB_TYPE_INACTIVE" },
              { status: 403 }
            )
          }
          // Job type vanished (shouldn't happen — delete is referentially
          // guarded); reject rather than persist an unanchored price.
          return NextResponse.json(
            { error: "Catalog job type for this task no longer exists", code: "JOB_TYPE_NOT_FOUND" },
            { status: 409 }
          )
        }
        // Live catalogue quote wins — the client-sent amount is ignored.
        updates.amountCents = authority.quote.totalCents
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
