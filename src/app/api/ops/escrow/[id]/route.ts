import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOpsSession, hasMinRole } from "@/lib/ops-auth";
import { TaskStatus, EscrowState, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client";
import { emitEscrowStateChanged, emitDisputeResolved } from "@/lib/events";
import { processRefund, RefundError } from "@/lib/payments/refund-service";

const escrowActionSchema = z.object({
  action: z.enum(["release", "resolve_dismiss", "resolve_refund", "partial_refund"]),
  resolution: z.string().max(500).optional(),
  // For partial_refund: the amount to refund (cents). Required for partial_refund.
  refundAmountCents: z.number().int().positive().optional(),
  // Idempotency key for refund operations (client-supplied, prevents duplicates).
  idempotencyKey: z.string().min(1).max(200).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only ADMIN and COORDINATOR can manage escrow
    if (!hasMinRole(session.role, "COORDINATOR")) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const parsed = escrowActionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const { action, resolution, refundAmountCents, idempotencyKey } = parsed.data;

    // Fetch escrow with task and household
    const escrow = await db.escrowLedger.findUnique({
      where: { id },
      include: {
        task: {
          include: {
            household: { select: { id: true, name: true } },
          },
        },
        booking: {
          include: {
            vendor: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!escrow) {
      return NextResponse.json({ error: "Escrow entry not found" }, { status: 404 });
    }

    const task = escrow.task;
    if (!task) {
      return NextResponse.json({ error: "Associated task not found" }, { status: 404 });
    }

    const now = new Date();

    // ── ACTION: Release Escrow ──
    if (action === "release") {
      if (escrow.state !== EscrowState.HELD) {
        return NextResponse.json(
          { error: `Escrow cannot be released — current state is ${escrow.state}` },
          { status: 409 }
        );
      }

      if (task.status !== TaskStatus.VERIFIED && task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.ESCROW_RELEASED) {
        return NextResponse.json(
          { error: `Task must be VERIFIED, COMPLETED, or ESCROW_RELEASED to release escrow — current status is ${task.status}` },
          { status: 409 }
        );
      }

      const result = await db.$transaction(async (tx) => {
        // Fix: Release ALL HELD escrow entries for this task (base + add-ons),
        // not just the one identified by `id`. Same pattern as the dispute
        // action — all entries must be released together.
        const allHeldEntries = await tx.escrowLedger.findMany({
          where: { taskId: task.id, state: EscrowState.HELD },
          select: { id: true, amountCents: true, vendorPayoutCents: true },
        });
        const updatedEscrows = [];
        for (const entry of allHeldEntries) {
          const updated = await tx.escrowLedger.update({
            where: { id: entry.id },
            data: { state: EscrowState.RELEASED, releasedAt: now },
          });
          updatedEscrows.push(updated);
        }
        const updatedEscrow = await tx.escrowLedger.findUnique({ where: { id } });

        const updatedTask = await tx.task.update({
          where: { id: task.id },
          data: { status: TaskStatus.ESCROW_RELEASED, escrowReleasedAt: now },
        });

        // Create audit log
        const totalAmountCents = allHeldEntries.reduce((s, e) => s + e.amountCents, 0);
        await tx.auditLog.create({
          data: {
            userId: session.userId,
            userName: session.name,
            action: "ESCROW_RELEASE",
            entityType: "EscrowLedger",
            entityId: id,
            metadata: {
              taskId: task.id,
              amountCents: totalAmountCents,
              entriesReleased: allHeldEntries.length,
              resolution: resolution || "Released by ops",
            },
          },
        });

        // Notify household members
        const members = await tx.familyMember.findMany({
          where: { householdId: task.householdId },
          select: { id: true },
        });

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
          });
        }

        return { updatedTask, updatedEscrow };
      });

      // Fire-and-forget: push real-time event to household
      emitEscrowStateChanged({
        id,
        state: "RELEASED",
        previousState: "HELD",
        amountCents: escrow.amountCents,
        category: task.category,
        householdId: task.householdId,
        householdName: task.household?.name,
        vendorPayoutCents: escrow.vendorPayoutCents,
      }).catch(() => {});

      return NextResponse.json({ task: result.updatedTask, escrow: result.updatedEscrow });
    }

    // ── ACTION: Resolve Dispute (Dismiss) — reset to HELD, task back to COMPLETED ──
    if (action === "resolve_dismiss") {
      if (escrow.state !== EscrowState.DISPUTED) {
        return NextResponse.json(
          { error: `Escrow is not in DISPUTED state — current state is ${escrow.state}` },
          { status: 409 }
        );
      }

      if (task.status !== TaskStatus.DISPUTED) {
        return NextResponse.json(
          { error: `Task is not DISPUTED — current status is ${task.status}` },
          { status: 409 }
        );
      }

      const result = await db.$transaction(async (tx) => {
        // Fix: Reset ALL escrow entries for this task to HELD (not just
        // the one identified by `id`). The dispute action disputes ALL
        // entries (base + add-ons), so dismiss must reset ALL of them.
        // Otherwise the add-on entries stay DISPUTED and can never be
        // released.
        const allEntries = await tx.escrowLedger.findMany({
          where: { taskId: task.id, state: EscrowState.DISPUTED },
          select: { id: true },
        });
        for (const entry of allEntries) {
          await tx.escrowLedger.update({
            where: { id: entry.id },
            data: {
              state: EscrowState.HELD,
              disputeResolution: resolution || "Dispute dismissed by ops",
              disputeResolvedBy: session.name,
              disputeResolvedAt: now,
            },
          });
        }
        const updatedEscrow = await tx.escrowLedger.findUnique({ where: { id } });

        // Unpause autonomy
        await tx.householdCategoryAutonomy.updateMany({
          where: {
            householdId: task.householdId,
            category: task.category,
            promotionPaused: true,
          },
          data: { promotionPaused: false },
        });

        // Reset task to COMPLETED (allowing re-verification)
        const updatedTask = await tx.task.update({
          where: { id: task.id },
          data: { status: TaskStatus.COMPLETED },
        });

        // Audit log
        await tx.auditLog.create({
          data: {
            userId: session.userId,
            userName: session.name,
            action: "DISPUTE_DISMISSED",
            entityType: "EscrowLedger",
            entityId: id,
            metadata: {
              taskId: task.id,
              disputeReason: escrow.disputeReason,
              resolution: resolution || "Dispute dismissed by ops",
            },
          },
        });

        // Notify household members
        const members = await tx.familyMember.findMany({
          where: { householdId: task.householdId },
          select: { id: true },
        });

        for (const member of members) {
          await tx.notification.create({
            data: {
              householdId: task.householdId,
              recipientType: RecipientType.HOUSEHOLD_MEMBER,
              memberId: member.id,
              channel: NotificationChannel.WHATSAPP,
              eventType: NotificationEventType.DISPUTE_RESOLVED,
              title: "Dispute Resolved",
              body: `The dispute on your ${task.category.toLowerCase()} task has been reviewed and dismissed. The task is now pending verification.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          });
        }

        return { updatedTask, updatedEscrow };
      });

      // Fire-and-forget: push real-time event to household
      emitDisputeResolved({
        taskId: task.id,
        householdId: task.householdId,
        householdName: task.household?.name,
        category: task.category,
        resolution: "dismissed",
        escrowAmountCents: escrow.amountCents,
      }).catch(() => {});
      emitEscrowStateChanged({
        id,
        state: "HELD",
        previousState: "DISPUTED",
        amountCents: escrow.amountCents,
        category: task.category,
        householdId: task.householdId,
        householdName: task.household?.name,
        disputeResolution: resolution || "Dispute dismissed by ops",
      }).catch(() => {});

      return NextResponse.json({ task: result.updatedTask, escrow: result.updatedEscrow });
    }

    // ── ACTION: Resolve Dispute (Refund) — set escrow to REFUNDED ──
    if (action === "resolve_refund") {
      if (escrow.state !== EscrowState.DISPUTED) {
        return NextResponse.json(
          { error: `Escrow is not in DISPUTED state — current state is ${escrow.state}` },
          { status: 409 }
        );
      }

      if (task.status !== TaskStatus.DISPUTED) {
        return NextResponse.json(
          { error: `Task is not DISPUTED — current status is ${task.status}` },
          { status: 409 }
        );
      }

      // IMPORTANT #1 (police review): delegate to processRefund for the FULL
      // remaining amount. This ensures resolve_refund produces the SAME state
      // as partial_refund-with-full-amount: refundCents set, commission/payout
      // recalculated to 0, Refund audit row created, task → DISPUTE_CLOSED.
      // A server-generated idempotency key makes this call idempotent per
      // escrow+timestamp (but the old "Refund" button is a one-shot action —
      // retrying it after success is blocked by the state guard above).
      try {
        const fullRemainingCents = escrow.amountCents - escrow.refundCents;
        const refundResult = await processRefund({
          escrowLedgerId: id,
          refundAmountCents: fullRemainingCents,
          reason: resolution || "Dispute upheld — full refund issued by ops",
          issuedById: session.userId,
          issuedByName: session.name,
          idempotencyKey: `resolve-refund-${id}-${Date.now()}`,
        });

        // Notify household members of the refund
        const members = await db.familyMember.findMany({
          where: { householdId: task.householdId },
          select: { id: true },
        });
        for (const member of members) {
          await db.notification.create({
            data: {
              householdId: task.householdId,
              recipientType: RecipientType.HOUSEHOLD_MEMBER,
              memberId: member.id,
              channel: NotificationChannel.WHATSAPP,
              eventType: NotificationEventType.DISPUTE_RESOLVED,
              title: "Refund Issued",
              body: `Your dispute on the ${task.category.toLowerCase()} task has been upheld. A full refund of SGD $${(refundResult.cumulativeRefundCents / 100).toFixed(2)} has been issued.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          }).catch(() => {});
        }

        // Fire-and-forget: push real-time event to household
        emitDisputeResolved({
          taskId: task.id,
          householdId: task.householdId,
          householdName: task.household?.name,
          category: task.category,
          resolution: "refunded",
          escrowAmountCents: escrow.amountCents,
        }).catch(() => {});
        emitEscrowStateChanged({
          id,
          state: "REFUNDED",
          previousState: "DISPUTED",
          amountCents: escrow.amountCents,
          category: task.category,
          householdId: task.householdId,
          householdName: task.household?.name,
          disputeResolution: resolution || "Dispute upheld — refund issued",
        }).catch(() => {});

        return NextResponse.json({
          refund: refundResult,
          escrow: await db.escrowLedger.findUnique({ where: { id } }),
        });
      } catch (e) {
        if (e instanceof RefundError) {
          return NextResponse.json(
            { error: e.message, code: e.code },
            { status: e.statusCode }
          );
        }
        throw e;
      }
    }

    // ── ACTION: Partial Refund — refund a portion of the held amount ──
    // Recalculates commission/payout on the adjusted (remaining) amount.
    // Idempotent: same idempotencyKey returns the original result (no double refund).
    if (action === "partial_refund") {
      // Validate required params
      if (!refundAmountCents) {
        return NextResponse.json(
          { error: "refundAmountCents is required for partial_refund" },
          { status: 400 }
        );
      }
      if (!idempotencyKey) {
        return NextResponse.json(
          { error: "idempotencyKey is required for partial_refund" },
          { status: 400 }
        );
      }

      try {
        const refundResult = await processRefund({
          escrowLedgerId: id,
          refundAmountCents,
          reason: resolution || "Partial refund issued by ops",
          issuedById: session.userId,
          issuedByName: session.name,
          idempotencyKey,
        });

        // Notify household members of the refund
        const members = await db.familyMember.findMany({
          where: { householdId: task.householdId },
          select: { id: true },
        });
        for (const member of members) {
          await db.notification.create({
            data: {
              householdId: task.householdId,
              recipientType: RecipientType.HOUSEHOLD_MEMBER,
              memberId: member.id,
              channel: NotificationChannel.WHATSAPP,
              eventType: NotificationEventType.DISPUTE_RESOLVED,
              title: refundResult.isFullyRefunded ? "Refund Issued" : "Partial Refund Issued",
              body: refundResult.isFullyRefunded
                ? `Your dispute on the ${task.category.toLowerCase()} task has been upheld. A full refund of SGD $${(refundResult.cumulativeRefundCents / 100).toFixed(2)} has been issued.`
                : `A partial refund of SGD $${(refundResult.refundedCents / 100).toFixed(2)} has been issued for your ${task.category.toLowerCase()} task. Remaining payable: SGD $${(refundResult.effectiveAmountCents / 100).toFixed(2)}.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          }).catch(() => {}); // non-critical
        }

        return NextResponse.json({
          refund: refundResult,
          escrow: await db.escrowLedger.findUnique({ where: { id } }),
        });
      } catch (e) {
        if (e instanceof RefundError) {
          return NextResponse.json(
            { error: e.message, code: e.code },
            { status: e.statusCode }
          );
        }
        throw e;
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("[/api/ops/escrow/[id] PATCH]", error);
    return NextResponse.json(
      { error: "Failed to process escrow action" },
      { status: 500 }
    );
  }
}
