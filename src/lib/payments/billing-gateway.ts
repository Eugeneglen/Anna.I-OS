/**
 * Billing Gateway — subscription charging seam
 * ============================================
 *
 * PENDING PAYMENT GATEWAY DECISION — the client has NOT chosen a payment
 * provider (Stripe Connect and alternatives are under evaluation). This
 * module isolates the SEAM where household subscription charging will plug
 * in, so charging can later be enforced WITHOUT touching any
 * subscription-granting call site (the future adapter = one file + one
 * factory branch here).
 *
 * CURRENT BEHAVIOR (unchanged by design — do not wire this into the
 * granting routes yet):
 *   - Subscriptions (HOME/CARE tiers) are granted without payment: at
 *     onboarding and via Ops. The NoOp gateway below mirrors exactly that:
 *     checkEntitlement() always returns entitled, createCheckoutIntent()
 *     returns a synthetic reference with no hosted checkout URL.
 *   - The existing Stripe billing code (src/lib/stripe.ts + /api/billing/*)
 *     stays dormant behind env keys and is NOT modified.
 *
 * WHEN A PROVIDER IS CHOSEN:
 *   - Implement a real BillingGateway adapter (createCheckoutIntent →
 *     hosted checkout / mandate; checkEntitlement → paid-until check).
 *   - Swap the factory branch below.
 *   - THEN (and only then) route subscription grants through
 *     checkEntitlement() at the granting call sites to enforce payment.
 *     Until that day, no call site changes are needed — that is the point
 *     of the seam.
 */

// ── Types (provider-agnostic) ──

export interface CheckoutIntentParams {
  householdId: string;
  /** Subscription tier, e.g. "HOME" | "CARE". */
  tier: string;
  currency?: string;
  /** Monthly price in cents (e.g. 800 for HOME) — informational for the adapter. */
  amountCents?: number;
  metadata?: Record<string, unknown>;
}

export interface CheckoutIntentResult {
  /** Provider's reference for this checkout intent (NoOp: noop_billing_<...>). */
  providerRef: string;
  /** Hosted checkout URL to redirect to; null = no hosted flow (NoOp mode). */
  checkoutUrl: string | null;
  status: "succeeded" | "pending" | "failed";
}

export interface EntitlementCheckParams {
  householdId: string;
  tier?: string;
}

export interface EntitlementCheckResult {
  /** Whether the household is entitled to the tier (paid / comped). */
  entitled: boolean;
  /** Why (or why not) — surfaced in logs and future UI copy. */
  reason: string;
}

export interface BillingGateway {
  /** Human-readable name for logging (e.g. "NoOp"). */
  readonly name: string;
  /** Start a checkout/charge flow for a subscription tier. */
  createCheckoutIntent(params: CheckoutIntentParams): Promise<CheckoutIntentResult>;
  /** Check whether a household is entitled to a tier (payment enforcement point). */
  checkEntitlement(params: EntitlementCheckParams): Promise<EntitlementCheckResult>;
}

// ── NoOp adapter (active — Pending Payment Gateway Decision) ──

const NOOP_TAG = "[payments] NoOp billing gateway — Pending Payment Gateway Decision";

export class NoOpBillingGateway implements BillingGateway {
  readonly name = "NoOp";

  async createCheckoutIntent(
    params: CheckoutIntentParams
  ): Promise<CheckoutIntentResult> {
    const providerRef = `noop_billing_${params.householdId}_${params.tier}`;
    console.log(
      `${NOOP_TAG} createCheckoutIntent tier=${params.tier} household=${params.householdId} ` +
      `amount=${params.amountCents ?? 0} ref=${providerRef} (no hosted checkout — subscription granted without charging)`
    );
    return {
      providerRef,
      checkoutUrl: null,
      status: "succeeded",
    };
  }

  async checkEntitlement(
    params: EntitlementCheckParams
  ): Promise<EntitlementCheckResult> {
    console.log(
      `${NOOP_TAG} checkEntitlement tier=${params.tier ?? "any"} household=${params.householdId} → entitled (granted without charging)`
    );
    return {
      entitled: true,
      reason:
        "NoOp billing gateway — subscription granted without charging (Pending Payment Gateway Decision)",
    };
  }
}

// ── Factory (env-driven, provider-agnostic — mirrors payments/factory.ts) ──

let _instance: BillingGateway | null = null;

export function getBillingGateway(): BillingGateway {
  if (_instance) return _instance;

  // Dormant provider branch placeholder — Pending Payment Gateway Decision:
  //
  //   import { StripeBillingGateway } from "./billing-stripe";
  //   const key = process.env.STRIPE_SECRET_KEY;
  //   if (key && key !== "test") {
  //     _instance = new StripeBillingGateway();
  //     return _instance;
  //   }

  _instance = new NoOpBillingGateway();
  return _instance;
}

/** Test-only: inject a mock BillingGateway. Returns a reset function. */
export function __setBillingGatewayForTesting(
  gateway: BillingGateway | null
): () => void {
  const prev = _instance;
  _instance = gateway;
  return () => { _instance = prev; };
}
