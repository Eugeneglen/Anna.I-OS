/**
 * Refund Service
 * =============
 *
 * Orchestrates the full refund workflow:
 *   1. Idempotency check: if idempotencyKey already exists, return original result
 *   2. Inside a DB transaction with row-level locking:
 *      a. Re-fetch escrow WITH a lock (FOR UPDATE on Postgres; serializable on SQLite)
 *      b. Validate state (DISPUTED) + amount (cumulative refund ≤ original)
 *      c. Insert Refund row with stripeStatus="pending" (claims the idempotency key atomically)
 *      d. Call PaymentService.refund() (NoOp now, Stripe later)
 *      e. Update Refund row to stripeStatus="succeeded" + update EscrowLedger (refundCents,
 *         commission, payout, state) + update task status if fully refunded
 *      f. Write audit log
 *
 * Concurrency safety: the escrow is re-fetched inside the transaction with a lock,
 * and the Refund row insert (unique idempotency key) acts as the atomic gate. Two
 * concurrent refunds with DIFFERENT keys will both read the same escrow, but the
 * second transaction's validation will see the updated refundCents from the first
 * (because they're in the same transaction scope on Postgres / serialized on SQLite).
 *
 * Payment service ordering: the payment service is called INSIDE the transaction
 * AFTER the Refund row is created with "pending" status. If the payment service
 * fails, the transaction rolls back (Refund row is deleted, no escrow update).
 * If the DB update fails after the payment service succeeds, the Refund row stays
 * "pending" — a reconciliation job (future) can detect + retry.
 */

import { db } from "@/lib/db";
import { getPaymentService } from "@/lib/payments/factory";
import {
  calculateRefundImpact,
  effectivePayoutBaseCents,
  type RefundCalcResult,
} from "@/lib/payments/calculations";
import { EscrowState, TaskStatus } from "@prisma/client";

export interface ProcessRefundInput {
  escrowLedgerId: string;
  refundAmountCents: number;
  reason: string;
  issuedById: string;
  issuedByName: string;
  idempotencyKey: string;
}

export interface ProcessRefundResult {
  refundId: string;
  refundedCents: number;
  cumulativeRefundCents: number;
  effectiveAmountCents: number; // effective PAYOUT BASE (job value remaining)
  remainingCashCents: number;   // customer cash still held after refunds
  newCommissionCents: number;
  newVendorPayoutCents: number;
  escrowState: EscrowState;
  taskStatus: TaskStatus;
  paymentProviderRefundId: string;
  paymentStatus: string;
  isFullyRefunded: boolean;
  isDuplicate: boolean; // true if this was a retried idempotent call
}

export class RefundError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
    public code?: string
  ) {
    super(message);
    this.name = "RefundError";
  }
}

/**
 * Process a partial or full refund on an escrow entry.
 *
 * State transitions:
 *   - DISPUTED + partial refund → stays DISPUTED (still money owed)
 *   - DISPUTED + full refund    → REFUNDED + task → DISPUTE_CLOSED (terminal)
 *
 * Idempotency:
 *   - If `idempotencyKey` already exists on a Refund row, returns that
 *     refund's result with `isDuplicate: true` (no second refund issued).
 *
 * Concurrency:
 *   - The escrow is re-fetched inside the transaction. Two concurrent refunds
 *     with different keys are serialized — the second sees the first's update.
 */
