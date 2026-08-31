/**
 * Escrow Financial Calculations
 * =============================
 *
 * Pure functions for escrow commission/payout/refund math.
 * No DB, no side effects, no I/O — fully unit-testable.
 *
 * ── Payout base & platform-funded discounts (business rule) ──
 *
 * Promo codes and refund credits are funded by Anna.I, NOT by the vendor.
 * The vendor is therefore paid on the FULL job value (the payout base),
 * never on the post-discount cash the customer actually paid:
 *
 *   GBV (payout base)  = originalAmountCents   (pre-discount job value)
 *   customer cash held = amountCents           (post-discount, in escrow)
 *   commission         = round(payoutBase × rate / 100)
 *   vendor payout      = payoutBase − commission
 *   platform subsidy   = payoutBase − amountCents (absorbed by Anna.I at release)
 *
 * Funding equation (invariant, per entry):
 *   commission + payout + refundCents + reversedDiscount (when applied) = payoutBase
 *
 * Refunds return CUSTOMER CASH only (capped at amountCents). When a full
 * refund exhausts the customer cash on a platform-discounted entry, the
 * consumed discount is treated as REVERSED back to the household (the
 * restore-voucher step on the full-refund/cancel paths does exactly this),
 * which zeroes the effective payout base: the vendor earns nothing on a
 * fully refunded job and the household is made whole.
 *
 * After a refund, commission and payout are recalculated on the EFFECTIVE
 * payout base (payoutBase − cumulative refund − reversal), not the raw
 * original amount.
 */

export interface EscrowFigures {
  amountCents: number;          // customer cash held (post-discount)
  refundCents: number;          // cumulative amount refunded
  commissionRate: number;       // e.g. 10.0 for 10%
  commissionCents: number;      // commission on effective payout base
  vendorPayoutCents: number;    // payout on effective payout base
}

export interface RefundCalcResult {
  newRefundCents: number;       // cumulative after this refund
  refundedThisEvent: number;    // amount refunded in THIS event
  effectiveAmountCents: number; // effective PAYOUT BASE (base − refund − reversal)
  remainingCashCents: number;   // customer cash still held (amount − cumulative refund, floored)
  newCommissionCents: number;   // recalculated commission
  newVendorPayoutCents: number; // recalculated payout
  isFullyRefunded: boolean;     // true if effective payout base === 0
}

/**
 * Round to nearest cent using standard rounding (matches existing codebase
 * which uses Math.round). Documented here so the policy is explicit.
 */
function round(cents: number): number {
  return Math.round(cents);
}

/**
 * Entry shape needed to derive the payout base. All fields except
 * amountCents are optional so bare { amountCents } entries keep working.
 */
export interface PayoutBaseInput {
  amountCents: number;
  /** Pre-discount job value. 0 / undefined = no discount was captured. */
  originalAmountCents?: number;
  /** Discount amount captured in this escrow entry. */
  discountCents?: number;
  /** "PLATFORM" | "VENDOR" | "CAMPAIGN" — who absorbs the discount. */
  discountFundedBy?: string;
}

/**
 * True when this entry carries a discount that Anna.I funds (i.e. one that
 * must NOT reduce the vendor's earnings). Only an explicit "VENDOR" funder
 * is treated as vendor-absorbed; "PLATFORM" (the only value ever written
 * today) and the unused "CAMPAIGN" value are platform-funded.
 */
export function isPlatformFundedDiscount(entry: {
  discountCents?: number;
  discountFundedBy?: string;
  originalAmountCents?: number;
}): boolean {
  const discount = entry.discountCents || 0;
  const original = entry.originalAmountCents || 0;
  return discount > 0 && original > 0 && entry.discountFundedBy !== "VENDOR";
}

/**
 * The base commission and payout are calculated on. Equals the pre-discount
 * job value for platform-funded discounts; equals the held amount otherwise
 * (no discount, or a vendor-funded discount which legitimately reduces the
 * vendor's earnings).
 */
export function payoutBaseCents(entry: PayoutBaseInput): number {
  if (isPlatformFundedDiscount(entry)) {
    return entry.originalAmountCents as number;
  }
  return entry.amountCents;
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
 *   - The new cumulative refund must not exceed the CUSTOMER CASH held
 *     (amountCents) — refunds return household money, and the household's
 *     cash stake in this escrow is amountCents.
 *   - Commission + payout are recalculated on the effective PAYOUT BASE:
 *       payoutBase − cumulative refund − reversal
 *     where the reversal (the platform-funded discount handed back to the
 *     household via voucher restore) applies automatically once the
 *     customer cash is exhausted — full refunds zero the vendor's earnings.
 *   - If the effective payout base is 0, the escrow is "fully refunded"
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
  /** Payout-base context (pre-discount value etc.). Optional — absent = no discount. */
  originalAmountCents?: number;
  discountCents?: number;
  discountFundedBy?: string;
}): RefundCalcResult {
  const {
    amountCents,
    existingRefundCents,
    refundAmountCents,
    commissionRate,
  } = params;

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

  const platformFunded = isPlatformFundedDiscount(params);
  const base = platformFunded
    ? (params.originalAmountCents as number)
    : amountCents;

  // Once all customer cash is returned on a platform-discounted entry, the
  // consumed discount is reversed to the household as well (voucher
  // restore) — the effective payout base drops to zero.
  const cashExhausted = newRefundCents >= amountCents;
  const effectiveAmountCents = platformFunded
    ? (cashExhausted ? 0 : Math.max(0, base - newRefundCents))
    : Math.max(0, amountCents - newRefundCents);

  const { commissionCents, vendorPayoutCents } = calcCommissionAndPayout(
    effectiveAmountCents,
    commissionRate
  );

  return {
    newRefundCents,
    refundedThisEvent: refundAmountCents,
    effectiveAmountCents,
    remainingCashCents: Math.max(0, amountCents - newRefundCents),
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
 * (the order value still owed to the vendor after refunds, before
 * commission). Uses the payout base, so platform-funded discounts do not
 * reduce what the vendor is still owed.
 */
export function remainingPayable(escrow: PayoutBaseInput & {
  refundCents?: number;
}): number {
  const base = payoutBaseCents(escrow);
  return Math.max(0, base - (escrow.refundCents || 0));
}

/**
 * Sum the amountCents of ALL escrow entries for a task (base + add-ons).
 * This is the customer-cash total held — the household payment view.
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
 * Sum the PAYOUT BASE of ALL escrow entries for a task (base + add-ons).
 * This is the job-value ("order total") view: what the work is worth and
 * what vendor earnings are computed from, regardless of discounts.
 */
export function sumPayoutBaseEntries(
  entries: PayoutBaseInput[]
): number {
  return entries.reduce((sum, e) => sum + payoutBaseCents(e), 0);
}

/**
 * Sum the platform subsidy across escrow entries: the discount portion
 * funded by Anna.I (payout base − customer cash). 0 when no discount.
 */
export function sumPlatformSubsidyCents(
  entries: PayoutBaseInput[]
): number {
  return entries.reduce(
    (sum, e) => sum + Math.max(0, payoutBaseCents(e) - e.amountCents),
    0
  );
}

/**
 * Sum the refundCents of ALL escrow entries for a task (cumulative across
 * base + add-on refunds). Used for the "Total Refunded" display.
 */
export function sumRefundCents(
  entries: { refundCents?: number }[]
): number {
  return entries.reduce((sum, e) => sum + (e.refundCents || 0), 0);
}
