/**
 * Escrow Adapter Effects — provider-agnostic money-transition wiring
 * =================================================================
 *
 * The ONLY layer that connects escrow money transitions in the API routes
 * to the PaymentService adapter (see ./factory.ts). Each helper corresponds
 * to one ledger state transition:
 *
 *   recordEscrowHoldEffect    — escrow entry CREATED (state HELD)          → adapter.hold()
 *   recordEscrowReleaseEffect — escrow entry RELEASED (state RELEASED)     → adapter.release() + adapter.payout()
 *
 * DESIGN RULES (see the LEDGER-AUTHORITY RULE in ./types.ts):
 *   - Call these AFTER the ledger transaction has committed. The DB ledger
 *     (EscrowLedger states, commission/payout/refund math) is the single
 *     source of truth — these effects are never authoritative and never
 *     roll back or veto a committed ledger transition.
 *   - Every adapter call is wrapped in try/catch: an adapter failure is
 *     logged (structured, "[payments]" tag) and does NOT corrupt ledger
 *     state. The NoOp adapter (the only implementation — Pending Payment
 *     Gateway Decision) always succeeds, so today's flows are fully
 *     deterministic. A real adapter that fails after a committed ledger
 *     transition becomes a reconciliation case — flagged in the logs.
 *   - Adapter transaction references (providerRef) are persisted where the
 *     DB already has columns: the hold ref → EscrowLedger.stripePaymentIntentId
 *     (historical column name — schema frozen), the payout ref →
 *     EscrowLedger.stripeTransferId. Persistence is best-effort and guarded
 *     (only fills a NULL ref on the expected state) so it can never fight
 *     the ledger.
 *   - Idempotency keys are derived from the escrow ledger entry id + the
 *     operation, so a retried effect yields the same provider reference.
 *
 * Refunds are NOT wired here — they flow through ./refund-service.ts, which
 * calls adapter.refund() inside its DB transaction (audit-verified design).
 */

import { db } from "@/lib/db";
import { EscrowState } from "@prisma/client";
import { getPaymentService } from "./factory";

const LOG_TAG = "[payments]";
/** Currency for all Anna.I money movement (single-market pilot: Singapore). */
const DEFAULT_CURRENCY = "SGD";

export interface EscrowHoldEffectInput {
  escrowLedgerId: string;
  taskId: string;
  bookingId: string | null;
  /** Customer cash held (post-discount). Can be 0 for a 100% platform-funded discount. */
  amountCents: number;
  currency?: string;
}

/**
 * Effect: hold/authorize the customer payment for a newly created escrow
 * entry (ledger state HELD). Called by the vendor booking-accept route and
 * the add-on approval route right after the escrow row is created.
 *
 * Never throws. On adapter failure the escrow entry stays as committed
 * (ledger-authoritative) — the missing hold is a reconciliation case.
 */
export async function recordEscrowHoldEffect(
  input: EscrowHoldEffectInput
): Promise<void> {
  const paymentService = getPaymentService();
  const idempotencyKey = `hold_${input.escrowLedgerId}`;
  try {
    const result = await paymentService.hold({
      amountCents: input.amountCents,
      currency: input.currency ?? DEFAULT_CURRENCY,
      idempotencyKey,
      metadata: {
        taskId: input.taskId,
        bookingId: input.bookingId,
        escrowLedgerId: input.escrowLedgerId,
        ledgerState: EscrowState.HELD,
      },
      providerRef: null,
    });

    // Persist the adapter hold reference into the existing escrow column
    // (historical name stripePaymentIntentId — schema frozen; a real
    // adapter's providerRef persistence lands with the adapter).
    const persisted = await db.escrowLedger.updateMany({
      where: {
        id: input.escrowLedgerId,
        state: EscrowState.HELD,
        stripePaymentIntentId: null,
      },
      data: { stripePaymentIntentId: result.providerRef },
    });
    if (persisted.count === 0) {
      console.warn(
        `${LOG_TAG} hold ref not persisted for escrow ${input.escrowLedgerId} ` +
        `(entry no longer HELD or ref already set) — providerRef=${result.providerRef}`
      );
    }
    console.log(
      `${LOG_TAG} escrow HELD effect recorded (adapter=${paymentService.name}) ` +
      `escrow=${input.escrowLedgerId} taskId=${input.taskId} amount=${input.amountCents} ` +
      `providerRef=${result.providerRef} — Pending Payment Gateway Decision`
    );
  } catch (err) {
    console.error(
      `${LOG_TAG} hold effect FAILED for escrow ${input.escrowLedgerId} ` +
      `(ledger stays authoritative — reconciliation case; adapter=${paymentService.name}):`,
      err
    );
  }
}

