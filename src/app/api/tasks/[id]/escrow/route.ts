import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { TaskStatus, EscrowState, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client"
import { triggerAnomalyDetection } from "@/lib/notify"
import { triggerPredictiveScheduling } from "@/lib/predictive-scheduler"
import { emitEscrowStateChanged, emitDisputeRaised, emitVendorNotification } from "@/lib/events"
import { updateHouseholdCachedStats } from "@/lib/marketing/behaviour-engine"

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

      // Fix: Validate that at least ONE escrow entry is in HELD state.
      // Previously this only checked the FIRST entry — if that entry was
      // REFUNDED (from a full refund) but another entry was HELD, the
      // release would fail even though there are releasable entries.
      const heldEntries = task.escrowEntries.filter(e => e.state === EscrowState.HELD)
      if (heldEntries.length === 0) {
        const states = task.escrowEntries.map(e => e.state).join(", ")
        return NextResponse.json(
          { error: `Escrow cannot be released — no HELD entries found (current states: ${states || "none"})` },
          { status: 409 }
        )
      }

      const result = await db.$transaction(async (tx) => {
        // Fix: Release ALL HELD escrow entries for this task (base + add-ons),
        // not just the first one. Each add-on creates a separate EscrowLedger
        // row that must be individually released.
        const updatedEscrows = []
        for (const entry of heldEntries) {
          const updated = await tx.escrowLedger.update({
            where: { id: entry.id },
            data: { state: EscrowState.RELEASED, releasedAt: now },
          })
          updatedEscrows.push(updated)
        }
        const updatedEscrow = updatedEscrows[0] // backward-compat: return first

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

        // Compute total payout for notification (sum of all released entries)
        const totalPayoutCents = updatedEscrows.reduce((s, e) => s + e.vendorPayoutCents, 0)

        for (const member of members) {
          await tx.notification.create({
            data: {
              householdId: task.householdId,
              recipientType: RecipientType.HOUSEHOLD_MEMBER,
              memberId: member.id,
              channel: NotificationChannel.WHATSAPP,
              eventType: NotificationEventType.ESCROW_RELEASED,
              title: "Payment Released",
              body: `Payment of SGD $${(totalPayoutCents / 100).toFixed(2)} has been released to the vendor for your ${task.category.toLowerCase()} task.`,
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

      // Fire-and-forget: push real-time event to household
      emitEscrowStateChanged({
        id: escrow.id,
        state: "RELEASED",
        previousState: "HELD",
        amountCents: escrow.amountCents,
        category: task.category,
        householdId: task.householdId,
        vendorPayoutCents: escrow.vendorPayoutCents,
      }).catch(() => {})

      // Phase 1 P1-4 fix: refresh cached household marketing stats now that
      // the task transitioned into ESCROW_RELEASED (a cached-stats-eligible
      // state). Non-fatal — escrow release must succeed even if the stats
      // refresh fails. This endpoint is NOT one of the 5 OPS escrow actions
      // (those live in /api/ops/escrow/[id]/route.ts) so this addition does
      // not touch the forbidden module.
      try {
        await updateHouseholdCachedStats(task.householdId)
      } catch (statsErr) {
        console.error("[tasks/[id]/escrow release] updateHouseholdCachedStats failed:", statsErr)
      }

      return NextResponse.json({ task: result.updatedTask, escrow: result.updatedEscrow })
    }

    if (action === "dispute") {
      // C-2 FIX: Validate task is in a disputable state (COMPLETED or VERIFIED)
      const disputableStatuses = [TaskStatus.COMPLETED, TaskStatus.VERIFIED, TaskStatus.IN_PROGRESS, TaskStatus.ACCEPTED, TaskStatus.SCHEDULED]
      if (!disputableStatuses.includes(task.status)) {
        return NextResponse.json(
          { error: `Task cannot be disputed — current status is ${task.status}. Only COMPLETED, VERIFIED, or IN_PROGRESS tasks can be disputed.` },
          { status: 409 }
        )
      }

      // C-2 FIX: Validate escrow is in HELD state (can't re-dispute a released/disputed escrow)
      // Fix #8: Check ALL escrow entries — if any is not HELD, the dispute is invalid.
      const heldEntries = task.escrowEntries.filter(e => e.state === EscrowState.HELD)
      if (heldEntries.length === 0) {
        const states = task.escrowEntries.map(e => e.state).join(", ")
        return NextResponse.json(
          { error: `Escrow cannot be disputed — no HELD entries found (current states: ${states || "none"})` },
          { status: 409 }
        )
      }

      const result = await db.$transaction(async (tx) => {
        // Fix #8: Dispute ALL escrow entries for this task (base + add-ons),
        // not just the first one. This ensures add-on escrows are also frozen.
        const updatedEscrows: typeof task.escrowEntries[number][] = []
        for (const entry of heldEntries) {
          const updated = await tx.escrowLedger.update({
            where: { id: entry.id },
            data: {
              state: EscrowState.DISPUTED,
              disputedAt: now,
              disputeReason: reason ?? "No reason provided",
            },
          })
          updatedEscrows.push(updated)
        }
        const updatedEscrow = updatedEscrows[0] // backward-compat: return first

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

        // Notify vendor about the dispute
        const bookingVendor = activeBooking
          ? await tx.booking.findUnique({
              where: { id: activeBooking.id },
              select: { vendorId: true },
            })
          : null;

        let vendorNotification: any = null;
        if (bookingVendor?.vendorId) {
          vendorNotification = await tx.notification.create({
            data: {
              householdId: task.householdId,
              recipientType: RecipientType.VENDOR,
              vendorId: bookingVendor.vendorId,
              channel: NotificationChannel.WHATSAPP,
              eventType: NotificationEventType.DISPUTE_RAISED,
              title: "Dispute Raised on Booking",
              body: `A dispute has been raised on your ${task.category.toLowerCase()} task.${reason ? ` Reason: ${reason}` : ""} The booking has been cancelled. Ops will review shortly.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          });
        }

        return { updatedTask, updatedEscrow, vendorNotification, vendorId: bookingVendor?.vendorId ?? null }
      })

      // Phase 5: Background anomaly detection (dispute triggers ESCROW_DISPUTED check)
      triggerAnomalyDetection(task.householdId);

      // Fire-and-forget: push real-time event to household
      emitDisputeRaised({
        taskId: task.id,
        householdId: task.householdId,
        category: task.category,
        reason: reason ?? "No reason provided",
        escrowAmountCents: escrow.amountCents,
        vendorId: result.vendorId,
      }).catch(() => {})

      // Real-time: push notification to vendor room
      if (result.vendorNotification) {
        emitVendorNotification({
          vendorId: result.vendorId,
          notificationId: result.vendorNotification.id,
          eventType: NotificationEventType.DISPUTE_RAISED,
          title: "Dispute Raised on Booking",
          body: `A dispute has been raised on your ${task.category.toLowerCase()} task.${reason ? ` Reason: ${reason}` : ""} The booking has been cancelled. Ops will review shortly.`,
          referenceType: "task",
          referenceId: task.id,
          householdId: task.householdId,
          category: task.category,
        }).catch(() => {})
      };
      emitEscrowStateChanged({
        id: escrow.id,
        state: "DISPUTED",
        previousState: "HELD",
        amountCents: escrow.amountCents,
        category: task.category,
        householdId: task.householdId,
        disputeReason: reason ?? "No reason provided",
      }).catch(() => {});

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