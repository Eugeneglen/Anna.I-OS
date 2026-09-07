/**
 * StripePaymentService (STUB — for future implementation)
 * ======================================================
 *
 * PENDING PAYMENT GATEWAY DECISION — the client has NOT chosen a payment
 * provider (Stripe Connect and alternatives are under evaluation). This
 * file is a documented placeholder for the Stripe branch only; if another
 * provider is chosen, an equivalent adapter implements the same
 * provider-agnostic PaymentService interface (src/lib/payments/types.ts)
 * and the factory gains one branch. No route, ledger, or frontend change
 * is required either way.
 *
 * It is intentionally NOT implemented. When a provider is chosen:
 *
 *   1. Implement hold()/release()/payout()/refund() below using the SDK.
 *      The interface is provider-agnostic ({ amountCents, currency,
 *      idempotencyKey, metadata, providerRef }) — map it to the provider's
 *      own concepts INSIDE this file only.
 *   2. Uncomment the StripePaymentService import + branch in factory.ts.
 *
 * ── Idempotency ──
 *
 * Providers with native idempotency-key support: pass the same
 * idempotencyKey from the params as the request's idempotency option so a
 * retry returns the original response instead of a second money movement.
 *
 * ── Ledger authority ──
 *
 * The DB ledger (EscrowLedger) stays the single source of truth; this
 * adapter is an effect layer. See the LEDGER-AUTHORITY RULE in types.ts.
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

export class StripePaymentService implements PaymentService {
  readonly name = "Stripe";

  // private stripe: Stripe;  // uncomment when implementing

  // constructor() {
  //   const key = process.env.STRIPE_SECRET_KEY;
  //   if (!key) throw new Error("STRIPE_SECRET_KEY is required");
  //   this.stripe = new Stripe(key, { apiVersion: "2025-04-30.basil" });
  // }

  async hold(_params: HoldParams): Promise<HoldResult> {
    // ── Future implementation (provider-specific — lives here only) ──
    //
    // const paymentIntent = await this.stripe.paymentIntents.create(
    //   { amount: params.amountCents, currency: params.currency.toLowerCase(), metadata: params.metadata },
    //   { idempotencyKey: params.idempotencyKey }
    // );
    // return { providerRef: paymentIntent.id, ... };

    throw new Error(
      "StripePaymentService.hold() is not yet implemented. " +
      "Pending Payment Gateway Decision — NoOpPaymentService is the active adapter."
    );
  }

  async release(_params: ReleaseParams): Promise<ReleaseResult> {
    // ── Future implementation (provider-specific — lives here only) ──
    //
    // const captured = await this.stripe.paymentIntents.capture(params.providerRef, { amount_to_capture: params.amountCents }, { idempotencyKey: params.idempotencyKey });
    // return { providerRef: captured.id, ... };

    throw new Error(
      "StripePaymentService.release() is not yet implemented. " +
      "Pending Payment Gateway Decision — NoOpPaymentService is the active adapter."
    );
  }

  async payout(_params: PayoutParams): Promise<PayoutResult> {
    // ── Future implementation (provider-specific — lives here only) ──
    //
    // const transfer = await this.stripe.transfers.create(
    //   { amount: params.amountCents, currency: params.currency.toLowerCase(), destination: <vendor connected account> },
    //   { idempotencyKey: params.idempotencyKey }
    // );
    // return { providerRef: transfer.id, ... };

    throw new Error(
      "StripePaymentService.payout() is not yet implemented. " +
      "Pending Payment Gateway Decision — NoOpPaymentService is the active adapter."
    );
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    // ── Future implementation (provider-specific — lives here only) ──
    //
    // if (!params.providerRef) {
    //   throw new Error("providerRef is required for Stripe refunds");
    // }
    // const refund = await this.stripe.refunds.create(
    //   { payment_intent: params.providerRef, amount: params.amountCents },
    //   { idempotencyKey: params.idempotencyKey }
    // );
    // return {
    //   providerRefundId: refund.id,
    //   amountCents: refund.amount,
    //   status: refund.status === "succeeded" ? "succeeded" : "pending",
    //   processedAt: new Date(refund.created * 1000).toISOString(),
    // };

    void params;
    throw new Error(
      "StripePaymentService.refund() is not yet implemented. " +
      "Pending Payment Gateway Decision — NoOpPaymentService is the active adapter."
    );
  }
}
