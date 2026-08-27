import { NextRequest, NextResponse } from "next/server";
import { getHouseholdSession } from "@/lib/household-auth";
import { markVoucherViewed } from "@/lib/marketing/voucher-engine";

// PATCH /api/household/vouchers/[id] — mark voucher as viewed
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const action = body.action;

    if (action === "view") {
      await markVoucherViewed(id, session.householdId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[/api/household/vouchers/[id] PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
