/**
 * Payment Service — Type Definitions
 * ==================================
 *
 * The contract every payment provider implementation must satisfy.
 * See ./factory.ts for how the active implementation is chosen.
 *
 * ── PROVIDER-AGNOSTIC MONEY LIFECYCLE ──
 *
 * The interface covers the full escrow money lifecycle with
 * provider-agnostic signatures — NO provider-specific concepts
 * (payment intents, transfers, connected accounts) appear here; those live
 * inside a concrete adapter implementation only:
 *
 *   hold    — customer payment held/authorized at ESCROW CREATION   → ledger state HELD
 *   release — held payment captured/settled at ESCROW RELEASE       → ledger state RELEASED
 *   payout  — vendor transfer of the vendorPayoutCents at release   → ledger state RELEASED
 *   refund  — partial/full refund of customer cash (idempotent)     → ledger DISPUTED/REFUNDED
 *
 * ── LEDGER-AUTHORITY RULE (CRITICAL) ──
 *
 * The DB ledger (EscrowLedger states + the pure math in ./calculations.ts)
 * is the SINGLE SOURCE OF TRUTH. The PaymentService adapter is an effect
 * layer, never authoritative:
 *
 *   - The audit-verified funding invariant must keep holding per entry:
 *       commission + payout + refund + reversal = payoutBase
 *   - Adapter calls are wrapped in try/catch at the wiring layer
 *     (./escrow-effects.ts); failures are logged and MUST NOT corrupt
 *     ledger state. The NoOp adapter (the only implementation today)
 *     always succeeds, keeping flows deterministic.
 *   - Adapter transaction references (providerRef) are recorded in the
 *     structured logs. Where the DB already has columns for them, the
 *     historical stripePaymentIntentId / stripeTransferId columns on
 *     EscrowLedger are reused (schema is frozen — providerRef persistence
 *     for a real provider lands with the adapter).
 *
 * ── PENDING PAYMENT GATEWAY DECISION ──
 *
 * The client has NOT chosen a payment provider (Stripe Connect and
 * alternatives are under evaluation). The only implementation is
 * NoOpPaymentService; the dormant Stripe branch in ./factory.ts is a
 * documented placeholder. When a provider is chosen, the work is one
 * adapter file + one factory branch — no route, ledger, or frontend change.
 */

/** Status of a provider-side money operation. */
export type PaymentOpStatus = "succeeded" | "pending" | "failed";

/**
 * Provider-agnostic parameters shared by every money-movement method.
 * Implementations must be idempotent: calling a method twice with the same
 * idempotencyKey returns the SAME result (not a second money movement).
 */
export interface MoneyParams {
  /** Amount for THIS operation, in cents. */
  amountCents: number;
  /** ISO currency code (e.g. "SGD"). */
  currency: string;
  /** Idempotency key — provider + DB both enforce uniqueness. */
  idempotencyKey: string;
  /** Free-form audit metadata (taskId, bookingId, escrowLedgerId, actor...). */
  metadata?: Record<string, unknown>;
  /**
   * Provider-side reference from a PRIOR operation in this lifecycle (e.g.
   * the hold's providerRef when releasing or refunding). Null in NoOp mode —
   * no real charge exists.
   */
  providerRef?: string | null;
}

/** Parameters for a hold/authorize at escrow creation. */
export type HoldParams = MoneyParams;

/** Parameters for a release/capture at escrow release. */
export type ReleaseParams = MoneyParams;

/** Parameters for a vendor payout (vendor transfer at escrow release). */
export type PayoutParams = MoneyParams;

/** Parameters for a refund request (partial or full). */
export interface RefundParams extends MoneyParams {
  /** Human-readable reason (stored on the Refund row + sent to provider). */
  reason: string;
}

/**
 * Result of a provider-side money operation (hold / release / payout).
 * `providerRef` is the provider's reference for audit-trail storage.
 */
export interface PaymentOperationResult {
  /** Provider's reference for this operation (NoOp: noop_<op>_<key>). */
  providerRef: string;
  /** Amount processed in this event, in cents. */
  amountCents: number;
  /** Provider status: "succeeded" (final) or "pending" (async, e.g. bank transfer). */
  status: PaymentOpStatus;
  /** Provider-side timestamp (ISO string). */
  processedAt: string;
}

export type HoldResult = PaymentOperationResult;
export type ReleaseResult = PaymentOperationResult;
export type PayoutResult = PaymentOperationResult;

/** Result of a successful refund operation. (Shape kept for the
 * refund-service call site and the Refund row mapping.) */
export interface RefundResult {
  /** Provider's refund reference (NoOp: noop_refund_<key>). */
  providerRefundId: string;
  /** Amount refunded in this event, in cents. */
  amountCents: number;
  /** Provider status: "succeeded" (final) or "pending" (async, e.g. bank transfer). */
  status: PaymentOpStatus;
  /** Provider-side timestamp (ISO string). */
  processedAt: string;
}

/**
 * PaymentService — the interface all providers implement.
 *
 * Every method is async (providers may make network calls) and accepts an
 * idempotencyKey so retries are safe. Methods that move money return a
 * result object with the provider's reference for audit-trail storage.
 *
 * See the LEDGER-AUTHORITY RULE at the top of this file: implementations
 * are effect layers; the DB ledger remains the single source of truth.
 *
 * Pending Payment Gateway Decision: only NoOpPaymentService exists today.
 */
export interface PaymentService {
  /** Human-readable name for logging (e.g. "NoOp"). */
  readonly name: string;

  /**
   * Hold/authorize the customer payment when an escrow entry is created
   * (ledger state → HELD). amountCents is the CUSTOMER CASH held
   * (post-discount). Zero is valid (a 100% platform-funded discount holds
   * no cash) — implementations must succeed without a provider effect.
   *
   * @throws if amountCents < 0
   * @throws if idempotencyKey is empty
   */
  hold(params: HoldParams): Promise<HoldResult>;

  /**
   * Release/capture a held payment when escrow is released (ledger state →
   * RELEASED): settle the held customer cash to the platform. Vendor money
   * moves separately via payout().
   *
   * @throws if amountCents ≤ 0 (nothing held → no release effect needed)
   * @throws if idempotencyKey is empty
   */
  release(params: ReleaseParams): Promise<ReleaseResult>;

  /**
   * Transfer the vendor payout to the vendor's account (ledger state →
   * RELEASED). amountCents is the ledger's vendorPayoutCents figure.
   *
   * @throws if amountCents ≤ 0 (zero payout → no transfer)
   * @throws if idempotencyKey is empty
   */
  payout(params: PayoutParams): Promise<PayoutResult>;

  /**
   * Process a partial or full refund. If no provider charge exists
   * (NoOp mode), the implementation should still succeed.
   *
   * @throws if amountCents ≤ 0
   * @throws if idempotencyKey is empty
   */
  refund(params: RefundParams): Promise<RefundResult>;
}
