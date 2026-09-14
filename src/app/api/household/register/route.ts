import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as bcrypt from "bcryptjs";
import { createHouseholdToken } from "@/lib/household-auth";
import { getTierPriceCents } from "@/lib/subscription-pricing";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

export async function POST(req: NextRequest) {
  try {
    // ── P9A-F06 (Phase 9, Section A) ──
    // Unbounded anonymous registration was a spam surface (each call mints a
    // Household + FamilyMember + Subscription row). 5 registrations per 10
    // minutes per source — same fixed-window limiter used by ops auth/marketing.
    // LIMITATION (P9A police finding #2, documented disposition): the key is
    // the FIRST x-forwarded-for entry (client-suppliable) and the counter is
    // per-process — this is defense-in-depth against naive floods (the same
    // shared helper as 6 pre-existing routes), NOT a hard per-IP guarantee.
    // Trusted-proxy / real-client-IP keying is queued for Phase 10/16
    // production-configuration work.
    const rlKey = `register:${clientIpFromHeaders(req.headers)}`;
    if (!checkRateLimit(rlKey, 5, 600_000)) {
      return NextResponse.json(
        { error: "Too many registrations from this network — please try again later." },
        { status: 429 }
      );
    }

    const { name, email, password, householdName } = await req.json();

    // Validate required fields
    if (!name || !email || !password || !householdName) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    // Validate password strength (min 8 chars)
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Check if email is already taken
    const existingMember = await db.familyMember.findUnique({
      where: { email },
    });

    if (existingMember) {
      return NextResponse.json(
        { error: "An account with this email already exists. Please sign in instead." },
        { status: 409 }
      );
    }

    // Check if household name/email is taken
    const existingHousehold = await db.household.findUnique({
      where: { email },
    });

    if (existingHousehold) {
      return NextResponse.json(
        { error: "A household with this email already exists" },
        { status: 409 }
      );
    }

    // Hash the password
    const passwordHash = bcrypt.hashSync(password, 10);

    // Create household + first member (OWNER) in a transaction
    const result = await db.$transaction(async (tx) => {
      // Create the household
      const household = await tx.household.create({
        data: {
          name: householdName,
          email,
          address: "", // Will be filled during onboarding
          activeCategories: "[]",
          preferences: {},
        },
      });

      // Create default HOME tier subscription
      await tx.subscription.create({
        data: {
          householdId: household.id,
          tier: "HOME",
          status: "ACTIVE",
          // ── F-5 (Item 8): the application-authoritative price from the
          // subscription-pricing module — one declaration, every writer.
          priceCents: getTierPriceCents("HOME"),
          billingCycleStart: new Date(),
          nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      // Create the first member as OWNER
      const member = await tx.familyMember.create({
        data: {
          householdId: household.id,
          name,
          email,
          passwordHash,
          role: "OWNER",
        },
      });

      return { household, member };
    });

    // Create JWT token
    const token = await createHouseholdToken({
      id: result.member.id,
      name: result.member.name,
      email: result.member.email,
      role: "OWNER",
      householdId: result.household.id,
      householdName: result.household.name,
    });

    const res = NextResponse.json({
      success: true,
      member: {
        id: result.member.id,
        name: result.member.name,
        email: result.member.email,
        role: "OWNER",
        householdId: result.household.id,
        householdName: result.household.name,
        onboardingStep: 0,
      },
    });

    res.cookies.set("household_token", token, {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 3600,
    });

    return res;
  } catch (error) {
    console.error("[/api/household/register POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
