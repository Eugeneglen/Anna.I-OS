import Stripe from "stripe";

// ── Environment Variables ──
// Required in production:
//   STRIPE_SECRET_KEY        — Stripe secret API key
//   STRIPE_WEBHOOK_SECRET    — Stripe webhook signing secret (whsec_...)
//   STRIPE_HOME_PRICE_ID     — Stripe Price ID for HOME tier (price_...)
//   STRIPE_CARE_PRICE_ID     — Stripe Price ID for CARE tier (price_...)
//   STRIPE_PUBLISHABLE_KEY   — Stripe publishable key (pk_live_...)
//   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY — Frontend-safe publishable key
//
// For local development without Stripe, set STRIPE_SECRET_KEY to "test"
// and the billing features will gracefully degrade.

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const isStripeEnabled = !!stripeSecretKey && stripeSecretKey !== "test";

/**
 * Stripe singleton — lazy-initialised to avoid throwing at import time
 * when keys are not configured (e.g. local sandbox).
 */
let _stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (!isStripeEnabled) return null;
  if (!_stripe) {
    _stripe = new Stripe(stripeSecretKey!, {
      apiVersion: "2025-04-30.basil",
      typescript: true,
    });
  }
  return _stripe;
}

// ── Price IDs ──

export function getHomePriceId(): string | null {
  return process.env.STRIPE_HOME_PRICE_ID || null;
}

export function getCarePriceId(): string | null {
  return process.env.STRIPE_CARE_PRICE_ID || null;
}

export function getPublishableKey(): string {
  return process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PUBLISHABLE_KEY || "";
}

// ── Customer helpers ──

/**
 * Look up an existing Stripe Customer by the household's email.
 * Returns null if not found or Stripe is disabled.
 */
export async function findCustomerByEmail(email: string): Promise<Stripe.Customer | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  const list = await stripe.customers.list({ email, limit: 1 });
  return list.data[0] ?? null;
}

/**
 * Find a Stripe Customer by their Stripe customer ID.
 */
export async function findCustomerById(customerId: string): Promise<Stripe.Customer | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  try {
    return await stripe.customers.retrieve(customerId) as Stripe.Customer;
  } catch {
    return null;
  }
}

/**
 * Create a new Stripe Customer linked to a household.
 */
export async function createCustomer(params: {
  email: string;
  name: string;
  householdId: string;
}): Promise<Stripe.Customer | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  return stripe.customers.create({
    email: params.email,
    name: params.name,
    metadata: {
      householdId: params.householdId,
    },
  });
}

/**
 * Get or create a Stripe Customer for the given household.
 * Looks up by email first, then creates if not found.
 */
export async function getOrCreateCustomer(params: {
  email: string;
  name: string;
  householdId: string;
}): Promise<Stripe.Customer | null> {
  const existing = await findCustomerByEmail(params.email);
  if (existing) return existing;
  return createCustomer(params);
}

// ── Subscription helpers ──

/**
 * Retrieve a Stripe subscription by ID.
 */
export async function retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  try {
    return await stripe.subscriptions.retrieve(subscriptionId);
  } catch {
    return null;
  }
}

/**
 * Check if Stripe is properly configured for billing operations.
 */
export function isBillingEnabled(): boolean {
  return isStripeEnabled && !!getHomePriceId() && !!getCarePriceId();
}