export interface EscrowReleaseEffectInput {
  escrowLedgerId: string;
  taskId: string;
  bookingId: string | null;
  vendorId: string | null;
  /** Customer cash that was held (captured at release). 0 = nothing held. */
  heldAmountCents: number;
  /** Vendor payout figure from the ledger (transferred at release). 0 = nothing to transfer. */
  payoutCents: number;
  /** Provider hold reference from the creation effect (EscrowLedger.stripePaymentIntentId). */
  providerHoldRef?: string | null;
  currency?: string;
}

/**
 * Effect: release/capture the held customer payment AND transfer the vendor
 * payout for a released escrow entry (ledger state RELEASED). Called by the
 * ops escrow release action, the ops resolve_voucher action (entries →
 * RELEASED with vendor paid), and the household escrow release route, right
 * after the ledger transition commits.
 *
 * Zero amounts skip their adapter call (nothing held / nothing to pay out).
 * Never throws. On adapter failure the released ledger figures stay as
 * committed — the missing money movement is a reconciliation case.
 */
export async function recordEscrowReleaseEffect(
  input: EscrowReleaseEffectInput
): Promise<void> {
  const paymentService = getPaymentService();
  const currency = input.currency ?? DEFAULT_CURRENCY;
  const metadata = {
    taskId: input.taskId,
    bookingId: input.bookingId,
    escrowLedgerId: input.escrowLedgerId,
    vendorId: input.vendorId,
    ledgerState: EscrowState.RELEASED,
  };

  try {
    // 1. Release/capture the held customer cash (settle to the platform).
    let releaseRef: string | null = null;
    if (input.heldAmountCents > 0) {
      const release = await paymentService.release({
        amountCents: input.heldAmountCents,
        currency,
        idempotencyKey: `release_${input.escrowLedgerId}`,
        metadata,
        providerRef: input.providerHoldRef ?? null,
      });
      releaseRef = release.providerRef;
      console.log(
        `${LOG_TAG} escrow release/capture recorded (adapter=${paymentService.name}) ` +
        `escrow=${input.escrowLedgerId} taskId=${input.taskId} amount=${input.heldAmountCents} ` +
        `providerRef=${release.providerRef} — Pending Payment Gateway Decision`
      );
    } else {
      console.log(
        `${LOG_TAG} escrow ${input.escrowLedgerId} released with 0 held cash — no release/capture effect`
      );
    }

    // 2. Transfer the vendor payout.
    if (input.payoutCents > 0) {
      const payout = await paymentService.payout({
        amountCents: input.payoutCents,
        currency,
        idempotencyKey: `payout_${input.escrowLedgerId}`,
        metadata,
        providerRef: releaseRef,
      });
      // Persist the adapter payout reference into the existing escrow column
      // (historical name stripeTransferId — schema frozen).
      const persisted = await db.escrowLedger.updateMany({
        where: {
          id: input.escrowLedgerId,
          state: EscrowState.RELEASED,
          stripeTransferId: null,
        },
        data: { stripeTransferId: payout.providerRef },
      });
      if (persisted.count === 0) {
        console.warn(
          `${LOG_TAG} payout ref not persisted for escrow ${input.escrowLedgerId} ` +
          `(entry no longer RELEASED or ref already set) — providerRef=${payout.providerRef}`
        );
      }
      console.log(
        `${LOG_TAG} vendor payout recorded (adapter=${paymentService.name}) ` +
        `escrow=${input.escrowLedgerId} taskId=${input.taskId} vendor=${input.vendorId ?? "-"} ` +
        `amount=${input.payoutCents} providerRef=${payout.providerRef} — Pending Payment Gateway Decision`
      );
    } else {
      console.log(
        `${LOG_TAG} escrow ${input.escrowLedgerId} released with 0 vendor payout — no transfer effect`
      );
    }
  } catch (err) {
    console.error(
      `${LOG_TAG} release/payout effect FAILED for escrow ${input.escrowLedgerId} ` +
      `(ledger stays authoritative — reconciliation case; adapter=${paymentService.name}):`,
      err
    );
  }
}

/**
 * Structured log for resolution paths that move NO provider money by
 * construction (e.g. the zero-cash full-refund resolution: no customer cash
 * was ever held, so there is nothing to refund or release at a provider).
 */
export function logNoProviderEffect(escrowLedgerId: string, reason: string): void {
  console.log(
    `${LOG_TAG} no provider effect for escrow ${escrowLedgerId} — ${reason} ` +
    `(Pending Payment Gateway Decision)`
  );
}
