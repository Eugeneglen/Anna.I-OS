import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth";
import { db } from "@/lib/db";
import { createHouseholdToken } from "@/lib/household-auth";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

async function bridgeLogic(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "No Google session found" }, { status: 401 });
    }

    const googleEmail = session.user.email;
    const googleName = session.user.name || googleEmail.split("@")[0];

    // Look up existing member by email
    let member = await db.familyMember.findUnique({
      where: { email: googleEmail },
      include: { household: true },
    });

    // If no member exists, create Household + Member + Subscription (like registration)
    if (!member) {
      const householdName = `${googleName.split(" ")[0]}'s Home`;

      const result = await db.$transaction(async (tx) => {
        const household = await tx.household.create({
          data: {
            name: householdName,
            fullName: googleName,
            email: googleEmail,
            address: "",
            activeCategories: "[]",
            preferences: {},
          },
        });

        await tx.subscription.create({
          data: {
            householdId: household.id,
            tier: "HOME",
            status: "ACTIVE",
            priceCents: 800,
            billingCycleStart: new Date(),
            nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        });

        const newMember = await tx.familyMember.create({
          data: {
            householdId: household.id,
            name: googleName,
            email: googleEmail,
            role: "OWNER",
            avatarUrl: session.user.image || null,
          },
        });

        return { household, member: newMember };
      });

      member = result.member as typeof member & { household: typeof result.household };

      // If the Google name was used as a household name, update fullName too
      if (!member.household.fullName) {
        await db.household.update({
          where: { id: member.householdId },
          data: { fullName: googleName },
        });
      }
    } else {
      // Update avatar if it changed
      if (session.user.image && session.user.image !== member.avatarUrl) {
        await db.familyMember.update({
          where: { id: member.id },
          data: { avatarUrl: session.user.image },
        });
      }
    }

    // Create our custom JWT cookie
    const token = await createHouseholdToken({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      householdId: member.householdId,
      householdName: member.household.name,
    });

    const res = NextResponse.json({
      success: true,
      member: {
        id: member.id,
        name: member.name,
        email: member.email,
        role: member.role,
        householdId: member.householdId,
        householdName: member.household.name,
        onboardingStep: member.household.onboardingStep,
      },
      isNewUser: !member.passwordHash, // If no password set, they came via Google
    });

    res.cookies.set("household_token", token, {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 3600,
    });

    // Sign out of NextAuth session (we use our custom JWT going forward)
    // Use public origin (NEXTAUTH_URL or request origin) — request.url may be 0.0.0.0 on Railway
    const origin =
      process.env.NEXTAUTH_URL ||
      (await headers()).get("origin") ||
      new URL(request.url).origin;
    const signOutUrl = new URL("/api/auth/signout", origin);
    signOutUrl.searchParams.set("callbackUrl", "/");
    res.headers.set("Location", signOutUrl.toString());

    return new NextResponse(null, {
      status: 302,
      headers: res.headers,
    });
  } catch (error) {
    console.error("[google-bridge] Error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Google sign-in failed", debug: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return bridgeLogic(request);
}

export async function POST(request: Request) {
  return bridgeLogic(request);
}
