import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getHouseholdSession } from "@/lib/household-auth";
import { validateRedemption } from "@/lib/marketing/campaign-service";

// POST /api/marketing/validate — validate a discount code without applying it
// Used by the booking form to show the discount preview before the user confirms
const validateSchema = z.object({
  code: z.string().min(1),
  orderValueCents: z.number().int().positive(),
  orderType: z.enum(["job", "subscription"]),
  category: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = validateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const result = await validateRedemption({
      code: parsed.data.code,
      householdId: session.householdId,
      orderValueCents: parsed.data.orderValueCents,
      orderType: parsed.data.orderType,
      category: parsed.data.category,
    });

    if (!result.valid) {
      return NextResponse.json({ valid: false, reason: result.reason }, { status: 200 });
    }

    return NextResponse.json({
      valid: true,
      discountCents: result.discountCents,
      finalAmountCents: parsed.data.orderValueCents - (result.discountCents || 0),
    });
  } catch (error) {
    console.error("[/api/marketing/validate POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
