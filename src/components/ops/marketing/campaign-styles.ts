// ============================================================
// Anna.I — Ops Marketing Shared Styles & Formatters
// ============================================================
// Colour/style maps and small pure-formatters for the Marketing
// module. Kept here (no JSX, no "use client") so it can be
// imported from both server and client components. Mirrors the
// pattern used by subscriptions/subscription-styles.ts.
// ============================================================

import type {
  CampaignStatus,
  CampaignType,
  CampaignAppliesTo,
  DiscountEligibility,
  DiscountRule,
} from "./types";

/** Tailwind class strings + label for each campaign status. */
export const STATUS_STYLES: Record<
  CampaignStatus,
  { bg: string; text: string; dot: string; label: string }
> = {
  DRAFT: {
    bg: "bg-[var(--anna-bg)]",
    text: "text-[var(--anna-muted)]",
    dot: "bg-[var(--anna-muted)]",
    label: "Draft",
  },
  ACTIVE: {
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
    label: "Active",
  },
  PAUSED: {
    bg: "bg-amber-50",
    text: "text-amber-700",
    dot: "bg-amber-500",
    label: "Paused",
  },
  ENDED: {
    bg: "bg-rose-50",
    text: "text-rose-700",
    dot: "bg-rose-500",
    label: "Ended",
  },
};

/** Tailwind class strings + label for each campaign type. */
export const TYPE_STYLES: Record<
  CampaignType,
  { bg: string; text: string; label: string }
> = {
  FIRST_TIME: {
    bg: "bg-[var(--anna-sage-light)]",
    text: "text-[var(--anna-sage-dark)]",
    label: "First-Time",
  },
  CROSS_SELL: {
    bg: "bg-[var(--anna-sage-light)]",
    text: "text-[var(--anna-sage-dark)]",
    label: "Cross-Sell",
  },
  UPGRADE: {
    bg: "bg-[var(--anna-sage-light)]",
    text: "text-[var(--anna-sage-dark)]",
    label: "Upgrade",
  },
  REFERRAL: {
    bg: "bg-[var(--anna-sage-light)]",
    text: "text-[var(--anna-sage-dark)]",
    label: "Referral",
  },
  PUBLIC_PROMO: {
    bg: "bg-[var(--anna-sage-light)]",
    text: "text-[var(--anna-sage-dark)]",
    label: "Public Promo",
  },
  OTHER: {
    bg: "bg-[var(--anna-bg)]",
    text: "text-[var(--anna-slate-light)]",
    label: "Other",
  },
  SERVICE_RECOVERY: {
    bg: "bg-violet-50",
    text: "text-violet-700",
    label: "Service Recovery",
  },
  REFUND_CREDIT: {
    bg: "bg-[var(--anna-slate-light)]/15",
    text: "text-[var(--anna-slate-light)]",
    label: "Refund Credit",
  },
};

export const APPLIES_TO_LABELS: Record<CampaignAppliesTo, string> = {
  SUBSCRIPTION_FEE: "Subscription",
  JOB_COMMISSION: "Job",
  BOTH: "Both",
};

export const ELIGIBILITY_LABELS: Record<DiscountEligibility, string> = {
  FIRST_TIME_HOUSEHOLD_ONLY: "First-time only",
  EXISTING_HOUSEHOLD: "Existing only",
  ANY: "Anyone",
};

/**
 * Format a discount rule as a human-readable summary:
 *   - PERCENTAGE  → "15% off"
 *   - FIXED_AMOUNT → "$20 off"
 * Returns "—" if the rule is missing.
 */
export function formatDiscount(rule: DiscountRule | null | undefined): string {
  if (!rule) return "—";
  if (rule.discountType === "PERCENTAGE") {
    return `${rule.discountValue}% off`;
  }
  // FIXED_AMOUNT — discountValue is in SGD dollars
  return `$${Number(rule.discountValue).toLocaleString("en-SG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} off`;
}

/** Returns the discount code uppercased (codes are stored uppercased). */
export function formatCode(code: string): string {
  return code.toUpperCase();
}

/**
 * Generate an `id`-prefixed query key for React Query caches.
 * Exported so page + sheet + dialogs stay in sync.
 */
export const CAMPAIGN_QUERY_KEYS = {
  list: ["ops-campaigns"] as const,
  detail: (id: string) => ["ops-campaign", id] as const,
};
