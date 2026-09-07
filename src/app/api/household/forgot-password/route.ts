import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { randomBytes } from "crypto";
import {
  checkRateLimit,
  clientIpFromHeaders,
  rateLimitResponsePayload,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    // FIX-1a: 5 token generations / 15 min per email + IP (prevents
    // unlimited reset-token spam against the token table).
    const rlKey = `forgot-password:household:${clientIpFromHeaders(req.headers)}:${String(email).toLowerCase()}`;
    if (
      !checkRateLimit(rlKey, RATE_LIMITS.forgotPassword.limit, RATE_LIMITS.forgotPassword.windowMs)
    ) {
      return NextResponse.json(rateLimitResponsePayload(rlKey), { status: 429 });
    }

    // Find the family member by email
    const member = await db.familyMember.findUnique({
      where: { email },
    });

    // Always return success to prevent email enumeration attacks
    if (!member) {
      return NextResponse.json({
        success: true,
        message: "If an account with that email exists, a reset link has been generated.",
      });
    }

    // Invalidate any existing unused tokens for this email
    await db.passwordResetToken.updateMany({
      where: {
        email,
        userType: "household",
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });

    // Generate a new reset token
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await db.passwordResetToken.create({
      data: {
        email,
        userType: "household",
        token,
        expiresAt,
      },
    });

    // In development, return the token so the user can test
    // In production, this would send an email
    const isDev = process.env.NODE_ENV !== "production";

    return NextResponse.json({
      success: true,
      message: "If an account with that email exists, a reset link has been generated.",
      ...(isDev && { devToken: token }),
    });
  } catch (error) {
    console.error("[/api/household/forgot-password POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
