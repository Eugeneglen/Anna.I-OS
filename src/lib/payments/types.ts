/**
 * Payment Service — Type Definitions
 * ==================================
 *
 * The contract every payment provider implementation must satisfy.
 * See ./factory.ts for how the active implementation is chosen.
 */

/** Result of a successful refund operation. */
export interface RefundResult {
  /** Provider-specific refund ID (Stripe: re_xxx; NoOp: noop_xxx). */
  providerRefundId: string;
  /** Amount refunded in this event, in cents. */
  amountCents: number;
  /** Provider status: "succeeded" (final) or "pending" (async, e.g. bank transfer). */
  status: "succeeded" | "pending" | "failed";
  /** Provider-side timestamp (ISO string). */
  processedAt: string;
}

/** Result of a successful escrow release (vendor payout). */
export interface ReleaseResult {
  providerTransferId: string;
  amountCents: number;
  status: "succeeded" | "pending" | "failed";
  processedAt: string;
}

/** Parameters for a refund request. */
export interface RefundParams {
  /** The original payment intent / charge ID from the provider (Stripe: pi_xxx or ch_xxx). */
  paymentIntentId: string | null;
  /** Amount to refund in THIS call (cents). Must be > 0 and ≤ remaining chargeable. */
  amountCents: number;
  /** Human-readable reason (stored on the Refund row + sent to provider). */
  reason: string;
  /** Idempotency key — provider + DB both enforce uniqueness. */
  idempotencyKey: string;
}

/** Parameters for an escrow release (vendor payout). */
export interface ReleaseParams {
  paymentIntentId: string | null;
  /** The connected-account ID to transfer to (Stripe: acct_xxx). */
  destinationAccountId: string | null;
  amountCents: number;
  idempotencyKey: string;
}

/**
 * PaymentService — the interface all providers implement.
 *
 * Every method is async (providers may make network calls) and accepts an
 * idempotencyKey so retries are safe. Methods that move money return a result
 * object with the provider's reference ID for audit-trail storage.
 *
 * Implementations must be idempotent: calling refund() twice with the same
 * idempotencyKey returns the SAME result (not a second refund).
 */
export interface PaymentService {
  /** Human-readable name for logging (e.g. "NoOp", "Stripe"). */
  readonly name: string;

  /**
   * Process a refund. If `paymentIntentId` is null (NoOp / sandbox mode),
   * the implementation should still succeed (no real charge to refund).
   *
   * @throws if amountCents ≤ 0
   * @throws if idempotencyKey is empty
   */
  refund(params: RefundParams): Promise<RefundResult>;

  /**
   * Release held escrow to the vendor (transfer / payout).
   * In NoOp mode this is a no-op that returns a synthetic transfer ID.
   */
  release(params: ReleaseParams): Promise<ReleaseResult>;
}
