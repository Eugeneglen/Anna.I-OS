# Payment Service Abstraction

## Overview

All payment-related operations (escrow holds, releases, refunds) go through a
single `PaymentService` interface. The actual provider (Stripe, etc.) is
abstracted so business logic never imports Stripe directly.

## Architecture

```
src/lib/payments/
├── types.ts          ← PaymentService interface + DTOs
├── no-op.ts          ← NoOpPaymentService (sandbox / dev / test)
├── stripe.ts         ← StripePaymentService (STUB — future implementation)
├── factory.ts        ← getPaymentService() — picks impl by env
├── calculations.ts   ← pure functions for commission/payout/refund math
└── README.md         ← this file
```

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
records a `PLATFORM_SUBSIDY_DRAWN` audit event whenever a subsidy was drawn,
so the ledger stays reconcilable: Σ released payouts = Σ escrow cash
released + Σ platform subsidy drawn. (Historical rows settled under the old
math are never restated; HELD entries created before the rule are healed to
the payout base at release time.)

## Current State (MVP)

- **NoOpPaymentService** is the active implementation.
- Refunds succeed in the database (Refund row created, EscrowLedger updated)
  but **no real money is moved**.
- This is intentional for the MVP scope — Stripe integration is deferred.

## Adding Stripe Later

When Stripe integration is needed, follow these steps. **No business logic,
API route, or frontend change is required** — everything already calls
`getPaymentService().refund()` / `.release()`.

### Step 1: Set environment variables

```env
STRIPE_SECRET_KEY=sk_live_xxx        # or sk_test_xxx for test mode
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_HOME_PRICE_ID=price_xxx
STRIPE_CARE_PRICE_ID=price_xxx
```

### Step 2: Implement StripePaymentService

Open `src/lib/payments/stripe.ts` and uncomment + complete the `refund()` and
`release()` method bodies. The file contains commented-out reference
implementations using the Stripe SDK.

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
