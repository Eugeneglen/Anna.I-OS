import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getStripe, retrieveSubscription } from "@/lib/stripe";

// ── Disable Next.js body parsing so we can read the raw body for signature verification ──
// In Next.js App Router, the raw body is available via req.text()

/**
 * POST /api/billing/webhook
 *
 * Handles Stripe webhook events for subscription lifecycle management.
 * This endpoint MUST receive the raw request body for signature verification.
 *
 * Handled events:
 *   - checkout.session.completed    → Activate subscription after first payment
 *   - customer.subscription.updated → Sync tier/status/price changes
 *   - customer.subscription.deleted → Mark subscription CANCELLED
 *   - invoice.payment_failed        → Mark subscription PAST_DUE
 *   - invoice.paid                  → Reactivate if was PAST_DUE
 */
export async function POST(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) {
    console.warn("[/api/billing/webhook] Stripe not configured, skipping webhook");
    return NextResponse.json({ received: true });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[/api/billing/webhook] STRIPE_WEBHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  // ── Read raw body ──
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) {
    console.error("[/api/billing/webhook] Missing stripe-signature header");
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  // ── Verify and construct event ──
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[/api/billing/webhook] Signature verification failed: ${message}`);
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 }
    );
  }

  // ── Process event ──
  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutComplete(event);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(event);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event);
        break;
      default:
        console.log(`[/api/billing/webhook] Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true, eventId: event.id });
  } catch (error) {
    console.error(`[/api/billing/webhook] Error processing event ${event.id}:`, error);
    // Return 200 to prevent Stripe from retrying — we've logged the error
    // and will handle it manually or via the event ID
    return NextResponse.json({ received: true, eventId: event.id, error: "Processing failed" });
  }
}

// ── Event Handlers ──

async function handleCheckoutComplete(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  const householdId = session.metadata?.householdId;
  const tier = session.metadata?.tier as "HOME" | "CARE" | undefined;
  const stripeSubscriptionId = session.subscription as string;

  if (!householdId || !stripeSubscriptionId) {
    console.warn("[checkout.session.completed] Missing householdId or subscription in metadata");
    return;
  }

  // ── Idempotency: check if we already processed this checkout ──
  const existing = await db.subscription.findFirst({
    where: {
      householdId,
      stripeSubscriptionId,
    },
  });

  if (existing) {
    console.log(`[checkout.session.completed] Already processed subscription ${stripeSubscriptionId} for household ${householdId}`);
    return;
  }

  // ── Retrieve subscription details from Stripe ──
  const stripeSub = await retrieveSubscription(stripeSubscriptionId);
  const priceCents = tier === "CARE" ? 6800 : 800;

  // ── Determine billing dates from Stripe ──
  const billingCycleStart = stripeSub
    ? new Date(stripeSub.created * 1000)
    : new Date();
  const billingCycleEnd = stripeSub?.current_period_end
    ? new Date(stripeSub.current_period_end * 1000)
    : null;
  const nextBillingDate = stripeSub?.current_period_end
    ? new Date(stripeSub.current_period_end * 1000)
    : null;

  // ── Find or create subscription record ──
  const currentSub = await db.subscription.findFirst({
    where: { householdId },
    orderBy: { createdAt: "desc" },
  });

  if (currentSub) {
    // Update existing subscription with Stripe details
    await db.subscription.update({
      where: { id: currentSub.id },
      data: {
        tier: tier || currentSub.tier,
        status: "ACTIVE",
        priceCents,
        stripeSubscriptionId,
        billingCycleStart,
        billingCycleEnd,
        nextBillingDate,
      },
    });
  } else {
    // Create a new subscription (unlikely, but handle edge case)
    await db.subscription.create({
      data: {
        householdId,
        tier: tier || "HOME",
        status: "ACTIVE",
        priceCents,
        stripeSubscriptionId,
        billingCycleStart,
        billingCycleEnd,
        nextBillingDate,
      },
    });
  }

  console.log(`[checkout.session.completed] Activated ${tier} subscription for household ${householdId}`);
}

