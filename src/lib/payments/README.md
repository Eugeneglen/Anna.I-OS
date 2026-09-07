# Payment Service Abstraction

## Overview

All payment-related operations (escrow holds, releases, payouts, refunds) go
through a single provider-agnostic `PaymentService` interface. The actual
provider is abstracted so business logic never imports a provider SDK
directly.

**PENDING PAYMENT GATEWAY DECISION** — no provider has been chosen yet
(Stripe Connect and alternatives are under evaluation). NoOpPaymentService
is the only implementation; the dormant Stripe branch in factory.ts is a
documented placeholder. Adding a provider later = one adapter file + one
factory branch.

## Architecture

```
src/lib/payments/
├── types.ts          ← PaymentService interface + DTOs (provider-agnostic)
├── no-op.ts          ← NoOpPaymentService (sandbox / dev / test — active)
├── stripe.ts         ← StripePaymentService (STUB — Pending Payment Gateway Decision)
├── factory.ts        ← getPaymentService() — picks impl by env
├── escrow-effects.ts ← money-transition wiring: hold (accept/add-on) + release/payout (release paths)
├── refund-service.ts ← refund orchestration (adapter inside its DB transaction)
├── billing-gateway.ts← subscription charging seam (createCheckoutIntent / checkEntitlement — NoOp)
├── calculations.ts   ← pure functions for commission/payout/refund math
└── README.md         ← this file
```

## Money Lifecycle & Ledger Authority

The DB ledger (EscrowLedger states + calculations.ts math) is the SINGLE
SOURCE OF TRUTH; the adapter is an effect layer, never authoritative:

| Ledger transition | Adapter effect (wired in) | Method |
|---|---|---|
| escrow created (HELD) | vendor booking accept + add-on approval | `hold()` |
| escrow released (RELEASED) | ops release, ops resolve_voucher, household release | `release()` + `payout()` |
| refund (DISPUTED→REFUNDED) | processRefund (inside its DB transaction) | `refund()` |
| zero-cash resolution | no adapter effect (nothing held) — logged | — |

Adapter refs: the hold ref persists to `EscrowLedger.stripePaymentIntentId`
and the payout ref to `stripeTransferId` (historical column names — schema
frozen; providerRef persistence lands with the real adapter). Adapter calls
are wrapped in try/catch at the wiring layer (escrow-effects.ts) — failures
log reconciliation cases and never corrupt ledger state. The one exception
is refund-service.ts, where an adapter failure intentionally rolls back the
ledger transition (a refund must actually move before REFUNDED is written).

## Payout Base & Platform-Funded Discounts

**Business rule**: promo codes and refund credits are funded by Anna.I, not
by the vendor. Vendors are always paid on the **full job value** less the
standard commission — never on the discounted cash the customer paid.

Two distinct amounts live on every `EscrowLedger` row:

| Field | Meaning |
|---|---|
| `amountCents` | customer cash actually held (post-discount) |
| `originalAmountCents` | full pre-discount job value — the **payout base** when the discount is platform-funded |

The payout base (see `payoutBaseCents()` in `calculations.ts`) equals
`originalAmountCents` when a platform-funded discount exists, and
`amountCents` otherwise. Commission and vendor payout are computed on the
payout base; the difference between the two amounts is a **platform subsidy**
absorbed by Anna.I. Example — $120 job, $50 refund credit applied:

- Escrow holds: **$70** (customer cash)
- Payout base: **$120** → commission **$12** (10%) → vendor payout **$108**
- Platform subsidy drawn at release: **$50** (Anna.I absorbs)

Funding invariant per entry:
`commission + payout + refundCents + reversed discount (when applied) = payoutBase`.

**Refunds** return customer cash only (capped at `amountCents`) and convert
to refund credit per policy R3. On a platform-discounted entry, exhausting
the customer cash also reverses the consumed discount (the household's
voucher is restored on the full-refund/cancel paths), which zeroes the
payout — a fully refunded job pays the vendor nothing and makes the
household whole.

**Release bookkeeping**: every release pays out the base-derived figures and
records a `PLATFORM_SUBSIDY_DRAWN` audit event whenever a subsidy was drawn
(`subsidy = payoutBase − amountCents` on platform-discounted entries, 0
otherwise), so the ledger stays reconcilable per released entry:
`commission + payout = (amountCents − refundCents) + subsidy drawn` — i.e.
Σ released payouts + commissions = Σ escrow cash still held + Σ subsidy
drawn. (Historical rows settled under the old math are never restated; HELD
entries created before the rule are healed to the payout base at release
time. Fully-discounted entries hold `amountCents = 0`: refunds/cancellations
on them terminalize with zeroed figures and no cash movement — the consumed
voucher is restored instead.)

## Current State (MVP)

- **NoOpPaymentService** is the active implementation (Pending Payment
  Gateway Decision — Stripe Connect and alternatives under evaluation).
- Escrow holds, releases, payouts and refunds all flow through the adapter
  seam (escrow-effects.ts + refund-service.ts), but **no real money is
  moved** — the NoOp adapter synthesises deterministic `noop_*` references
  (persisted to `stripePaymentIntentId` / `stripeTransferId` for audit).
- This is intentional until the provider decision lands.

## Adding a Provider Later

When a provider integration is needed, follow these steps. **No business
logic, API route, or frontend change is required** — everything already
calls `getPaymentService().hold()` / `.release()` / `.payout()` /
`.refund()` via escrow-effects.ts / refund-service.ts.

### Step 1: Set environment variables

```env
STRIPE_SECRET_KEY=sk_live_xxx        # or sk_test_xxx for test mode
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_HOME_PRICE_ID=price_xxx
STRIPE_CARE_PRICE_ID=price_xxx
```

### Step 2: Implement the provider adapter

Open `src/lib/payments/stripe.ts` (or create a new adapter file for the
chosen provider) and implement the `hold()`, `release()`, `payout()` and
`refund()` method bodies. The interface is provider-agnostic
(`{ amountCents, currency, idempotencyKey, metadata, providerRef }`) — map
it to the provider's own concepts INSIDE the adapter file only. The file
contains commented-out reference implementations using the Stripe SDK.

### Step 3: Enable in factory.ts

In `src/lib/payments/factory.ts`, uncomment the StripePaymentService branch:

```typescript
if (stripeEnabled) {
  const { StripePaymentService } = require("./stripe");
  _instance = new StripePaymentService();
  return _instance;
}
```

### Step 4: Add webhook handlers

Create `src/app/api/stripe/webhook/route.ts` to handle:
- `charge.refunded` — update Refund.stripeStatus = "succeeded"
- `refund.failed` — update Refund.stripeStatus = "failed" + alert ops

## Idempotency

Every refund call accepts an `idempotencyKey`:
- **DB layer**: `Refund.idempotencyKey` has `@@unique` — duplicate inserts fail.
- **Stripe layer** (when integrated): pass the same key as Stripe's
  `idempotencyKey` option — Stripe returns the original response on retry.

This means a network retry (e.g. client timeout) will NOT create a second
refund — the unique constraint catches it at the DB, and Stripe catches it
at the API.
