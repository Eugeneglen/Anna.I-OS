import { NextResponse } from "next/server"
import { z } from "zod"
import { cancelPredictiveTask } from "@/lib/predictive-scheduler"

const schema = z.object({
  reason: z.string().optional(),
})

export async function POST(
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

    const result = await cancelPredictiveTask(id, parsed.data.reason ?? "Household cancelled")

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 409 })
    }

    return NextResponse.json({ success: true, message: "Predicted task cancelled" })
  } catch (error) {
    console.error("POST /api/tasks/[id]/cancel-predictive error:", error)
    return NextResponse.json(
      { error: "Failed to cancel predicted task" },
      { status: 500 }
    )
  }
}
