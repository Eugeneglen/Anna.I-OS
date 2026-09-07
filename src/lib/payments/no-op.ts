/**
 * NoOpPaymentService
 * ==================
 *
 * Default implementation used in:
 *   - Local development (no provider keys)
 *   - Sandbox / preview environments
 *   - Automated tests
 *
 * PENDING PAYMENT GATEWAY DECISION — this is the ONLY implementation until
 * the client chooses a payment provider (Stripe Connect and alternatives
 * under evaluation). All methods succeed without moving real money.
 * Provider reference IDs are synthesised with a `noop_` prefix (derived
 * deterministically from the idempotency key) so they're distinguishable
 * from real provider IDs in the database and audit logs, and so a retry
 * with the same key yields the same reference.
 *
 * Idempotency is enforced at the DB layer (Refund.idempotencyKey @@unique),
 * not here — but this service never makes network calls, so duplicate calls
 * within the same transaction are caught by the unique constraint before
 * the second insert succeeds.
 */

import type {
  PaymentService,
  HoldParams,
  HoldResult,
  ReleaseParams,
  ReleaseResult,
  PayoutParams,
  PayoutResult,
  RefundParams,
  RefundResult,
} from "./types";

const NOOP_TAG = "[payments] NoOp adapter — Pending Payment Gateway Decision";

export class NoOpPaymentService implements PaymentService {
  readonly name = "NoOp";

  async hold(params: HoldParams): Promise<HoldResult> {
    this.validateCommon(params, "hold", { allowZero: true });
    const providerRef = `noop_hold_${params.idempotencyKey}`;
    console.log(
      `${NOOP_TAG} hold ${params.amountCents} ${params.currency} key=${params.idempotencyKey} ref=${providerRef} taskId=${String(params.metadata?.taskId ?? "-")}`
    );
    return {
      providerRef,
      amountCents: params.amountCents,
      status: "succeeded",
      processedAt: new Date().toISOString(),
    };
  }

  async release(params: ReleaseParams): Promise<ReleaseResult> {
    this.validateCommon(params, "release");
    const providerRef = `noop_release_${params.idempotencyKey}`;
    console.log(
      `${NOOP_TAG} release ${params.amountCents} ${params.currency} key=${params.idempotencyKey} ref=${providerRef} taskId=${String(params.metadata?.taskId ?? "-")}`
    );
    return {
      providerRef,
      amountCents: params.amountCents,
      status: "succeeded",
      processedAt: new Date().toISOString(),
    };
  }

  async payout(params: PayoutParams): Promise<PayoutResult> {
    this.validateCommon(params, "payout");
    const providerRef = `noop_payout_${params.idempotencyKey}`;
    console.log(
      `${NOOP_TAG} payout ${params.amountCents} ${params.currency} key=${params.idempotencyKey} ref=${providerRef} taskId=${String(params.metadata?.taskId ?? "-")} vendorId=${String(params.metadata?.vendorId ?? "-")}`
    );
    return {
      providerRef,
      amountCents: params.amountCents,
      status: "succeeded",
      processedAt: new Date().toISOString(),
    };
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    this.validateCommon(params, "refund");
    const providerRefundId = `noop_refund_${params.idempotencyKey}`;
    console.log(
      `${NOOP_TAG} refund ${params.amountCents} ${params.currency} key=${params.idempotencyKey} ref=${providerRefundId} taskId=${String(params.metadata?.taskId ?? "-")}`
    );
    return {
      providerRefundId,
      amountCents: params.amountCents,
      status: "succeeded",
      processedAt: new Date().toISOString(),
    };
  }

  /**
   * Shared validation. `allowZero` permits zero-amount holds (a 100%
   * platform-funded discount holds no customer cash — nothing to authorize).
   */
  private validateCommon(
    params: { amountCents: number; idempotencyKey: string; currency?: string },
    op: string,
    opts: { allowZero?: boolean } = {}
  ): void {
    if (params.amountCents < 0 || (params.amountCents === 0 && !opts.allowZero)) {
      throw new Error(`${op} amount must be greater than 0`);
    }
    if (!params.idempotencyKey) {
      throw new Error("idempotencyKey is required");
    }
    if (!params.currency) {
      throw new Error("currency is required");
    }
    // providerRef may be null in NoOp mode (no real prior provider operation).
  }
}