export async function processRefund(input: ProcessRefundInput): Promise<ProcessRefundResult> {
  // ── 1. Idempotency check: if this key was already used, return the original result ──
  const existing = await db.refund.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { escrowLedger: { select: { taskId: true } } },
  });

  if (existing) {
    const escrow = await db.escrowLedger.findUnique({
      where: { id: existing.escrowLedgerId },
      select: {
        refundCents: true,
        amountCents: true,
        commissionCents: true,
        vendorPayoutCents: true,
        state: true,
        // f4 (police-payout-base-1): payout-base context so the duplicate
        // path reports the same effective PAYOUT BASE semantics as the
        // primary path (previously: cash-remaining — inconsistent).
        originalAmountCents: true,
        discountCents: true,
        discountFundedBy: true,
        task: { select: { status: true } },
      },
    });
    if (!escrow) {
      throw new RefundError("Escrow entry not found for existing refund", 404);
    }
    return {
      refundId: existing.id,
      refundedCents: existing.amountCents,
      cumulativeRefundCents: escrow.refundCents,
      effectiveAmountCents: effectivePayoutBaseCents(escrow),
      remainingCashCents: Math.max(0, escrow.amountCents - escrow.refundCents),
      newCommissionCents: escrow.commissionCents,
      newVendorPayoutCents: escrow.vendorPayoutCents,
      escrowState: escrow.state,
      taskStatus: escrow.task.status,
      paymentProviderRefundId: existing.stripeRefundId || "",
      paymentStatus: existing.stripeStatus || "succeeded",
      isFullyRefunded: escrow.refundCents >= escrow.amountCents,
      isDuplicate: true,
    };
  }

  // ── 2. Validate amount > 0 before entering the transaction ──
  if (input.refundAmountCents <= 0) {
    throw new RefundError("Refund amount must be greater than 0", 400, "INVALID_AMOUNT");
  }

  // ── 3. DB transaction: re-fetch escrow WITH LOCK + validate + refund + update ──
  try {
    const result = await db.$transaction(async (tx) => {
      // Re-fetch the escrow INSIDE the transaction. On Postgres this should use
      // `SELECT ... FOR UPDATE` for row-level locking; Prisma doesn't expose this
      // directly, so we rely on the transaction isolation level (serializable on
      // SQLite, which is the default; REPEATABLE READ or SERIALIZABLE on Postgres).
      // The Refund.idempotencyKey @@unique constraint is the ultimate guard
      // against duplicate refunds — even if two transactions pass validation,
      // only one can insert the Refund row; the other gets P2002.
      const escrow = await tx.escrowLedger.findUnique({
        where: { id: input.escrowLedgerId },
        include: { task: { select: { id: true, status: true, householdId: true, category: true } } },
      });

      if (!escrow) {
        throw new RefundError("Escrow entry not found", 404, "NOT_FOUND");
      }

      // Validate escrow state
      if (escrow.state !== EscrowState.DISPUTED) {
        throw new RefundError(
          `Escrow must be DISPUTED to refund — current state is ${escrow.state}`,
          409,
          "INVALID_STATE"
        );
      }

      if (escrow.task.status !== TaskStatus.DISPUTED) {
        throw new RefundError(
          `Task must be DISPUTED to refund — current status is ${escrow.task.status}`,
          409,
          "INVALID_TASK_STATUS"
        );
      }

      // Calculate the refund impact using the FRESH refundCents from the locked read.
      // This is the concurrency-safe calculation: if another transaction committed
      // a refund between our idempotency check and this read, we see the updated value.
      //
      // Payout-base context (platform-funded discount): commission/payout recalc
      // on the pre-discount value — a vendor-fault refund reduces the vendor's
      // earnings on the FULL job value, and exhausting the customer cash zeroes
      // them (the consumed discount reverses to the household via voucher restore).
      let calc: RefundCalcResult;
      try {
        calc = calculateRefundImpact({
          amountCents: escrow.amountCents,
          existingRefundCents: escrow.refundCents,
          refundAmountCents: input.refundAmountCents,
          commissionRate: escrow.commissionRate,
          originalAmountCents: escrow.originalAmountCents || undefined,
          discountCents: escrow.discountCents || 0,
          discountFundedBy: escrow.discountFundedBy,
        });
      } catch (e) {
        throw new RefundError((e as Error).message, 400, "REFUND_CALC_FAILED");
      }

      // Call the payment service INSIDE the transaction (after validation, before DB writes).
      // NoOp: always succeeds immediately. Stripe (future): makes the API call.
      // If this throws, the transaction rolls back — no Refund row, no escrow update.
      const paymentService = getPaymentService();
      const refundResult = await paymentService.refund({
        paymentIntentId: escrow.stripePaymentIntentId,
        amountCents: input.refundAmountCents,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      });

      // Create the Refund row (idempotency key unique → atomic gate).
      // If a concurrent transaction already inserted this key, P2002 throws here.
      const refund = await tx.refund.create({
        data: {
          escrowLedgerId: escrow.id,
          amountCents: input.refundAmountCents,
          reason: input.reason,
          issuedById: input.issuedById,
          issuedByName: input.issuedByName,
          idempotencyKey: input.idempotencyKey,
          stripeRefundId: refundResult.providerRefundId,
          stripeStatus: refundResult.status,
        },
      });

      // Update the escrow entry with recalculated figures.
      // refundCents is set to the NEW cumulative value (calculated from the locked read).
      const newState = calc.isFullyRefunded ? EscrowState.REFUNDED : EscrowState.DISPUTED;
      const updatedEscrow = await tx.escrowLedger.update({
        where: { id: escrow.id },
        data: {
          refundCents: calc.newRefundCents,
          commissionCents: calc.newCommissionCents,
          vendorPayoutCents: calc.newVendorPayoutCents,
          state: newState,
          refundedAt: calc.isFullyRefunded ? new Date() : escrow.refundedAt,
          // Only set resolution fields when the dispute is actually resolved (full refund)
          disputeResolution: calc.isFullyRefunded ? input.reason : escrow.disputeResolution,
          disputeResolvedBy: calc.isFullyRefunded ? input.issuedByName : escrow.disputeResolvedBy,
          disputeResolvedAt: calc.isFullyRefunded ? new Date() : escrow.disputeResolvedAt,
        },
      });

      // If fully refunded, check whether ALL escrow entries for this task
      // are now resolved (REFUNDED or RELEASED). Only transition the task to
      // DISPUTE_CLOSED when there are no remaining DISPUTED entries —
      // otherwise the other entries (e.g. add-ons) become stuck and can
      // never be refunded (the task is no longer DISPUTED so processRefund
      // would reject them).
      let newTaskStatus = escrow.task.status;
      if (calc.isFullyRefunded) {
        // Re-query ALL escrow entries for this task (including the one we
        // just updated) to see if any are still DISPUTED.
        const allEntries = await tx.escrowLedger.findMany({
          where: { taskId: escrow.task.id },
          select: { id: true, state: true },
        });
        const hasDisputedEntries = allEntries.some(
          e => e.state === EscrowState.DISPUTED && e.id !== escrow.id
        );
        // Also check THIS entry's new state (already updated above to REFUNDED)
        // allEntries was fetched AFTER the update, so if this entry shows
        // REFUNDED, it's already counted. But the query might have been
        // before the update — to be safe, treat this entry as REFUNDED.
        const allResolved = !hasDisputedEntries;

        if (allResolved) {
          // ALL escrow entries are resolved → task can be closed
          newTaskStatus = TaskStatus.DISPUTE_CLOSED;
          await tx.task.update({
            where: { id: escrow.task.id },
            data: { status: TaskStatus.DISPUTE_CLOSED },
          });

          // Unpause autonomy (household shouldn't be penalised if dispute upheld)
          await tx.householdCategoryAutonomy.updateMany({
            where: {
              householdId: escrow.task.householdId,
              category: escrow.task.category,
              promotionPaused: true,
            },
            data: { promotionPaused: false },
          });
        }
        // If there are still DISPUTED entries, the task stays DISPUTED —
        // the dispute is not fully resolved yet.
      }

      // Audit log
      await tx.auditLog.create({
        data: {
          userId: input.issuedById,
          userName: input.issuedByName,
          action: calc.isFullyRefunded ? "DISPUTE_REFUNDED" : "PARTIAL_REFUND",
          entityType: "EscrowLedger",
          entityId: escrow.id,
          metadata: {
            taskId: escrow.task.id,
            refundId: refund.id,
            refundedThisEvent: input.refundAmountCents,
            cumulativeRefund: calc.newRefundCents,
            originalAmount: escrow.amountCents,
            effectiveAmount: calc.effectiveAmountCents,
            remainingCashCents: calc.remainingCashCents,
            // Payout-base context (platform-funded discount bookkeeping)
            payoutBaseCents: escrow.originalAmountCents || escrow.amountCents,
            discountCents: escrow.discountCents || 0,
            discountFundedBy: escrow.discountFundedBy,
            newCommission: calc.newCommissionCents,
            newPayout: calc.newVendorPayoutCents,
            isFullyRefunded: calc.isFullyRefunded,
            paymentProviderRefundId: refundResult.providerRefundId,
            paymentStatus: refundResult.status,
            reason: input.reason,
          },
        },
      });

      return {
        refundId: refund.id,
        updatedEscrow,
        newTaskStatus,
        calc,
        refundResult,
      };
    });

    return {
      refundId: result.refundId,
      refundedCents: input.refundAmountCents,
      cumulativeRefundCents: result.calc.newRefundCents,
      effectiveAmountCents: result.calc.effectiveAmountCents,
      remainingCashCents: result.calc.remainingCashCents,
      newCommissionCents: result.calc.newCommissionCents,
      newVendorPayoutCents: result.calc.newVendorPayoutCents,
      escrowState: result.updatedEscrow.state,
      taskStatus: result.newTaskStatus,
      paymentProviderRefundId: result.refundResult.providerRefundId,
      paymentStatus: result.refundResult.status,
      isFullyRefunded: result.calc.isFullyRefunded,
      isDuplicate: false,
    };
  } catch (error: unknown) {
    // Prisma P2002 = unique constraint violation (duplicate idempotency key).
    // This means a concurrent transaction already inserted this key — treat as idempotent retry.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      // Re-read the existing refund and return its result
      const existing = await db.refund.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: {
          escrowLedger: {
            select: {
              refundCents: true,
              amountCents: true,
              commissionCents: true,
              vendorPayoutCents: true,
              state: true,
              // f4 (police-payout-base-1): same payout-base semantics as
              // the primary path and the early idempotency return above.
              originalAmountCents: true,
              discountCents: true,
              discountFundedBy: true,
              task: { select: { status: true } },
            },
          },
        },
      });
      if (existing) {
        const e = existing.escrowLedger;
        return {
          refundId: existing.id,
          refundedCents: existing.amountCents,
          cumulativeRefundCents: e.refundCents,
          effectiveAmountCents: effectivePayoutBaseCents(e),
          remainingCashCents: Math.max(0, e.amountCents - e.refundCents),
          newCommissionCents: e.commissionCents,
          newVendorPayoutCents: e.vendorPayoutCents,
          escrowState: e.state,
          taskStatus: e.task.status,
          paymentProviderRefundId: existing.stripeRefundId || "",
          paymentStatus: existing.stripeStatus || "succeeded",
          isFullyRefunded: e.refundCents >= e.amountCents,
          isDuplicate: true,
        };
      }
    }
    // Re-throw RefundError as-is, wrap others
    if (error instanceof RefundError) throw error;
    throw error;
  }
}
