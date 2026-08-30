import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  TaskStatus,
  EscrowState,
  NotificationChannel,
  NotificationEventType,
  NotificationStatus,
  RecipientType,
} from "@prisma/client";
import { calculateRefundImpact } from "@/lib/payments/calculations";
import { guardTaskAccess, guardErrorResponse } from "@/lib/api-guards";
import { emitTaskStatusChanged, emitEscrowStateChanged } from "@/lib/events";

// ── F18 (C6 / policy R3): household-initiated task cancellation ──
//
// Before this route there was NO cancellation path once a task left the
// predictive state: escrow stayed orphaned HELD forever and a redeemed
// voucher stayed USED (audit finding C6).
//
// R3 behavior (voucher-policy-decision.md §2 row 1):
//   "Full cancellation (any path, pre-completion): HELD → REFUNDED
//    (marked credit); household receives REFUND_CREDIT voucher = paid
//    amount; vendor 0; commission 0; original promo reissued/restored."
//
// Refund window: ANY pre-completion status (product sub-decision — the
// pilot's NoOp ledger makes this trivially safe). COMPLETED/VERIFIED/
// ESCROW_RELEASED must go through the dispute flow instead (money has
// either been earned or released); DISPUTED must be resolved first.
//
// Ordering (crash-safe, idempotent):
//   1. TX: task CANCELLED + bookings cancelled + HELD escrows → REFUNDED
//      (full refund math via calculateRefundImpact — commission/payout → 0)
//   2. Post-TX (non-fatal, idempotent keys): issue the REFUND_CREDIT
//      voucher for the refunded total, then reissue/restore the original
//      promo voucher (restoreVoucherOnCancellation, F3b). If step 2
//      dies mid-way, step 1's terminal state prevents double-refunds and
//      the deterministic idempotency keys make a retry safe; the escrow
//      credit link (refundCreditVoucherId) is the reconciliation handle.

const cancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

