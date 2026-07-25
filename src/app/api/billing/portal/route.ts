import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getHouseholdSession } from "@/lib/household-auth";
import { getStripe, isBillingEnabled } from "@/lib/stripe";
import { headers } from "next/headers";

/**
 * POST /api/billing/portal
 *
 * Creates a Stripe Customer Portal session for self-service
 * subscription management (update payment method, cancel, view invoices).
 */
export async function POST(req: NextRequest) {
  // ── Auth check ──
  const session = await getHouseholdSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Stripe availability check ──
  if (!isBillingEnabled()) {
    return NextResponse.json(
      { error: "Billing is not available at this time. Please contact Ops to manage your subscription." },
      { status: 503 }
    );
  }

  try {
    // ── Fetch the household's subscription ──
    const subscription = await db.subscription.findFirst({
      where: { householdId: session.householdId },
      orderBy: { createdAt: "desc" },
    });

    if (!subscription?.stripeSubscriptionId) {
      return NextResponse.json(
        { error: "No active billing account found. Please upgrade your plan first." },
        { status: 404 }
      );
    }

    // ── Retrieve the Stripe subscription to get the customer ID ──
    const stripe = getStripe()!;
    const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId);
    const customerId = stripeSub.customer as string;

    // ── Build return URL ──
    const headersList = await headers();
    const origin = headersList.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "";

    // ── Create Customer Portal session ──
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/settings?portal=return`,
    });

    return NextResponse.json({
      portalUrl: portalSession.url,
    });
  } catch (error) {
    console.error("[/api/billing/portal POST]", error);

    if (error instanceof Error && error.message.includes("Stripe")) {
      return NextResponse.json(
        { error: "Failed to open billing portal. Please try again later." },
        { status: 500 }
      );
    }

    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
