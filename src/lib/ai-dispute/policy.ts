import { calculateRefundImpact } from "@/lib/payments/calculations";
import type { DisputeCaseData } from "./case-builder";

// ─────────────────────────────────────────────────────────────
// Phase 2 · Step 2.2 — CODE-FIRST POLICY ELIGIBILITY ENGINE
//
// Before the LLM is ever called, deterministic code computes
// what outcomes are legally/operationally POSSIBLE for this
// dispute (user spec §2):
//
//   dismiss | full refund | partial refund | voucher | manual review
//
// The LLM may ONLY choose from this code-generated eligible set
// and ONLY within the code-computed amount bounds. Anything the
// LLM returns outside this envelope is invalid → MANUAL REVIEW
// (never a silent refund fallback).
//
// Financial authority (§3): every amount below is computed from
// the live escrow figures through the EXISTING financial
// calculation logic (payments/calculations.ts) — the same code
// the refund service itself runs. The LLM has no financial
// authority; its amount (if any) is display-only and must fall
// inside these bounds to even be recorded.
// ─────────────────────────────────────────────────────────────

/** The complete action vocabulary Phase 2 may recommend/execute. */
export const POLICY_ACTIONS = [
  "resolve_dismiss",
  "resolve_refund",
  "partial_refund",
  "resolve_voucher",
  "manual_review",
] as const;
export type PolicyAction = (typeof POLICY_ACTIONS)[number];

export interface EligibleAction {
  action: PolicyAction;
  eligible: boolean;
  /** Why eligible / not — deterministic rule text (policy snapshot). */
  reason: string;
  /** Server-computed bounds. Present only for amount-bearing actions. */
  bounds?: {
    minAmountCents: number;
    maxAmountCents: number;
  };
}

export interface PolicyEvaluation {
  computedAt: string;
  qualifying: true;
  eligibleActions: EligibleAction[];
  /** The LLM's choice set — strictly the eligible subset. */
  allowedChoices: PolicyAction[];
  policyNotes: string[];
  /** Server-computed financial impact per eligible action (§3). */
  financialImpact: Record<
    string,
    {
      label: string;
      refundAmountCents?: number; // household cash leg for this action
      platformPromoLegCents?: number; // platform discount leg reversed
      newCommissionCents?: number;
      newVendorPayoutCents?: number;
      remainingCashCents?: number;
      voucherAmountCents?: number;
      note?: string;
    }
  >;
}

/** 2× order-value compensation cap (mirrors resolve_voucher route check). */
const COMPENSATION_CAP_MULTIPLIER = 2;

