import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { TaskStatus, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client"
import { checkAndPromoteAutonomy } from "@/lib/autonomy"
import { triggerAnomalyDetection } from "@/lib/notify"
import { triggerAutomationOnVerified } from "@/lib/automation"

const verifySchema = z.object({
  bookingId: z.string().min(1),
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

    const { bookingId } = parsed.data

    // Validate task exists and status is COMPLETED
    const task = await db.task.findUnique({
      where: { id },
      include: {
        bookings: { where: { id: bookingId }, take: 1 },
      },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    if (task.status !== TaskStatus.COMPLETED) {
      return NextResponse.json(
        { error: `Task must be COMPLETED to verify — current status is ${task.status}` },
        { status: 409 }
      )
    }

    const booking = task.bookings[0]
    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 })
    }

    // Mark any existing unverified photos as verified
    const updatedPhotos = await db.verificationPhoto.updateMany({
      where: {
        taskId: id,
        bookingId,
        isVerified: false,
      },
      data: {
        isVerified: true,
        verifiedBy: "household",
        verifiedAt: new Date(),
      },
    })

    // Update task status to VERIFIED
    const now = new Date()
    const verifiedTask = await db.task.update({
      where: { id },
      data: {
        status: TaskStatus.VERIFIED,
        verifiedAt: now,
      },
    })

    // Trigger autonomy promotion check
    await checkAndPromoteAutonomy(task.householdId, task.category)

    // Create VERIFICATION_APPROVED notification for all household members
    const members = await db.familyMember.findMany({
      where: { householdId: task.householdId },
      select: { id: true },
    })

    for (const member of members) {
      await db.notification.create({
        data: {
          householdId: task.householdId,
          recipientType: RecipientType.HOUSEHOLD_MEMBER,
          memberId: member.id,
          channel: NotificationChannel.WHATSAPP,
          eventType: NotificationEventType.VERIFICATION_APPROVED,
          title: "Task Verified",
          body: `Your ${task.category.toLowerCase()} task has been verified successfully. Escrow is ready for release.`,
          status: NotificationStatus.PENDING,
          referenceType: "task",
          referenceId: task.id,
        },
      })
    }

    // Phase 5: Background anomaly detection
    triggerAnomalyDetection(task.householdId);

    // Phase 7: Fire-and-forget auto-escrow-release check (Level 5)
    triggerAutomationOnVerified(id, task.householdId, task.category)

    return NextResponse.json({
      task: verifiedTask,
      photosVerified: updatedPhotos.count,
    }, { status: 200 })
  } catch (error) {
    console.error("POST /api/tasks/[id]/verify error:", error)
    return NextResponse.json(
      { error: "Failed to verify task" },
      { status: 500 }
    )
  }
}