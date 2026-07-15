import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { TaskStatus, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client"

const verifySchema = z.object({
  bookingId: z.string().min(1),
  fileUrl: z.string().url().min(1),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const parsed = verifySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      )
    }

    const { bookingId, fileUrl } = parsed.data

    // Validate task exists and status is COMPLETED
    const task = await db.task.findUnique({ where: { id } })
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }
    if (task.status !== TaskStatus.COMPLETED) {
      return NextResponse.json(
        { error: `Task must be COMPLETED to upload verification photos — current status is ${task.status}` },
        { status: 409 }
      )
    }

    // Create VerificationPhoto
    const photo = await db.verificationPhoto.create({
      data: {
        taskId: id,
        bookingId,
        fileUrl,
        uploadedBy: "vendor",
        isVerified: false,
      },
    })

    // Create notification
    const members = await db.familyMember.findMany({
      where: { householdId: task.householdId },
      select: { id: true },
    })

    const firstMember = members[0]
    if (firstMember) {
      await db.notification.create({
        data: {
          householdId: task.householdId,
          recipientType: RecipientType.HOUSEHOLD_MEMBER,
          memberId: firstMember.id,
          channel: NotificationChannel.WHATSAPP,
          eventType: NotificationEventType.VERIFICATION_REQUESTED,
          title: "Verification Photo Uploaded",
          body: `A verification photo has been uploaded for your ${task.category.toLowerCase()} task. Please review and approve or reject.`,
          status: NotificationStatus.PENDING,
          referenceType: "task",
          referenceId: task.id,
        },
      })
    }

    return NextResponse.json({ photo }, { status: 201 })
  } catch (error) {
    console.error("POST /api/tasks/[id]/verify error:", error)
    return NextResponse.json(
      { error: "Failed to upload verification photo" },
      { status: 500 }
    )
  }
}