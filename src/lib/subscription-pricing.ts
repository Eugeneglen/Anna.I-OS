// ============================================================
// Anna.I — Subscription tier pricing (F-5, Item 8 final review)
// ============================================================
//
// BUSINESS DECISION (confirmed by the owner, this review):
//   Home Service subscription = S$8 / month
//   CARE subscription          = S$68 / month
//
// AUTHORITY MODEL (Option C — hybrid, minimum viable):
//
//   Application authority  → THIS module. One declaration of the
//     business price per tier. Every writer of Subscription.priceCents
//     (self-signup, Google sign-up, Stripe webhook, Ops tier-change,
//     Ops household creation) stamps it from here, and every
//     tier-marketing display reads it from here.
//
//   Charge authority        → Stripe Price objects
//     (STRIPE_HOME_PRICE_ID / STRIPE_CARE_PRICE_ID). Whatever those
//     Price objects say is what a live checkout actually charges.
//
//   Alignment              → enforced at the integration boundaries:
//     · checkout (/api/billing/checkout) retrieves the Stripe Price
//       and REFUSES (503, fail-closed) when its amount diverges from
//       this module or cannot be verified — a misconfigured Stripe
//       price can never silently charge a different amount than the
//       app displays.
//     · webhook records the ACTUAL Stripe charge amount
//       (price.unit_amount) into Subscription.priceCents whenever it
//       is present, warning on divergence — the DB row mirrors what
//       Stripe really charges, and per-subscription displays read the
//       row, so display and charge cannot silently diverge either.
//
// EXISTING vs NEW subscriptions:
//   · Existing rows are NEVER blanket-repriced (no migration exists or
//     is needed — verified: the demo DB holds only HOME/800 rows).
//   · Ops tier change (upgrade/downgrade) re-stamps the row at THIS
//     module's price for the new tier — same as the previous
//     TIER_PRICES behaviour.
//   · Renewals are Stripe-managed recurring charges; the webhook only
//     mirrors what Stripe charges.
//
// DYNAMIC PRICING (PlatformConfig write surface, Ops price lever,
// repricing policy for existing cohorts) is deliberately NOT included —
// it requires the renewal/repricing/comms policy the owner has not yet
// defined. That is an Item 9 architecture decision. Until then, a price
// change is a code change to this module + Stripe Price update.
//
// Pure module — no DB, no server-only imports — safe for client
// components and API routes alike.
// ============================================================

/** Business price per subscription tier, in cents (SGD). */
export const SUBSCRIPTION_TIER_PRICES = {
  HOME: 800, // SGD $8/mo
  CARE: 6800, // SGD $68/mo
} as const;

export type SubscriptionTierKey = keyof typeof SUBSCRIPTION_TIER_PRICES;

/**
 * The application-authoritative price for a tier.
 * Unknown tiers throw — writers must be tier-validated upstream.
 */
export function getTierPriceCents(tier: SubscriptionTierKey): number {
  const price = SUBSCRIPTION_TIER_PRICES[tier];
  if (price === undefined) {
    throw new Error(`Unknown subscription tier: ${String(tier)}`);
  }
  return price;
}

/**
 * Price to persist for a subscription given the ACTUAL Stripe charge
 * amount (price.unit_amount) when available.
 *
 * Charge truth wins: when Stripe's Price object carries an amount, the
 * DB row records it — per-subscription displays then mirror the real
 * charge (the alignment check at checkout prevents divergence from
 * ever starting in the normal path; a divergence that appears anyway
 * is recorded, not papered over by the app's figure). When the Stripe
 * amount is unavailable (NoOp/demo flows, unexpected payload shapes),
 * the application module price is the fallback.
 */
export function stripePriceCentsForTier(
  unitAmountCents: number | null | undefined,
  tier: SubscriptionTierKey
): number {
  if (typeof unitAmountCents === "number" && Number.isFinite(unitAmountCents)) {
    return unitAmountCents;
  }
  return getTierPriceCents(tier);
}

/**
 * Whether a Stripe Price amount matches the application authority for
 * the tier — the checkout-boundary alignment check.
 */
export function isStripeTierPriceAligned(
  unitAmountCents: number | null | undefined,
  tier: SubscriptionTierKey
): boolean {
  return (
    typeof unitAmountCents === "number" &&
    Number.isFinite(unitAmountCents) &&
    unitAmountCents === getTierPriceCents(tier)
  );
}

/**
 * Marketing/notification copy for a tier's monthly price, e.g. "SGD $68".
 * Server-safe (no client formatting dependencies).
 */
export function formatTierMonthly(tier: SubscriptionTierKey): string {
  const cents = getTierPriceCents(tier);
  return `SGD $${(cents / 100).toFixed(0)}`;
}
