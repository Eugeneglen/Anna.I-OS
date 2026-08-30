import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { TaskStatus, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client"
import { updateHouseholdCachedStats } from "@/lib/marketing/behaviour-engine"
import { guardTaskAccess, guardErrorResponse } from "@/lib/api-guards"

const resolveDisputeSchema = z.object({
  bookingId: z.string().min(1).optional(),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // ── F21 auth gate (audit C7 family) ── resolving a dispute releases
    // escrow: owning household or ops only.
    const guard = await guardTaskAccess(id)
    if (!guard.ok) return guardErrorResponse(guard)

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
      // ── F19/E3: reset ALL DISPUTED escrow entries for this task, not just
      // escrowEntries[0]. The dispute action disputes ALL entries (base +
      // add-ons) — the household resolve must mirror it, or add-on entries
      // stay DISPUTED forever once the task leaves DISPUTED (they can never
      // be released/refunded). Guarded on state=DISPUTED per entry so a
      // concurrent ops resolution loses cleanly with zero double effects.
      const dismissedEntries = await tx.escrowLedger.findMany({
        where: { taskId: task.id, state: "DISPUTED" },
        select: { id: true },
      })
      if (dismissedEntries.length === 0) {
        throw new Error("NO_DISPUTED_ENTRIES")
      }
      await tx.escrowLedger.updateMany({
        where: { taskId: task.id, state: "DISPUTED" },
        data: {
          state: "HELD",
          disputeResolution: "Resolved by household member",
          disputeResolvedBy: "household",
          disputeResolvedAt: now,
        },
      })

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
      // B-10 FIX: Preserve disputedAt for audit trail — don't null it out
      const updatedTask = await tx.task.update({
        where: { id },
        data: {
          status: TaskStatus.COMPLETED,
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

    // Phase 1 P1-4 fix: refresh cached household marketing stats (post-commit,
    // non-fatal). The dispute reset transitions DISPUTED → COMPLETED, so the
    // task now re-enters the cached-stats filter set.
    try {
      await updateHouseholdCachedStats(task.householdId)
    } catch (statsErr) {
      console.error("[tasks/resolve-dispute] updateHouseholdCachedStats failed:", statsErr)
    }

    return NextResponse.json({ task: result })
  } catch (error) {
    // F19/E3: a concurrent resolution (ops won the race) is a clean 409,
    // not a 500 — the guarded updateMany found nothing to reset.
    if (error instanceof Error && error.message === "NO_DISPUTED_ENTRIES") {
      return NextResponse.json(
        {
          error: "No DISPUTED escrow entries found — the dispute may have just been resolved by ops. Refresh to see the current state.",
          code: "NO_DISPUTED_ENTRIES",
        },
        { status: 409 }
      )
    }
    console.error("POST /api/tasks/[id]/resolve-dispute error:", error)
    return NextResponse.json(
      { error: "Failed to resolve dispute" },
      { status: 500 }
    )
  }
}