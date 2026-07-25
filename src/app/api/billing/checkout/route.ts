import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getHouseholdSession } from "@/lib/household-auth";
import {
  getStripe,
  getOrCreateCustomer,
  getHomePriceId,
  getCarePriceId,
  isBillingEnabled,
} from "@/lib/stripe";
import { headers } from "next/headers";

/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout Session for subscription creation or upgrade.
 * Body: { tier: "HOME" | "CARE" }
 *
 * - Looks up or creates a Stripe Customer for the household
 * - Creates a Stripe Checkout Session in subscription mode
 * - Returns { checkoutUrl } for client-side redirect
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

  // ── Parse and validate body ──
  let body: { tier?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { tier } = body;
  if (tier !== "HOME" && tier !== "CARE") {
    return NextResponse.json(
      { error: "Invalid tier. Must be HOME or CARE." },
      { status: 400 }
    );
  }

  // ── Determine price ID ──
  const priceId = tier === "HOME" ? getHomePriceId() : getCarePriceId();
  if (!priceId) {
    return NextResponse.json(
      { error: `No Stripe price configured for ${tier} tier. Contact Ops.` },
      { status: 503 }
    );
  }

  try {
    // ── Fetch household details ──
    const household = await db.household.findUnique({
      where: { id: session.householdId },
    });

    if (!household) {
      return NextResponse.json({ error: "Household not found" }, { status: 404 });
    }

    // ── Get or create Stripe Customer ──
    const customer = await getOrCreateCustomer({
      email: household.email,
      name: household.name,
      householdId: household.id,
    });

    if (!customer) {
      return NextResponse.json(
        { error: "Failed to create billing account. Please try again later." },
        { status: 500 }
      );
    }

    // ── Build origin URL for success/cancel redirects ──
    const headersList = await headers();
    const origin = headersList.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "";

    // ── Create Checkout Session ──
    const stripe = getStripe()!;
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      metadata: {
        householdId: household.id,
        tier,
      },
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${origin}/settings?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/settings?checkout=cancelled`,
      allow_promotion_codes: true,
      subscription_data: {
        metadata: {
          householdId: household.id,
          tier,
        },
      },
    });

    return NextResponse.json({
      checkoutUrl: checkoutSession.url,
      sessionId: checkoutSession.id,
    });
  } catch (error) {
    console.error("[/api/billing/checkout POST]", error);
    const message = error instanceof Error ? error.message : "Internal error";

    // Don't expose Stripe errors to client
    if (message.includes("Stripe")) {
      return NextResponse.json(
        { error: "Failed to create checkout session. Please try again later." },
        { status: 500 }
      );
    }

    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
