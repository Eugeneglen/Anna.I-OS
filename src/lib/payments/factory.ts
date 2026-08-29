/**
 * Payment Service — Factory
 * ========================
 *
 * Returns the active PaymentService implementation for the current environment.
 *
 * - When `STRIPE_SECRET_KEY` is set and not "test", returns StripePaymentService.
 * - Otherwise returns NoOpPaymentService (sandbox / dev / test).
 *
 * StripePaymentService is not yet implemented (see ./stripe.ts). Until it is,
 * the factory always returns NoOpPaymentService — refunds succeed in the DB
 * but no actual money is moved. This is documented and intentional for the
 * MVP scope (Stripe integration deferred).
 *
 * ── Adding Stripe later ──
 *
 *   1. Implement StripePaymentService in ./stripe.ts (uncomment the method bodies).
 *   2. Uncomment the StripePaymentService import + branch below.
 *   3. No changes to any API route, business logic, or frontend.
 */

import type { PaymentService } from "./types";
import { NoOpPaymentService } from "./no-op";

let _instance: PaymentService | null = null;

export function getPaymentService(): PaymentService {
  if (_instance) return _instance;

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const stripeEnabled = !!stripeKey && stripeKey !== "test";

  if (stripeEnabled) {
    // Future: uncomment when StripePaymentService is implemented.
    //
    //   import { StripePaymentService } from "./stripe";
    //   _instance = new StripePaymentService();
    //   return _instance;
    //
    // For now, log a warning and fall back to NoOpPaymentService so the app
    // doesn't crash when STRIPE_SECRET_KEY is set but Stripe isn't wired up.
    console.warn("[payments] StripePaymentService not yet implemented — falling back to NoOpPaymentService");
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
