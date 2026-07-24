import { NextResponse } from "next/server";
import { getHouseholdSession } from "@/lib/household-auth";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    // Fetch fresh household data including onboarding step
    const household = await db.household.findUnique({
      where: { id: session.householdId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        postalCode: true,
        unitNumber: true,
        activeCategories: true,
        preferences: true,
        onboardingStep: true,
        onboardingCompletedAt: true,
      },
    });

    if (!household) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    return NextResponse.json({
      authenticated: true,
      member: {
        id: session.memberId,
        name: session.memberName,
        email: session.memberEmail,
        role: session.memberRole,
      },
      household,
    });
  } catch (error) {
    console.error("[/api/household/session GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
