// ============================================================
// Anna.I — Ops Households Shared Styles
// ============================================================
// Colour/style maps shared between the desktop table and the
// mobile card list. Keeping them here avoids duplication and
// ensures both views stay in sync.
// ============================================================

/** Tailwind class strings for subscription tier/status badges. */
export const SUBSCRIPTION_STYLES: Record<string, string> = {
  HOME: "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]",
  CARE: "bg-purple-50 text-purple-700",
  CANCELLED: "bg-red-50 text-red-600",
  PAST_DUE: "bg-amber-50 text-amber-700",
};
