import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { TaskStatus, EscrowState, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client"
import { triggerAnomalyDetection } from "@/lib/notify"
import { triggerPredictiveScheduling } from "@/lib/predictive-scheduler"

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
      // C-2 FIX: Validate task is VERIFIED before allowing escrow release
      if (task.status !== TaskStatus.VERIFIED) {
        return NextResponse.json(
          { error: `Task must be VERIFIED to release escrow — current status is ${task.status}` },
          { status: 409 }
        )
      }

      // C-2 FIX: Validate escrow is in HELD state
      if (escrow.state !== EscrowState.HELD) {
        return NextResponse.json(
          { error: `Escrow cannot be released — current state is ${escrow.state}` },
          { status: 409 }
        )
      }

      const result = await db.$transaction(async (tx) => {
        // Release escrow
        const updatedEscrow = await tx.escrowLedger.update({
          where: { id: escrow.id },
          data: { state: EscrowState.RELEASED, releasedAt: now },
        })

        // Update task status
        const updatedTask = await tx.task.update({
          where: { id },
          data: { status: TaskStatus.ESCROW_RELEASED, escrowReleasedAt: now },
        })

        // H-5 FIX: Create ESCROW_RELEASED notification for ALL members
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
              eventType: NotificationEventType.ESCROW_RELEASED,
              title: "Payment Released",
              body: `Payment of SGD $${(escrow.vendorPayoutCents / 100).toFixed(2)} has been released to the vendor for your ${task.category.toLowerCase()} task.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          })

          // REBOOKING_PROMPT notification
          await tx.notification.create({
            data: {
              householdId: task.householdId,
              recipientType: RecipientType.HOUSEHOLD_MEMBER,
              memberId: member.id,
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

        return { updatedTask, updatedEscrow }
      })

      // Phase 4: Fire-and-forget predictive scheduling for L4+ households
      triggerPredictiveScheduling(task.householdId, task.category as any, task.id)

      return NextResponse.json({ task: result.updatedTask, escrow: result.updatedEscrow })
    }

    if (action === "dispute") {
      // C-2 FIX: Validate task is in a disputable state (COMPLETED or VERIFIED)
      const disputableStatuses = [TaskStatus.COMPLETED, TaskStatus.VERIFIED, TaskStatus.IN_PROGRESS]
      if (!disputableStatuses.includes(task.status)) {
        return NextResponse.json(
          { error: `Task cannot be disputed — current status is ${task.status}. Only COMPLETED, VERIFIED, or IN_PROGRESS tasks can be disputed.` },
          { status: 409 }
        )
      }

      // C-2 FIX: Validate escrow is in HELD state (can't re-dispute a released/disputed escrow)
      if (escrow.state !== EscrowState.HELD) {
        return NextResponse.json(
          { error: `Escrow cannot be disputed — current state is ${escrow.state}` },
          { status: 409 }
        )
      }

      const result = await db.$transaction(async (tx) => {
        // Dispute escrow
        const updatedEscrow = await tx.escrowLedger.update({
          where: { id: escrow.id },
          data: {
            state: EscrowState.DISPUTED,
            disputedAt: now,
            disputeReason: reason ?? "No reason provided",
          },
        })

        // B-9 FIX: Cancel the active booking to prevent inconsistent state
        const activeBooking = await tx.booking.findFirst({
          where: {
            taskId: id,
            status: { in: ["assigned", "accepted", "in_progress"] },
          },
        });
        if (activeBooking) {
          await tx.booking.update({
            where: { id: activeBooking.id },
            data: { status: "cancelled", cancelledAt: now },
          });
        }

        // Update task status
        const updatedTask = await tx.task.update({
          where: { id },
          data: { status: TaskStatus.DISPUTED, disputedAt: now },
        })

        // Pause autonomy promotion for this household+category
        await tx.householdCategoryAutonomy.upsert({
          where: {
            householdId_category: { householdId: task.householdId, category: task.category },
          },
          create: {
            householdId: task.householdId,
            category: task.category,
            promotionPaused: true,
            currentLevel: 1,
            verifiedCyclesAtLevel: 0,
            totalVerifiedCycles: 0,
          },
          update: {
            promotionPaused: true,
          },
        })

        // H-5 FIX: Create DISPUTE_RAISED notification for ALL members
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
              eventType: NotificationEventType.DISPUTE_RAISED,
              title: "Dispute Raised",
              body: `A dispute has been raised for your ${task.category.toLowerCase()} task.${reason ? ` Reason: ${reason}` : ""} Our team will review it shortly.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          })
        }

        return { updatedTask, updatedEscrow }
      })

      // Phase 5: Background anomaly detection (dispute triggers ESCROW_DISPUTED check)
      triggerAnomalyDetection(task.householdId);

      return NextResponse.json({ task: result.updatedTask, escrow: result.updatedEscrow })
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