export function computeEligibleActions(caseData: DisputeCaseData): PolicyEvaluation {
  const primary = caseData.escrow.entries.find((e) => e.id === caseData.primaryEscrowId) ??
    caseData.escrow.entries[0];

  // ── Full refund: the server-computed executable amount. ──
  // Exactly what the ops route's resolve_refund uses:
  // escrow.amountCents − escrow.refundCents (per primary entry).
  const fullRemainingCents = Math.max(
    0,
    primary.amountCents - (primary.refundCents || 0)
  );

  // ── Partial refund bounds: 1 .. fullRemaining on the primary entry. ──
  const partialCapCents = fullRemainingCents;

  // ── Voucher compensation cap (F19/E7 cumulative, mirrors the route): ──
  const orderTotalCents = caseData.escrow.totals.orderTotalCashCents;
  const priorGranted =
    (primary.voucherCompensationCents || 0) + (primary.refundCreditCents || 0);
  const voucherCapCents = Math.max(
    0,
    COMPENSATION_CAP_MULTIPLIER * orderTotalCents - priorGranted
  );
  const consentOn = caseData.householdHistory.marketingConsent !== false;

  const eligibleActions: EligibleAction[] = [
    {
      action: "resolve_dismiss",
      eligible: true,
      reason:
        "Dispute active (task DISPUTED, escrow DISPUTED) — evidence may be judged unsubstantiated; dismiss resets escrow to HELD and task to COMPLETED.",
    },
    {
      action: "resolve_refund",
      eligible: true,
      reason:
        fullRemainingCents > 0
          ? `Full refund available: household cash leg ${fullRemainingCents} cents (entry holds ${primary.amountCents}, cumulative refunds ${primary.refundCents || 0}). Refund converts to refund credit (R3 — no cash payouts).`
          : "Zero-cash entry (100% platform-funded discount): full refund terminalizes the dispute with no cash movement; the consumed promo voucher is restored.",
      bounds: { minAmountCents: fullRemainingCents, maxAmountCents: fullRemainingCents },
    },
    {
      action: "partial_refund",
      eligible: partialCapCents >= 1,
      reason:
        partialCapCents >= 1
          ? `Partial refund available between 1 and ${partialCapCents} cents (remaining household cash on the primary entry). Commission/payout recalculated on the remainder.`
          : "No household cash remaining to partially refund (cumulative refunds already exhausted the entry).",
      bounds:
        partialCapCents >= 1
          ? { minAmountCents: 1, maxAmountCents: partialCapCents }
          : undefined,
    },
    {
      action: "resolve_voucher",
      eligible: consentOn && voucherCapCents >= 1,
      reason:
        !consentOn
          ? "Ineligible: household has marketing consent OFF — service-recovery vouchers cannot be issued (use refund-as-credit, which is consent-exempt)."
          : voucherCapCents < 1
            ? "Ineligible: cumulative compensation (prior vouchers + refund credits) already reached the 2× order-value cap."
            : `Compensation voucher available up to ${voucherCapCents} cents (2× order ${COMPENSATION_CAP_MULTIPLIER * orderTotalCents} − already granted ${priorGranted}). Vendor is still paid (escrow released). Requires marketing consent: ON.`,
      bounds:
        consentOn && voucherCapCents >= 1
          ? { minAmountCents: 1, maxAmountCents: voucherCapCents }
          : undefined,
    },
    {
      action: "manual_review",
      eligible: true,
      reason:
        "Always available — human judgement path when evidence is ambiguous, parties conflict, or any automated recommendation is unsuitable.",
    },
  ];

  // ── Server-computed financial impact via the EXISTING calculation
  // logic (the same functions the refund service executes). The LLM
  // never computes these; execution recomputes them again server-side. ──
  const financialImpact: PolicyEvaluation["financialImpact"] = {};

  // Dismiss: money stays held as-is.
  financialImpact.resolve_dismiss = {
    label: "Dismiss — escrow returns to HELD",
    refundAmountCents: 0,
    newCommissionCents: primary.commissionCents ?? 0,
    newVendorPayoutCents: primary.vendorPayoutCents ?? 0,
    remainingCashCents: fullRemainingCents,
    note: "No money moves; task returns to COMPLETED for re-verification.",
  };

  // Full refund: project with calculateRefundImpact at fullRemaining.
  if (fullRemainingCents > 0) {
    try {
      const calc = calculateRefundImpact({
        amountCents: primary.amountCents,
        existingRefundCents: primary.refundCents || 0,
        refundAmountCents: fullRemainingCents,
        commissionRate: primary.commissionRate,
        originalAmountCents: primary.originalAmountCents ?? undefined,
        discountCents: primary.discountCents || 0,
        discountFundedBy: primary.discountFundedBy ?? undefined,
        existingSubsidyReversedCents: primary.subsidyReversedCents || 0,
      });
      financialImpact.resolve_refund = {
        label: "Full refund — refund credit issued to household",
        refundAmountCents: fullRemainingCents,
        platformPromoLegCents: calc.platformDiscountLegCents,
        newCommissionCents: calc.newCommissionCents,
        newVendorPayoutCents: calc.newVendorPayoutCents,
        remainingCashCents: calc.remainingCashCents,
        note: "Escrow → REFUNDED; task → DISPUTE_CLOSED; refunded amount issued as refund credit (R3).",
      };
    } catch {
      financialImpact.resolve_refund = {
        label: "Full refund — refund credit issued to household",
        refundAmountCents: fullRemainingCents,
        note: "Projection unavailable; execution recomputes through processRefund.",
      };
    }
  } else {
    financialImpact.resolve_refund = {
      label: "Full refund — zero-cash entry",
      refundAmountCents: 0,
      platformPromoLegCents: Math.max(
        0,
        (primary.discountCents || 0) - (primary.subsidyReversedCents || 0)
      ),
      newCommissionCents: 0,
      newVendorPayoutCents: 0,
      remainingCashCents: 0,
      note: "No cash held; consumed platform promo voucher is restored.",
    };
  }

  // Partial refund: project at the CAP (worst case for vendor) — the
  // executable amount for any smaller partial is recomputed at decision
  // time by the same function.
  if (partialCapCents >= 1) {
    try {
      const calc = calculateRefundImpact({
        amountCents: primary.amountCents,
        existingRefundCents: primary.refundCents || 0,
        refundAmountCents: partialCapCents,
        commissionRate: primary.commissionRate,
        originalAmountCents: primary.originalAmountCents ?? undefined,
        discountCents: primary.discountCents || 0,
        discountFundedBy: primary.discountFundedBy ?? undefined,
        existingSubsidyReversedCents: primary.subsidyReversedCents || 0,
      });
      financialImpact.partial_refund = {
        label: `Partial refund — up to ${partialCapCents} cents as refund credit`,
        refundAmountCents: partialCapCents,
        newCommissionCents: calc.newCommissionCents,
        newVendorPayoutCents: calc.newVendorPayoutCents,
        remainingCashCents: calc.remainingCashCents,
        note: "Actual amount is chosen at decision time within bounds and recomputed server-side at execution.",
      };
    } catch {
      financialImpact.partial_refund = {
        label: `Partial refund — up to ${partialCapCents} cents as refund credit`,
        refundAmountCents: partialCapCents,
        note: "Projection unavailable; execution recomputes through processRefund.",
      };
    }
  }

  // Voucher: cap only — the amount is chosen at decision time.
  if (consentOn && voucherCapCents >= 1) {
    financialImpact.resolve_voucher = {
      label: `Compensation voucher — up to ${voucherCapCents} cents`,
      voucherAmountCents: voucherCapCents,
      note: "Vendor is paid in full (escrow released); optional mixed-mode refund portion converts to refund credit.",
    };
  }

  financialImpact.manual_review = {
    label: "Manual review — no automated action",
    refundAmountCents: 0,
    note: "A human resolves through the standard escrow controls; nothing executes automatically.",
  };

  const allowedChoices = eligibleActions
    .filter((a) => a.eligible)
    .map((a) => a.action);

  const policyNotes: string[] = [
    "R3: all refunds convert to refund credit (store credit) — no cash payouts, ever.",
    `Two-way split: household cash leg (refunds) vs platform promo leg (restored voucher on full refund). Cumulative reversed so far: ${caseData.escrow.totals.totalSubsidyReversedCents} cents.`,
    "Maker-checker: every refund-class execution requires refundConfirmed=true + resolution note through the existing escrow PATCH path.",
    `Household marketing consent: ${consentOn ? "ON" : "OFF"} — governs service-recovery voucher eligibility.`,
    `Vendor dispute rate: ${caseData.vendorHistory ? `${caseData.vendorHistory.disputeRate * 100}% (${caseData.vendorHistory.disputedJobs}/${caseData.vendorHistory.totalJobs} jobs)` : "no vendor on the task"}.`,
    `Household dispute rate: ${caseData.householdHistory.disputeRate * 100}% (${caseData.householdHistory.disputedTasks}/${caseData.householdHistory.totalTasks} tasks).`,
    "LLM constraint: the model may ONLY pick an action from the eligible set with amounts inside the bounds; anything else is rejected and the case falls back to MANUAL REVIEW.",
  ];

  return {
    computedAt: new Date().toISOString(),
    qualifying: true,
    eligibleActions,
    allowedChoices,
    policyNotes,
    financialImpact,
  };
}

/**
 * Validate a proposed decision-time action against a FRESH policy
 * evaluation (the policy snapshot at decision time, not generation
 * time). Used by the decision route so conditions that changed
 * since generation are caught before any execution is prepared.
 */
export function isActionEligible(
  policy: PolicyEvaluation,
  action: string
): EligibleAction | undefined {
  return policy.eligibleActions.find((a) => a.action === action && a.eligible);
}
