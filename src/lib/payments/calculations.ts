/**
 * Escrow Financial Calculations
 * =============================
 *
 * Pure functions for escrow commission/payout/refund math.
 * No DB, no side effects, no I/O — fully unit-testable.
 *
 * The key invariant: after a refund, commission and payout are
 * recalculated on the EFFECTIVE amount (original − cumulative refund),
 * not the original amount.
 */

export interface EscrowFigures {
  amountCents: number;          // original amount held
  refundCents: number;          // cumulative amount refunded
  commissionRate: number;       // e.g. 10.0 for 10%
  commissionCents: number;      // commission on effective amount
  vendorPayoutCents: number;    // payout on effective amount
}

export interface RefundCalcResult {
  newRefundCents: number;       // cumulative after this refund
  refundedThisEvent: number;    // amount refunded in THIS event
  effectiveAmountCents: number; // amount - newRefundCents
  newCommissionCents: number;   // recalculated commission
  newVendorPayoutCents: number; // recalculated payout
  isFullyRefunded: boolean;    // true if effectiveAmount === 0
}

/**
 * Round to nearest cent using standard rounding (matches existing codebase
 * which uses Math.round). Documented here so the policy is explicit.
 */
function round(cents: number): number {
  return Math.round(cents);
}

/**
 * Calculate commission + payout for a given amount and rate.
 *   commission = round(amount × rate / 100)
 *   payout     = amount − commission
 */
export function calcCommissionAndPayout(
  amountCents: number,
  commissionRate: number
): { commissionCents: number; vendorPayoutCents: number } {
  const commissionCents = round((amountCents * commissionRate) / 100);
  return {
    commissionCents,
    vendorPayoutCents: amountCents - commissionCents,
  };
}

/**
 * Calculate the state of an escrow entry after a new refund event.
 *
 * Rules:
 *   - The new cumulative refund must not exceed the original amount.
 *   - Commission + payout are recalculated on (amount − cumulative refund).
 *   - If cumulative refund == amount, the escrow is "fully refunded"
 *     (commission = 0, payout = 0).
 *
 * @throws if refundAmountCents ≤ 0
 * @throws if (existingRefundCents + refundAmountCents) > amountCents
 */
export function calculateRefundImpact(params: {
  amountCents: number;
  existingRefundCents: number;
  refundAmountCents: number;
  commissionRate: number;
}): RefundCalcResult {
  const { amountCents, existingRefundCents, refundAmountCents, commissionRate } = params;

  if (refundAmountCents <= 0) {
    throw new Error("Refund amount must be greater than 0");
  }

  const newRefundCents = existingRefundCents + refundAmountCents;

  if (newRefundCents > amountCents) {
    throw new Error(
      `Refund exceeds original amount: existing refund ${existingRefundCents} + ` +
      `new refund ${refundAmountCents} = ${newRefundCents} > amount ${amountCents}`
    );
  }

  const effectiveAmountCents = amountCents - newRefundCents;
  const { commissionCents, vendorPayoutCents } = calcCommissionAndPayout(
    effectiveAmountCents,
    commissionRate
  );

  return {
    newRefundCents,
    refundedThisEvent: refundAmountCents,
    effectiveAmountCents,
    newCommissionCents: commissionCents,
    newVendorPayoutCents: vendorPayoutCents,
    isFullyRefunded: effectiveAmountCents === 0,
  };
}

/**
 * Compute the "order total" for a task: base task amount + sum of approved
 * add-on amounts. This is the authoritative figure all 4 roles should display.
 */
export function calculateOrderTotal(params: {
  baseAmountCents: number;
  addonAmountsCents: number[]; // only approved add-ons
}): { orderTotalCents: number; baseCents: number; addonsCents: number } {
  const addonsCents = params.addonAmountsCents.reduce((s, a) => s + a, 0);
  return {
    orderTotalCents: params.baseAmountCents + addonsCents,
    baseCents: params.baseAmountCents,
    addonsCents,
  };
}

/**
 * Given an escrow entry's current figures, compute the "remaining payable"
 * (what is still owed to the vendor after refunds, before commission).
 */
export function remainingPayable(escrow: {
  amountCents: number;
  refundCents: number;
}): number {
  return Math.max(0, escrow.amountCents - escrow.refundCents);
}

/**
 * Sum the amountCents of ALL escrow entries for a task (base + add-ons).
 * This is the authoritative "Order Total" that all dispute/escrow displays
 * should reference — NOT just the first entry's amountCents.
 *
 * Each add-on creates a separate EscrowLedger row, so a task with a $40
 * base service and an $18 approved add-on has TWO escrow entries:
 *   [{ amountCents: 4000 }, { amountCents: 1800 }]
 * This function returns 5800 ($58.00).
 */
export function sumEscrowEntries(
  entries: { amountCents: number }[]
): number {
  return entries.reduce((sum, e) => sum + e.amountCents, 0);
}

/**
 * Sum the refundCents of ALL escrow entries for a task (cumulative across
 * base + add-on refunds). Used for the "Total Refunded" display.
 */
export function sumRefundCents(
  entries: { refundCents: number }[]
): number {
  return entries.reduce((sum, e) => sum + (e.refundCents || 0), 0);
}
