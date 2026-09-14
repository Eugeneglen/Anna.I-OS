# Item 8 — F-5: Subscription Pricing Inventory & Architectural Classification

**Status: DECISION APPLIED (Item 8 final review).** The owner confirmed the
business prices — **Home Service S$8/mo, CARE S$68/mo** — and the hybrid
authority model below was implemented in the final-review round. See
`src/lib/subscription-pricing.ts` (the single application authority) and
the “Applied implementation” section at the end of this document.

Historical note (pre-decision): this document originally recorded the
inventory and STOPPED at the architectural decision. The inventory below
is preserved verbatim as the audit trail of what was found.

This is a DEMO environment: Stripe is disabled (`STRIPE_SECRET_KEY` unset or
"test" → `isBillingEnabled()` false, NoOp billing gateway). No real charge
can occur today; the conflict below corrupted DATA and DISPLAY, not money.

---

## 1. Every subscription price literal (exhaustive, current codebase)

### HOME tier — 800 cents (SGD $8/mo) — NO conflict
| # | Site | Kind | Value |
|---|------|------|-------|
| 1 | `src/app/api/household/register/route.ts:83` | WRITE (Subscription.priceCents on register) | 800 |
| 2 | `src/app/api/auth/google-bridge/route.ts:236` | WRITE (same, Google sign-up path) | 800 |
| 3 | `src/app/api/billing/webhook/route.ts:121` | WRITE (Stripe event → priceCents) | 800 |
| 4 | `src/app/api/billing/webhook/route.ts:217` | WRITE (Stripe event → priceCents) | 800 |
| 5 | `src/app/api/ops/subscriptions/[id]/route.ts` (TIER_PRICES.HOME, lines 54/111/…) | WRITE (ops tier change) + `priceChange:{from:800,…}` audit metadata | 800 |

### CARE tier — **CONFLICT: two values in live code**
| # | Site | Kind | Value |
|---|------|------|-------|
| 6 | `src/app/api/billing/webhook/route.ts:121` | WRITE | **6800** |
| 7 | `src/app/api/billing/webhook/route.ts:217` | WRITE | **6800** |
| 8 | `src/app/api/ops/subscriptions/[id]/route.ts` (TIER_PRICES.CARE; body text "SGD $68/mo") | WRITE + notification copy | **6800** |
| 9 | `src/components/ops/subscriptions/subscription-detail-sheet.tsx:167` | DISPLAY ("Upgrade to Care ($68/mo)") | **6800** |
| 10 | `src/components/ops/subscriptions/subscription-overview.tsx:57` | DISPLAY (MRR `activeCare * 6800`) | **6800** |
| 11 | `src/components/ops/subscriptions/subscription-action-dialog.tsx:119/122` | DISPLAY (upgrade/downgrade copy) | **6800** |
| 12 | `src/components/anna/billing-section.tsx:171/196` | DISPLAY (user-facing "SGD $68/mo", "Upgrade to Care — SGD $68/mo") | **6800** |
| 13 | `src/app/api/ops/households/route.ts:95` | WRITE (ops-created household CARE subscription) | **2000** |
| 14 | `src/components/ops/households/create-household-dialog.tsx:129` | DISPLAY ("Care ($20/mo)") | **2000** |

## 2. Readers / writers / DB / display / charge authority

- **DB price**: `Subscription.priceCents` (per household row). Writers: #1,
  #2, #3/#4, #5/#8, #13. The DB therefore already contains BOTH 6800 and
  2000 CARE rows depending on which flow created them.
- **Display readers of the DB value** (correctly data-driven):
  `billing-section.tsx:137` (`formatSgd(sub.priceCents)`),
  `subscription-table.tsx:72`, `subscription-mobile-card.tsx:56`,
  `subscription-detail-sheet.tsx:104`,
  `subscription-action-dialog.tsx:67` ("billed …/mo" from row),
  `ops/subscriptions/route.ts:82/105/121` (MRR aggregate `_sum.priceCents`),
  `ops/households/[id]/export/route.ts:87` (export).
  → Display components #9–#12 that hard-code 6800 disagree with the DB
  whenever a row was written at 2000 (and vice-versa).
