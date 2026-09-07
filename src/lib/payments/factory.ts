/**
 * Payment Service — Factory
 * ========================
 *
 * Returns the active PaymentService implementation for the current environment.
 *
 * PENDING PAYMENT GATEWAY DECISION: the client has NOT chosen a payment
 * provider (Stripe Connect and alternatives are under evaluation). Until
 * one is chosen, the factory ALWAYS returns NoOpPaymentService — refunds,
 * holds, releases and payouts are ledger-only bookkeeping; no actual money
 * moves. This is documented and intentional.
 *
 * Selection is env-driven and provider-agnostic:
 *   - When a provider adapter is implemented AND its env credentials are
 *     present, the factory instantiates that adapter (one import + one
 *     branch — see the dormant Stripe placeholder below).
 *   - Otherwise: NoOpPaymentService.
 *
 * ── Adding a provider later ──
 *
 *   1. Implement the adapter in its own file (e.g. ./stripe.ts) against the
 *      provider-agnostic interface in ./types.ts.
 *   2. Uncomment the import + branch below.
 *   3. No changes to any API route, business logic, or frontend.
 */

import type { PaymentService } from "./types";
import { NoOpPaymentService } from "./no-op";

let _instance: PaymentService | null = null;

export function getPaymentService(): PaymentService {
  if (_instance) return _instance;

  // ── Dormant Stripe branch (placeholder — Pending Payment Gateway Decision) ──
  //
  // Uncomment when StripePaymentService is implemented:
  //
  //   import { StripePaymentService } from "./stripe";
  //   const stripeKey = process.env.STRIPE_SECRET_KEY;
  //   if (stripeKey && stripeKey !== "test") {
  //     _instance = new StripePaymentService();
  //     return _instance;
  //   }
  //
  // NOTE: until then, a set STRIPE_SECRET_KEY does NOT activate Stripe —
  // the NoOp adapter stays active so the app never crashes and the ledger
  // remains the single source of truth.
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (stripeKey && stripeKey !== "test") {
    console.warn(
      "[payments] STRIPE_SECRET_KEY is set but no provider adapter is implemented — " +
      "staying on NoOpPaymentService (Pending Payment Gateway Decision)."
    );
  }

  _instance = new NoOpPaymentService();
  return _instance;
}

/** Test-only: inject a mock PaymentService. Returns a reset function. */
export function __setPaymentServiceForTesting(svc: PaymentService | null): () => void {
  const prev = _instance;
  _instance = svc;
  return () => { _instance = prev; };
}
