import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as bcrypt from "bcryptjs";
import { createHouseholdToken } from "@/lib/household-auth";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

export async function POST(req: NextRequest) {
  try {
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