- **Actual charge authority**: `src/lib/stripe.ts` — charges follow the
  Stripe **Price IDs** (`STRIPE_HOME_PRICE_ID` / `STRIPE_CARE_PRICE_ID`
  env). The amounts of those Stripe Price objects are authoritative for any
  live charge. The webhook literals (#3/#4/#6/#7) exist to MIRROR those
  amounts when persisting Stripe events. No code path reads a
  PlatformConfig tier price; there is NO Ops write surface for tier prices
  (the `save_pricing` config action was retired for JOB pricing in FIX-1c).
- **No writer of PlatformConfig tier prices exists** → PlatformConfig is
  currently NOT a source for subscription prices at all.

## 3. The conflicting CARE values

- **6800 ($68/mo)**: the majority position — billing webhook, ops
  subscription tier-change (both write + copy), every ops subscription
  component, the user-facing billing section.
- **2000 ($20/mo)**: the outlier — ops household creation (write) and the
  ops create-household dialog (display).
- Consequence today: an ops-created CARE household is stored at $20/mo
  while every upgrade surface tells the user $68/mo; the ops MRR aggregate
  mixes both. If Stripe goes live with either value, the other cohort's DB
  rows and all matching literals diverge from the real charge.

## 4. Source-of-truth determination (what requires a business decision)

The technically correct architecture is clear and needs NO decision:
`configure once, consume everywhere` — ONE tier-price table (either
PlatformConfig rows with an Ops write surface, or constants in ONE module)
consumed by every writer (#1–#8, #13) and every display (#9–#12, #14).

The decision that CANNOT be made without the business:
1. **Which CARE price is intended — $68 or $20?** (i.e. which cohort's DB
   rows are wrong and need a data correction — a migration.)
2. **PlatformConfig vs Stripe as the operational source of truth.**
   - Stripe-as-authority (recommended when payments go live): charges
     always match; DB/display values should be synced FROM Stripe events
     (webhook already does this), and displays should read the DB row, not
     literals.
   - PlatformConfig-as-authority: gives Ops a price lever, but then Stripe
     Price objects must be kept in sync with it (or created via API),
     adding a reconciliation surface.

Recommendation for the decision-maker (NOT applied):
- Short term (demo, Stripe off): unify the literals to ONE module constant
  for each tier + fix the ops-households CARE write to the chosen value;
  classify the wrong-value DB rows for an Item 9 data correction.
- Long term (Stripe live): Stripe Price = charge authority; DB row = the
  synced record (webhook-written); all displays read the row; delete the
  display literals. PlatformConfig stays out of tier pricing (a price
  change becomes a Stripe Price change + comms, not an ops toggle).

## 5. Demo-environment safety

Nothing in the original report was applied during Phase 8A: all presentation
flows, seeded subscription rows, and existing demo data remained untouched.
The decision was applied only in the final-review round (below), which
verified the demo DB holds **only HOME/800 rows (zero CARE rows, zero
Stripe-linked rows)** — no data correction or migration was required, and
the seeded demo subscriptions are untouched.

---

## 6. Applied implementation (Item 8 final review)

**Business decision (owner-confirmed): Home = S$8/mo, CARE = S$68/mo.**

**Architecture: Option C (hybrid), minimum viable:**

- **Application authority** — `src/lib/subscription-pricing.ts`:
  `SUBSCRIPTION_TIER_PRICES = { HOME: 800, CARE: 6800 }` (one declaration).
  Every `Subscription.priceCents` writer stamps it from here (register,
  google-bridge, webhook ×2, ops tier-change, ops household creation —
  the 2000 CARE outlier is fixed to 6800), and every tier-marketing
  display reads it from here (billing-section, detail-sheet, overview,
  action-dialog, create-household-dialog, ops notification copy).
- **Charge authority** — the Stripe Price objects
  (`STRIPE_HOME_PRICE_ID` / `STRIPE_CARE_PRICE_ID`).
- **Alignment, fail-closed** — `/api/billing/checkout` retrieves the live
  Stripe Price (`getPriceUnitAmountCents`) and REFUSES with 503
  `STRIPE_PRICE_MISMATCH` when its amount is unreadable or differs from
  the module price. A misconfigured Stripe Price can never silently
  charge a different amount than the app displays.
- **Webhook charge-truth sync** — the webhook records the ACTUAL Stripe
  charge amount (`price.unit_amount`) into `priceCents` whenever present
  (module price as fallback), and warns loudly on divergence — per-row
  displays read the row, so display and charge cannot silently diverge
  either.
- **Existing subscriptions** — never blanket-repriced; verified no CARE
  rows existed (no migration). Ops tier-change re-stamps the row at the
  module price for the new tier (previous behaviour). Renewals are
  Stripe-managed.
- **Dynamic pricing (PlatformConfig write surface / Ops price lever /
  repricing policy)** — deliberately NOT implemented: it requires the
  renewal/repricing/comms policy the owner has not defined. Until then a
  price change is a code change to the module + a Stripe Price update.
  Carried as an Item 9 architecture decision.
