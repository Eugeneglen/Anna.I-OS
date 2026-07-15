import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { TaskStatus } from "@prisma/client"
import { getSuggestedVendors } from "@/lib/routing"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Validate task exists
    const task = await db.task.findUnique({
      where: { id },
      select: { id: true, status: true, category: true },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    // Only allow suggestions for CREATED tasks
    if (task.status !== TaskStatus.CREATED) {
      return NextResponse.json(
        { error: `Vendor suggestions only available for CREATED tasks — current status is ${task.status}` },
        { status: 409 }
      )
    }

    const suggestions = await getSuggestedVendors(id)

    return NextResponse.json({
      taskId: id,
      category: task.category,
      count: suggestions.length,
      suggestions,
    })
  } catch (error) {
    console.error("GET /api/tasks/[id]/suggest-vendors error:", error)
    const message = error instanceof Error ? error.message : "Failed to get vendor suggestions"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}