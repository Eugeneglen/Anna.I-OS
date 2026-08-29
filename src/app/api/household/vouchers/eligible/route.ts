import { NextRequest, NextResponse } from "next/server";
import { getHouseholdSession } from "@/lib/household-auth";
import { getEligibleVouchers } from "@/lib/marketing/voucher-engine";

// GET /api/household/vouchers/eligible?orderValueCents=5000&category=CLEANING
// Returns vouchers that can be applied to this specific order
export async function GET(req: NextRequest) {
  try {
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const orderValueCents = parseInt(searchParams.get("orderValueCents") || "0", 10);
    const category = searchParams.get("category") || undefined;

    if (!orderValueCents || orderValueCents <= 0) {
      return NextResponse.json({ error: "orderValueCents is required" }, { status: 400 });
    }

    const vouchers = await getEligibleVouchers({
      householdId: session.householdId,
      orderValueCents,
      category,
    });

    return NextResponse.json({ vouchers });
  } catch (error) {
    console.error("[/api/household/vouchers/eligible GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
