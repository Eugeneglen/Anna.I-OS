// ============================================================
// Anna.I — Task Cancellation Service (shared canonical path)
// ============================================================
// AI Wave 2-A (A-4): extracted VERBATIM from POST /api/tasks/[id]/cancel
// (the F18 / F9 / F21 money path) so that BOTH the household API route
// AND the Ask Anna cancel_task tool execute the SAME cancellation
// semantics:
//   - guarded CANCELLABLE_STATUSES → TaskStatus.CANCELLED (never the old
//     AI shortcut of "revert to CREATED")
//   - HELD escrow → REFUNDED with full refund math (policy R3)
//   - REFUND_CREDIT voucher issuance + original voucher restore
//   - member notifications + realtime events + AuditLog
//
// The route keeps its guardTaskAccess auth; the AI tool passes the
// household session identity. Ownership is re-verified here for
// household actors either way.
// ============================================================

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
import { emitTaskStatusChanged, emitEscrowStateChanged } from "@/lib/events";

// Statuses from which a task may be cancelled outright (pre-completion).
// Exported so the Ask Anna cancel tool can pre-validate for its
// confirmation card with the exact same list the service enforces.
export const CANCELLABLE_STATUSES: TaskStatus[] = [
  TaskStatus.CREATED,
  TaskStatus.PREDICTED,
  TaskStatus.MATCHING,
  TaskStatus.ACCEPTED,
  TaskStatus.SCHEDULED,
  TaskStatus.IN_PROGRESS,
];

export type CancelActor =
  | { kind: "ops"; userId: string; name: string }
  // via: "ask-anna" when the household confirmed the action through the
  // AI assistant (recorded in the audit metadata — AI actions must be
  // attributable).
  | { kind: "household"; householdId: string; via?: string };

export interface CancelTaskSuccess {
  task: unknown; // full Task row (response parity with the old route)
  refundedCents: number;
  credit: { code: string; amountCents: number; expiresAt: Date } | null;
  creditPending: boolean;
  voucherRestored: boolean;
  cancelledBookings: number;
  zeroCashTerminalized: number;
}

export type CancelTaskOutcome =
  | { ok: true; data: CancelTaskSuccess }
  | { ok: false; status: number; error: string; code?: string };

export async function cancelTask(opts: {
  taskId: string;
  reason?: string;
  actor: CancelActor;
}): Promise<CancelTaskOutcome> {
  const { taskId, actor } = opts;
  const reason = opts.reason?.trim() || "Cancelled by household";

  const task = await db.task.findUnique({
    where: { id: taskId },
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
    return { ok: false, status: 404, error: "Task not found" };
  }

  // Ownership: household actors may only cancel their own tasks. Ops
  // actors are pre-authorised by the route's guardTaskAccess tier check.
  if (actor.kind === "household" && task.householdId !== actor.householdId) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden — this task belongs to another household",
    };
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
    return {
      ok: false,
      status: 409,
      error: `Task cannot be cancelled from status ${task.status}. ${guidance}`,
      code: "INVALID_TASK_STATUS",
    };
  }

  const now = new Date();
  const previousStatus = task.status;
  const actorLabel =
    actor.kind === "ops"
      ? actor.name
      : `${task.household?.name ?? "household"} (household)`;

  // ── Step 1: terminal state transition (all-or-nothing) ──
  let step1: { refundedEntries: { id: string; amountCents: number }[]; refundedTotalCents: number; cancelledBookings: number; zeroCashTerminalized: string[] };
  try {
    step1 = await db.$transaction(async (tx) => {
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
        select: {
          id: true, amountCents: true, refundCents: true, commissionRate: true,
          originalAmountCents: true, discountCents: true, discountFundedBy: true,
        },
      });
      const refunded: { id: string; amountCents: number }[] = [];
      // f6b (police-payout-base-1): 0-cash entries (a 100% platform-funded
      // discount holds amountCents = 0) have no cash to return, but policy
      // R3 still requires the terminal HELD → REFUNDED transition.
      const zeroCashTerminalized: string[] = [];
      for (const entry of heldEntries) {
        const remaining = entry.amountCents - entry.refundCents;
        if (remaining <= 0) {
          const claimed = await tx.escrowLedger.updateMany({
            where: { id: entry.id, state: EscrowState.HELD },
            data: {
              state: EscrowState.REFUNDED,
              refundedAt: now,
              commissionCents: 0,
              vendorPayoutCents: 0,
              disputeResolution: `${reason} — cancelled, no cash held (policy R3)`,
              disputeResolvedBy: actor.kind === "ops" ? actorLabel : "household",
              disputeResolvedAt: now,
            },
          });
          if (claimed.count > 0) zeroCashTerminalized.push(entry.id);
          continue;
        }
        const calc = calculateRefundImpact({
          amountCents: entry.amountCents,
          existingRefundCents: entry.refundCents,
          refundAmountCents: remaining,
          commissionRate: entry.commissionRate,
          originalAmountCents: entry.originalAmountCents || undefined,
          discountCents: entry.discountCents || 0,
          discountFundedBy: entry.discountFundedBy,
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
      // household identity lives in userName + metadata.actorHouseholdId;
      // metadata.via records AI-initiated actions — A-8)
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
            zeroCashTerminalized: zeroCashTerminalized.length,
            cancelledBookings: liveBookings.length,
            actorType: actor.kind,
            actorHouseholdId: actor.kind === "household" ? actor.householdId : undefined,
            via: actor.kind === "household" ? actor.via : undefined,
          },
        },
      });

      return {
        refundedEntries: refunded,
        refundedTotalCents: refundedTotal,
        cancelledBookings: liveBookings.length,
        zeroCashTerminalized,
      };
    });
  } catch (txError) {
    // police-2b f3: the status-guarded task claim aborts with a generic
    // Error when a concurrent writer won the race — map to a clean 409.
    if (txError instanceof Error && txError.message.includes("changed concurrently")) {
      return {
        ok: false,
        status: 409,
        error: "Task state changed concurrently — nothing was cancelled. Refresh and retry if still intended.",
        code: "CONCURRENT_STATE_CHANGE",
      };
    }
    throw txError;
  }
  const { refundedEntries, refundedTotalCents, cancelledBookings, zeroCashTerminalized } = step1;

  // ── Step 2: credit conversion + original-voucher reissue (idempotent,
  //    non-fatal — step 1 already reached terminal state) ──
  let credit: { code: string; amountCents: number; expiresAt: Date } | null = null;
  let creditPending = false;
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
      // Escrow is already REFUNDED — recovery is deterministic:
      // scripts/ops/backfill-cancelled-escrow.ts mode-2 re-issues missing
      // credit (same idempotency key).
      creditPending = true;
      console.error(
        `[task-cancel] refund-credit issuance FAILED for task ${task.id} ($${(refundedTotalCents / 100).toFixed(2)} owed) — run backfill mode-2 to recover:`,
        creditError,
      );
    }
  }

  let voucherRestored = false;
  if (task.discountCodeId) {
    try {
      const { restoreVoucherOnCancellation } = await import("@/lib/marketing/voucher-engine");
      const restore = await restoreVoucherOnCancellation(task.id);
      voucherRestored = restore.restored;
    } catch (restoreError) {
      console.error("[task-cancel] voucher restore failed:", restoreError);
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

  return {
    ok: true,
    data: {
      task: await db.task.findUnique({ where: { id: task.id } }),
      refundedCents: refundedTotalCents,
      credit,
      creditPending,
      voucherRestored,
      cancelledBookings,
      zeroCashTerminalized: zeroCashTerminalized.length,
    },
  };
}
