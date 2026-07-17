import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { TaskStatus, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client"

const resolveDisputeSchema = z.object({
  bookingId: z.string().min(1).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const parsed = resolveDisputeSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      )
    }

    // Validate task exists and is DISPUTED
    const task = await db.task.findUnique({
      where: { id },
      include: { escrowEntries: true },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    if (task.status !== TaskStatus.DISPUTED) {
      return NextResponse.json(
        { error: `Task must be DISPUTED to resolve — current status is ${task.status}` },
        { status: 409 }
      )
    }

    const now = new Date()

    // Resolve the dispute in a transaction
    const result = await db.$transaction(async (tx) => {
      // Reset escrow back to HELD state
      const escrow = task.escrowEntries[0]
      if (escrow) {
        await tx.escrowLedger.update({
          where: { id: escrow.id },
          data: {
            state: "HELD",
            disputeResolution: "Resolved by household member",
            disputeResolvedBy: "household",
            disputeResolvedAt: now,
          },
        })
      }

      // Unpause autonomy promotion
      await tx.householdCategoryAutonomy.updateMany({
        where: {
          householdId: task.householdId,
          category: task.category,
          promotionPaused: true,
        },
        data: { promotionPaused: false },
      })

      // Reset task to COMPLETED (allowing re-verification)
      const updatedTask = await tx.task.update({
        where: { id },
        data: {
          status: TaskStatus.COMPLETED,
          disputedAt: null,
        },
        include: {
          bookings: true,
          verificationPhotos: true,
          escrowEntries: true,
        },
      })

      // Notify all household members
      const members = await tx.familyMember.findMany({
        where: { householdId: task.householdId },
        select: { id: true },
      })

      for (const member of members) {
        await tx.notification.create({
          data: {
            householdId: task.householdId,
            recipientType: RecipientType.HOUSEHOLD_MEMBER,
            memberId: member.id,
            channel: NotificationChannel.WHATSAPP,
            eventType: NotificationEventType.DISPUTE_RESOLVED,
            title: "Dispute Resolved",
            body: `The dispute on your ${task.category.toLowerCase()} task has been resolved. The task is now pending verification.`,
            status: NotificationStatus.PENDING,
            referenceType: "task",
            referenceId: task.id,
          },
        })
      }

      return updatedTask
    })

    return NextResponse.json({ task: result })
  } catch (error) {
    console.error("POST /api/tasks/[id]/resolve-dispute error:", error)
    return NextResponse.json(
      { error: "Failed to resolve dispute" },
      { status: 500 }
    )
  }
}