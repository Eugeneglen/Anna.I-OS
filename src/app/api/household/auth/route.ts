import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as bcrypt from "bcryptjs";
import { createHouseholdToken } from "@/lib/household-auth";
import {
  checkRateLimit,
  clientIpFromHeaders,
  isRateLimited,
  rateLimitResponsePayload,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 }
      );
    }

    // FIX-1a: brute-force throttle — 10 FAILED attempts / 15 min per
    // identifier + IP. Only failures are counted; successful logins do
    // not consume the budget.
    const failKey = `login-fail:household:${clientIpFromHeaders(req.headers)}:${String(email).toLowerCase()}`;
    if (isRateLimited(failKey, RATE_LIMITS.loginFailures.limit)) {
      return NextResponse.json(rateLimitResponsePayload(failKey), { status: 429 });
    }
    const recordFailure = () =>
      checkRateLimit(
        failKey,
        RATE_LIMITS.loginFailures.limit,
        RATE_LIMITS.loginFailures.windowMs
      );

    // Find the family member by email
    const member = await db.familyMember.findUnique({
      where: { email },
      include: { household: true },
    });

    if (!member) {
      recordFailure();
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // ── Self-heal: if passwordHash is null (new column from schema push),
    //    hash the incoming password and persist it. This handles the case
    //    where ensure-seed.ts backfill didn't reach the database.
    //    ── P2 (AUDIT-4): DEV/CI ONLY. In production a NULL passwordHash
    //    means "ops-managed account, no self-serve login" (per schema
    //    comment) — honouring the self-heal there would let ANY password
    //    log into ops-managed accounts. Production denies the login. ──
    let passwordHash = member.passwordHash;
    if (!passwordHash) {
      if (IS_PRODUCTION) {
        console.error(
          `[household/auth] Blocked login for NULL-passwordHash account ${email} in production (ops-managed account)`
        );
        return NextResponse.json(
          { error: "Invalid credentials" },
          { status: 401 }
        );
      }
      console.warn(`[household/auth] passwordHash is NULL for ${email} — auto-setting from login attempt (dev/CI self-heal)`);
      passwordHash = bcrypt.hashSync(password, 10);
      await db.familyMember.update({
        where: { id: member.id },
        data: { passwordHash },
      });
    }

    const valid = await bcrypt.compare(password, passwordHash);
    if (!valid) {
      recordFailure();
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

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
    console.error("[/api/household/auth POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const res = NextResponse.json({ success: true });
    res.cookies.set("household_token", "", {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return res;
  } catch (error) {
    console.error("[/api/household/auth DELETE]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
