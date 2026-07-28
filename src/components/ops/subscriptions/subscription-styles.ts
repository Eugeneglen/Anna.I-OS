// ============================================================
// Anna.I — Ops Subscriptions Shared Styles & Types
// ============================================================
// Colour/style maps and the SubItem type, shared between the
// desktop table, mobile card list, detail sheet, and action
// dialogs. Keeping them here avoids duplication and ensures
// every view stays in sync with the same tier/status palette.
// ============================================================

import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";

/** A single subscription row as returned by /api/ops/subscriptions. */
export interface SubItem {
  id: string;
  householdId: string;
  tier: "HOME" | "CARE";
  status: "ACTIVE" | "CANCELLED" | "PAST_DUE";
  priceCents: number;
  billingCycleStart: string;
  billingCycleEnd: string | null;
  nextBillingDate: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
  updatedAt: string;
  household: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    postalCode: string | null;
    activeCategories: string;
    createdAt: string;
  };
  stats: {
    completedTasks: number;
    totalSpendCents: number;
  };
}

/** Tailwind class strings for the HOME/CARE tier badges. */
export const TIER_STYLES: Record<
  string,
  { bg: string; text: string; label: string }
> = {
  HOME: {
    bg: "bg-[var(--anna-sage-light)]",
    text: "text-[var(--anna-sage-dark)]",
    label: "Home",
  },
  CARE: { bg: "bg-purple-50", text: "text-purple-700", label: "Care" },
};

/** Tailwind class strings + icon for the ACTIVE/CANCELLED/PAST_DUE badges. */
export const STATUS_STYLES: Record<
  string,
  { bg: string; text: string; icon: typeof CheckCircle2 }
> = {
  ACTIVE: { bg: "bg-emerald-50", text: "text-emerald-700", icon: CheckCircle2 },
  CANCELLED: { bg: "bg-red-50", text: "text-red-600", icon: XCircle },
  PAST_DUE: { bg: "bg-amber-50", text: "text-amber-700", icon: AlertCircle },
};