// Statuses from which a household may cancel outright (pre-completion).
const CANCELLABLE_STATUSES: TaskStatus[] = [
  TaskStatus.CREATED,
  TaskStatus.PREDICTED,
  TaskStatus.MATCHING,
  TaskStatus.ACCEPTED,
  TaskStatus.SCHEDULED,
  TaskStatus.IN_PROGRESS,
];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // ── F21 auth gate: owning household or ops only ──
    const guard = await guardTaskAccess(id);
    if (!guard.ok) return guardErrorResponse(guard);
    const actor = guard.actor;

    const body = await request.json().catch(() => ({}));
    const parsed = cancelSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }
    const reason = parsed.data.reason?.trim() || "Cancelled by household";

    const task = await db.task.findUnique({
      where: { id },
      select: {
        id: true,
        jobNo: true,
        status: true,
        category: true,
        householdId: true,
        discountCodeId: true,
        household: { select: { name: true } },
      },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (!CANCELLABLE_STATUSES.includes(task.status)) {
      const guidance =
        task.status === TaskStatus.DISPUTED
          ? "Resolve the active dispute first (ops or the dispute flow)."
          : task.status === TaskStatus.COMPLETED ||
              task.status === TaskStatus.VERIFIED ||
              task.status === TaskStatus.ESCROW_RELEASED
            ? "The task is past completion — raise a dispute for a refund instead."
            : `Tasks in ${task.status} cannot be cancelled.`;
      return NextResponse.json(
        {
          error: `Task cannot be cancelled from status ${task.status}. ${guidance}`,
          code: "INVALID_TASK_STATUS",
        },
        { status: 409 }
      );
    }

    const now = new Date();
    const previousStatus = task.status;
    const actorLabel =
      actor.kind === "ops"
        ? actor.session.name
        : `${task.household?.name ?? "household"} (household)`;

    // ── Step 1: terminal state transition (all-or-nothing) ──
    const { refundedEntries, refundedTotalCents, cancelledBookings } = await db.$transaction(
      async (tx) => {
        // Cancel live bookings for this task (assigned/accepted — booking
        // statuses are plain strings, no Prisma enum)
        const liveBookings = await tx.booking.findMany({
          where: {
            taskId: task.id,
            status: { in: ["assigned", "accepted"] },
          },
          select: { id: true, vendorId: true },
        });
        for (const b of liveBookings) {
          await tx.booking.update({
            where: { id: b.id },
            data: { status: "cancelled", cancelledAt: now },
          });
        }

        // Convert every HELD escrow entry to REFUNDED with full refund math
        // (commission/payout recomputed to 0 — vendor gets nothing, policy
        // §2 row 1). Guarded per-entry on state=HELD so a concurrent
        // release/dispute on the same entry can't double-transition.
        const heldEntries = await tx.escrowLedger.findMany({
          where: { taskId: task.id, state: EscrowState.HELD },
          select: { id: true, amountCents: true, refundCents: true, commissionRate: true },
        });
        const refunded: { id: string; amountCents: number }[] = [];
        for (const entry of heldEntries) {
          const remaining = entry.amountCents - entry.refundCents;
          if (remaining <= 0) continue;
          const calc = calculateRefundImpact({
            amountCents: entry.amountCents,
            existingRefundCents: entry.refundCents,
            refundAmountCents: remaining,
            commissionRate: entry.commissionRate,
          });
          const claimed = await tx.escrowLedger.updateMany({
            where: { id: entry.id, state: EscrowState.HELD },
            data: {
              refundCents: calc.newRefundCents,
              commissionCents: calc.newCommissionCents,
              vendorPayoutCents: calc.newVendorPayoutCents,
              state: EscrowState.REFUNDED,
              refundedAt: now,
              disputeResolution: `${reason} — refunded as Anna.I credit (policy R3)`,
              disputeResolvedBy: actor.kind === "ops" ? actorLabel : "household",
              disputeResolvedAt: now,
            },
          });
          if (claimed.count > 0) {
            refunded.push({ id: entry.id, amountCents: remaining });
          }
        }
        const refundedTotal = refunded.reduce((s, e) => s + e.amountCents, 0);

        // Task → CANCELLED (guarded on the same pre-cancel status so a
        // concurrent state change (e.g. vendor completing) loses cleanly)
        const taskClaim = await tx.task.updateMany({
          where: { id: task.id, status: task.status },
          data: { status: TaskStatus.CANCELLED, cancelledAt: now },
        });
        if (taskClaim.count === 0) {
          throw new Error(
            `Task state changed concurrently (was ${task.status}) — cancellation aborted, nothing written`
          );
        }

        // Notify household members (transactional — cancellation itself,
        // the credit voucher notification follows on issuance)
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
              eventType: NotificationEventType.SYSTEM_ALERT,
              title: "Task Cancelled",
              body:
                refundedTotal > 0
                  ? `Your ${task.category.toLowerCase()} task #${task.jobNo ?? ""} has been cancelled. SGD $${(refundedTotal / 100).toFixed(2)} held in escrow is being returned to you as Anna.I credit — you'll receive it in your wallet shortly.`
                  : `Your ${task.category.toLowerCase()} task #${task.jobNo ?? ""} has been cancelled.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          });
        }

        // Audit (userId is an OpsUser FK — null for household actors; the
        // household identity lives in userName + metadata.actorHouseholdId)
        await tx.auditLog.create({
          data: {
            userId: actor.kind === "ops" ? actor.userId : null,
            userName: actor.kind === "ops" ? actorLabel : `${task.household?.name ?? "household"} (household)`,
            action: "TASK_CANCELLED",
            entityType: "task",
            entityId: task.id,
            metadata: {
              reason,
              refundedCents: refundedTotal,
              refundedEntries: refunded.length,
              cancelledBookings: liveBookings.length,
              actorType: actor.kind,
              actorHouseholdId: actor.kind === "household" ? actor.householdId : undefined,
            },
          },
        });

        return {
          refundedEntries: refunded,
          refundedTotalCents: refundedTotal,
          cancelledBookings: liveBookings.length,
        };
      }
    );

    // ── Step 2: credit conversion + original-voucher reissue (idempotent,
    //    non-fatal — step 1 already reached terminal state) ──
    let credit: { code: string; amountCents: number; expiresAt: Date } | null = null;
    if (refundedTotalCents > 0) {
      try {
        const { issueRefundCreditVoucher } = await import("@/lib/marketing/refund-credit");
        const result = await issueRefundCreditVoucher({
          householdId: task.householdId,
          taskId: task.id,
          creditAmountCents: refundedTotalCents,
          reason: `${reason} — escrow refunded as credit`,
          idempotencyKey: `cancel-credit-${task.id}`,
          escrowLedgerId: refundedEntries[0]?.id,
          escrowEntries: refundedEntries,
          issuedById: actor.kind === "ops" ? actor.userId : undefined,
          issuedByName: actor.kind === "ops" ? actorLabel : undefined,
        });
        credit = {
          code: result.code,
          amountCents: refundedTotalCents,
          expiresAt: result.expiresAt,
        };
      } catch (creditError) {
        // Escrow is already REFUNDED — ops can re-trigger safely (the
        // deterministic idempotency key prevents a double credit).
        console.error("[tasks/cancel] refund-credit issuance failed:", creditError);
      }
    }

    let voucherRestored = false;
    if (task.discountCodeId) {
      try {
        const { restoreVoucherOnCancellation } = await import("@/lib/marketing/voucher-engine");
        const restore = await restoreVoucherOnCancellation(task.id);
        voucherRestored = restore.restored;
      } catch (restoreError) {
        console.error("[tasks/cancel] voucher restore failed:", restoreError);
      }
    }

    // Real-time events (fire-and-forget)
    emitTaskStatusChanged({
      id: task.id,
      category: task.category,
      status: "CANCELLED",
      previousStatus,
      householdId: task.householdId,
    }).catch(() => {});
    for (const entry of refundedEntries) {
      emitEscrowStateChanged({
        id: entry.id,
        state: "REFUNDED",
        previousState: "HELD",
        amountCents: entry.amountCents,
        category: task.category,
        householdId: task.householdId,
        householdName: task.household?.name,
        disputeResolution: `${reason} — refunded as Anna.I credit`,
      }).catch(() => {});
    }

    return NextResponse.json({
      task: await db.task.findUnique({ where: { id: task.id } }),
      refundedCents: refundedTotalCents,
      credit,
      voucherRestored,
      cancelledBookings,
    });
  } catch (error) {
    console.error("POST /api/tasks/[id]/cancel error:", error);
    return NextResponse.json(
      { error: "Failed to cancel task" },
      { status: 500 }
    );
  }
}
