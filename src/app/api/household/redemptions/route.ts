import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getHouseholdSession } from "@/lib/household-auth";

// GET /api/household/redemptions — list this household's discount code redemption history
export async function GET() {
  try {
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const redemptions = await db.codeRedemption.findMany({
      where: { householdId: session.householdId },
      orderBy: { redeemedAt: "desc" },
      take: 50,
      include: {
        discountCode: {
          select: { code: true },
        },
        campaign: {
          select: { id: true, name: true, type: true },
        },
      },
    });

    return NextResponse.json({
      redemptions: redemptions.map((r) => ({
        id: r.id,
        code: r.discountCode?.code || "—",
        campaignName: r.campaign?.name || "—",
        campaignType: r.campaign?.type || "—",
        discountAppliedCents: r.discountAppliedCents,
        redeemedAt: r.redeemedAt,
        bookingId: r.bookingId,
        subscriptionId: r.subscriptionId,
      })),
    });
  } catch (error) {
    console.error("[/api/household/redemptions GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
