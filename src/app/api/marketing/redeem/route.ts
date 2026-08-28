import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRedemption, applyRedemption } from "@/lib/marketing/campaign-service";

// POST /api/marketing/redeem — public endpoint for households to redeem discount codes
// No ops auth required — but the household must be authenticated (checked by the caller)
//
// NOTE (audit proposal H §5): This endpoint is NOT called by the household
// booking flow today — that flow validates + applies the redemption inside
// POST /api/tasks within a single transaction. This endpoint remains for
// ops-only programmatic access (e.g. marketing-site landing pages, manual
// ops redemptions). Do not delete without confirming ops has no callers.
const redeemSchema = z.object({
  code: z.string().min(1),
  householdId: z.string().min(1),
  orderValueCents: z.number().int().positive(),
  orderType: z.enum(["job", "subscription"]),
  category: z.string().optional(),
  bookingId: z.string().optional(),
  subscriptionId: z.string().optional(),
  existingDiscountApplied: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = redeemSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const result = await validateRedemption({
      code: parsed.data.code,
      householdId: parsed.data.householdId,
      orderValueCents: parsed.data.orderValueCents,
      orderType: parsed.data.orderType,
      category: parsed.data.category,
      existingDiscountApplied: parsed.data.existingDiscountApplied,
    });

    if (!result.valid) {
      return NextResponse.json({ valid: false, reason: result.reason }, { status: 409 });
    }

    const redemption = await applyRedemption({
      code: parsed.data.code,
      householdId: parsed.data.householdId,
      discountCents: result.discountCents!,
      campaignId: result.campaignId!,
      codeId: result.codeId!,
      bookingId: parsed.data.bookingId,
      subscriptionId: parsed.data.subscriptionId,
    });

    return NextResponse.json({
      valid: true,
      discountCents: result.discountCents,
      redemptionId: redemption.id,
      discountedAmountCents: parsed.data.orderValueCents - result.discountCents!,
    });
  } catch (error) {
    console.error("[/api/marketing/redeem POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
