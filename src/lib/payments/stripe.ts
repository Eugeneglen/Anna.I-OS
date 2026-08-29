/**
 * StripePaymentService (STUB — for future implementation)
 * ======================================================
 *
 * This file is the extension point for Stripe refund integration.
 * It is intentionally NOT implemented in the MVP scope — Stripe
 * integration is deferred. When ready, implement the methods below
 * using the Stripe SDK.
 *
 * ── Integration steps (when ready) ──
 *
 *   1. npm install stripe (already in package.json)
 *   2. Set env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 *   3. Implement refund() → call stripe.refunds.create({ payment_intent, amount, reason }, { idempotencyKey })
 *   4. Implement release() → call stripe.transfers.create({ amount, currency, destination }, { idempotencyKey })
 *   5. Uncomment the StripePaymentService branch in factory.ts
 *   6. Add webhook handler for `charge.refunded` + `refund.failed` events
 *
 * No business logic, API route, or frontend change is required —
 * everything already calls getPaymentService().refund() / .release().
 *
 * ── Idempotency ──
 *
 * Stripe's API supports idempotency keys natively. Pass the same
 * idempotencyKey from RefundParams as the second argument's
 * `idempotencyKey` option. Stripe will return the original response
 * on retry instead of creating a second refund.
 */

import type {
  PaymentService,
  RefundParams,
  RefundResult,
  ReleaseParams,
  ReleaseResult,
} from "./types";

export class StripePaymentService implements PaymentService {
  readonly name = "Stripe";

  // private stripe: Stripe;  // uncomment when implementing

  // constructor() {
  //   const key = process.env.STRIPE_SECRET_KEY;
  //   if (!key) throw new Error("STRIPE_SECRET_KEY is required");
  //   this.stripe = new Stripe(key, { apiVersion: "2025-04-30.basil" });
  // }

  async refund(params: RefundParams): Promise<RefundResult> {
    // ── Future implementation ──
    //
    // if (!params.paymentIntentId) {
    //   throw new Error("paymentIntentId is required for Stripe refunds");
    // }
    // const refund = await this.stripe.refunds.create(
    //   {
    //     payment_intent: params.paymentIntentId,
    //     amount: params.amountCents,
    //   },
    //   { idempotencyKey: params.idempotencyKey }
    // );
    // return {
    //   providerRefundId: refund.id,
    //   amountCents: refund.amount,
    //   status: refund.status === "succeeded" ? "succeeded" : "pending",
    //   processedAt: new Date(refund.created * 1000).toISOString(),
    // };

    throw new Error(
      "StripePaymentService is not yet implemented. " +
      "Set STRIPE_SECRET_KEY to 'test' or unset it to use NoOpPaymentService. " +
      "See src/lib/payments/README.md for integration steps."
    );
  }

  async release(_params: ReleaseParams): Promise<ReleaseResult> {
    // ── Future implementation ──
    //
    // const transfer = await this.stripe.transfers.create(
    //   {
    //     amount: params.amountCents,
    //     currency: "sgd",
    //     destination: params.destinationAccountId,
    //   },
    //   { idempotencyKey: params.idempotencyKey }
    // );

    throw new Error(
      "StripePaymentService.release() is not yet implemented. " +
      "See src/lib/payments/README.md for integration steps."
    );
  }
}
