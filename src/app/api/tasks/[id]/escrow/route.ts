import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { TaskStatus, EscrowState, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client"

const escrowSchema = z.object({
  action: z.enum(["release", "dispute"]),
  reason: z.string().optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const parsed = escrowSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      )
    }

    const { action, reason } = parsed.data

    // Validate task exists
    const task = await db.task.findUnique({
      where: { id },
      include: { escrowEntries: true },
    })

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 })
    }

    const escrow = task.escrowEntries[0]
    if (!escrow) {
      return NextResponse.json({ error: "No escrow entry found for this task" }, { status: 404 })
    }

    const now = new Date()

    if (action === "release") {
      // Release escrow
      const updatedEscrow = await db.escrowLedger.update({
        where: { id: escrow.id },
        data: { state: EscrowState.RELEASED, releasedAt: now },
      })

      // Update task status
      const updatedTask = await db.task.update({
        where: { id },
        data: { status: TaskStatus.ESCROW_RELEASED, escrowReleasedAt: now },
      })

      // Create ESCROW_RELEASED notification
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
            eventType: NotificationEventType.ESCROW_RELEASED,
            title: "Payment Released",
            body: `Payment of $${(escrow.vendorPayoutCents / 100).toFixed(2)} has been released to the vendor for your ${task.category.toLowerCase()} task.`,
            status: NotificationStatus.PENDING,
            referenceType: "task",
            referenceId: task.id,
          },
        })

        // REBOOKING_PROMPT notification
        await db.notification.create({
          data: {
            householdId: task.householdId,
            recipientType: RecipientType.HOUSEHOLD_MEMBER,
            memberId: firstMember.id,
            channel: NotificationChannel.WHATSAPP,
            eventType: NotificationEventType.REBOOKING_PROMPT,
            title: "Rebook This Task?",
            body: `Would you like to rebook your ${task.category.toLowerCase()} task?`,
            status: NotificationStatus.PENDING,
            referenceType: "task",
            referenceId: task.id,
          },
        })
      }

      return NextResponse.json({ task: updatedTask, escrow: updatedEscrow })
    }

    if (action === "dispute") {
      // Dispute escrow
      const updatedEscrow = await db.escrowLedger.update({
        where: { id: escrow.id },
        data: {
          state: EscrowState.DISPUTED,
          disputedAt: now,
          disputeReason: reason ?? "No reason provided",
        },
      })

      // Update task status
      const updatedTask = await db.task.update({
        where: { id },
        data: { status: TaskStatus.DISPUTED, disputedAt: now },
      })

      // Pause autonomy promotion for this household+category
      await db.householdCategoryAutonomy.upsert({
        where: {
          householdId_category: { householdId: task.householdId, category: task.category },
        },
        create: {
          householdId: task.householdId,
          category: task.category,
          promotionPaused: true,
        },
        update: {
          promotionPaused: true,
        },
      })

      // Create DISPUTE_RAISED notification
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
            eventType: NotificationEventType.DISPUTE_RAISED,
            title: "Dispute Raised",
            body: `A dispute has been raised for your ${task.category.toLowerCase()} task.${reason ? ` Reason: ${reason}` : ""} Our team will review it shortly.`,
            status: NotificationStatus.PENDING,
            referenceType: "task",
            referenceId: task.id,
          },
        })
      }

      return NextResponse.json({ task: updatedTask, escrow: updatedEscrow })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("PATCH /api/tasks/[id]/escrow error:", error)
    return NextResponse.json(
      { error: "Failed to process escrow action" },
      { status: 500 }
    )
  }
}