async function handleSubscriptionUpdated(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const stripeSubscriptionId = subscription.id;
  const householdId = subscription.metadata?.householdId;

  if (!householdId) {
    console.warn("[customer.subscription.updated] Missing householdId in metadata");
    return;
  }

  // ── Find the local subscription by Stripe ID ──
  const localSub = await db.subscription.findFirst({
    where: { stripeSubscriptionId },
  });

  if (!localSub) {
    console.warn(`[customer.subscription.updated] No local subscription found for ${stripeSubscriptionId}`);
    return;
  }

  // ── Map Stripe status to our status ──
  const status = mapStripeStatus(subscription.status);

  // ── Determine tier from price ──
  const homePriceId = process.env.STRIPE_HOME_PRICE_ID;
  const carePriceId = process.env.STRIPE_CARE_PRICE_ID;
  let tier = localSub.tier;

  if (subscription.items.data.length > 0) {
    const priceId = subscription.items.data[0].price.id;
    if (priceId === carePriceId) tier = "CARE";
    else if (priceId === homePriceId) tier = "HOME";
  }

  // ── Update billing dates ──
  const billingCycleStart = new Date(subscription.created * 1000);
  const billingCycleEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;
  const nextBillingDate = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;

  // ── Calculate price cents from tier ──
  const priceCents = tier === "CARE" ? 6800 : 800;

  await db.subscription.update({
    where: { id: localSub.id },
    data: {
      tier,
      status,
      priceCents,
      billingCycleStart,
      billingCycleEnd,
      nextBillingDate,
    },
  });

  console.log(`[customer.subscription.updated] Updated subscription ${stripeSubscriptionId}: tier=${tier}, status=${status}`);
}

async function handleSubscriptionDeleted(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const stripeSubscriptionId = subscription.id;

  const localSub = await db.subscription.findFirst({
    where: { stripeSubscriptionId },
  });

  if (!localSub) {
    console.warn(`[customer.subscription.deleted] No local subscription found for ${stripeSubscriptionId}`);
    return;
  }

  await db.subscription.update({
    where: { id: localSub.id },
    data: {
      status: "CANCELLED",
      nextBillingDate: null,
    },
  });

  console.log(`[customer.subscription.deleted] Cancelled subscription ${stripeSubscriptionId} for household ${localSub.householdId}`);
}

async function handleInvoicePaymentFailed(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const stripeSubscriptionId = invoice.subscription as string;

  if (!stripeSubscriptionId) {
    console.warn("[invoice.payment_failed] No subscription on invoice");
    return;
  }

  const localSub = await db.subscription.findFirst({
    where: { stripeSubscriptionId },
  });

  if (!localSub) {
    console.warn(`[invoice.payment_failed] No local subscription found for ${stripeSubscriptionId}`);
    return;
  }

  await db.subscription.update({
    where: { id: localSub.id },
    data: { status: "PAST_DUE" },
  });

  console.log(`[invoice.payment_failed] Marked subscription ${stripeSubscriptionId} as PAST_DUE`);
}

async function handleInvoicePaid(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const stripeSubscriptionId = invoice.subscription as string;

  if (!stripeSubscriptionId) return;

  const localSub = await db.subscription.findFirst({
    where: { stripeSubscriptionId },
  });

  if (!localSub) return;

  // ── If subscription was PAST_DUE, reactivate on successful payment ──
  if (localSub.status === "PAST_DUE") {
    await db.subscription.update({
      where: { id: localSub.id },
      data: { status: "ACTIVE" },
    });

    console.log(`[invoice.paid] Reactivated subscription ${stripeSubscriptionId} from PAST_DUE`);
  }
}

// ── Helpers ──

function mapStripeStatus(stripeStatus: string): "ACTIVE" | "CANCELLED" | "PAST_DUE" {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "ACTIVE";
    case "canceled":
    case "unpaid":
      return "CANCELLED";
    case "past_due":
      return "PAST_DUE";
    default:
      return "ACTIVE";
  }
}
