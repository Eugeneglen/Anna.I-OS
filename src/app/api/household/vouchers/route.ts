import { NextResponse } from "next/server";
import { getHouseholdSession } from "@/lib/household-auth";
import { getHouseholdVouchers } from "@/lib/marketing/voucher-engine";

// GET /api/household/vouchers — list all vouchers (available + used + expired)
export async function GET() {
  try {
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const vouchers = await getHouseholdVouchers(session.householdId);

    return NextResponse.json({ vouchers });
  } catch (error) {
    console.error("[/api/household/vouchers GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
