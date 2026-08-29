/**
 * NoOpPaymentService
 * ==================
 *
 * Default implementation used in:
 *   - Local development (no Stripe keys)
 *   - Sandbox / preview environments
 *   - Automated tests
 *
 * All methods succeed without moving real money. Provider reference IDs are
 * synthesised with a `noop_` prefix so they're distinguishable from real
 * Stripe IDs in the database and audit logs.
 *
 * Idempotency is enforced at the DB layer (Refund.idempotencyKey @@unique),
 * not here — but this service never makes network calls, so duplicate calls
 * within the same transaction are caught by the unique constraint before
 * the second insert succeeds.
 */

import type {
  PaymentService,
  RefundParams,
  RefundResult,
  ReleaseParams,
  ReleaseResult,
} from "./types";

export class NoOpPaymentService implements PaymentService {
  readonly name = "NoOp";

  async refund(params: RefundParams): Promise<RefundResult> {
    this.validateRefundParams(params);

    return {
      providerRefundId: `noop_refund_${params.idempotencyKey}`,
      amountCents: params.amountCents,
      status: "succeeded",
      processedAt: new Date().toISOString(),
    };
  }

  async release(params: ReleaseParams): Promise<ReleaseResult> {
    if (params.amountCents <= 0) {
      throw new Error("Release amount must be greater than 0");
    }
    if (!params.idempotencyKey) {
      throw new Error("idempotencyKey is required");
    }

    return {
      providerTransferId: `noop_transfer_${params.idempotencyKey}`,
      amountCents: params.amountCents,
      status: "succeeded",
      processedAt: new Date().toISOString(),
    };
  }

  private validateRefundParams(params: RefundParams): void {
    if (params.amountCents <= 0) {
      throw new Error("Refund amount must be greater than 0");
    }
    if (!params.idempotencyKey) {
      throw new Error("idempotencyKey is required");
    }
    // paymentIntentId may be null in NoOp mode (no real charge exists).
  }
}
