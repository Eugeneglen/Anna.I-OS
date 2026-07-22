import { NextResponse } from "next/server"
import { z } from "zod"
import { editPredictiveTask } from "@/lib/predictive-scheduler"

const schema = z.object({
  scheduledStart: z.string().datetime().optional(),
  instructions: z.string().optional(),
  amountCents: z.number().int().positive().optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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
      updates.amountCents = parsed.data.amountCents
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
