import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { TaskStatus, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client"

const REBOOKABLE_STATUSES = [TaskStatus.VERIFIED, TaskStatus.ESCROW_RELEASED]

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Fetch original task
    const originalTask = await db.task.findUnique({ where: { id } })
    if (!originalTask) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    // B-2 FIX: Only allow rebooking completed tasks
    if (!REBOOKABLE_STATUSES.includes(originalTask.status)) {
      return NextResponse.json(
        { error: `Only VERIFIED or ESCROW_RELEASED tasks can be rebooked — current status is ${originalTask.status}` },
        { status: 409 }
      )
    }

    // Clone the original task as a new one-off
    const newTask = await db.task.create({
      data: {
        householdId: originalTask.householdId,
        category: originalTask.category,
        status: TaskStatus.CREATED,
        instructions: originalTask.instructions,
        instructionsSource: "reused",
        amountCents: originalTask.amountCents,
        // Clear recurrence — new one-off
        recurrencePattern: null,
      },
    })

    // Create REBOOKING_PROMPT notification for ALL household members
    const members = await db.familyMember.findMany({
      where: { householdId: originalTask.householdId },
      select: { id: true },
    })

    for (const member of members) {
      await db.notification.create({
        data: {
          householdId: originalTask.householdId,
          recipientType: RecipientType.HOUSEHOLD_MEMBER,
          memberId: member.id,
          channel: NotificationChannel.WHATSAPP,
          eventType: NotificationEventType.REBOOKING_PROMPT,
          title: "Task Rebooked",
          body: `Your ${originalTask.category.toLowerCase()} task has been rebooked. It's ready to be dispatched.`,
          status: NotificationStatus.PENDING,
          referenceType: "task",
          referenceId: newTask.id,
        },
      })
    }

    return NextResponse.json({ task: newTask }, { status: 201 })
  } catch (error) {
    console.error("POST /api/tasks/[id]/rebook error:", error)
    return NextResponse.json(
      { error: "Failed to rebook task" },
      { status: 500 }
    )
  }
}