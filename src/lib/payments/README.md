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
