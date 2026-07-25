import { NextResponse } from "next/server";
import { getPublishableKey, isBillingEnabled } from "@/lib/stripe";

/**
 * GET /api/billing/config
 *
 * Returns billing configuration for the frontend:
 *   - publishableKey: Stripe publishable key (for loading Stripe.js)
 *   - enabled: Whether billing features are available
 */
export async function GET() {
  return NextResponse.json({
    publishableKey: getPublishableKey(),
    enabled: isBillingEnabled(),
  });
}
