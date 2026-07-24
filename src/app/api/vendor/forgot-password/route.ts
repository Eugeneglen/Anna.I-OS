import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { randomBytes } from "crypto";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    // Find the vendor by email
    const vendor = await db.vendor.findUnique({
      where: { email },
    });

    // Always return success to prevent email enumeration
    if (!vendor) {
      return NextResponse.json({
        success: true,
        message: "If an account with that email exists, a reset token has been generated.",
      });
    }

    // Invalidate existing unused tokens
    await db.passwordResetToken.updateMany({
      where: {
        email,
        userType: "vendor",
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
        userType: "vendor",
        token,
        expiresAt,
      },
    });

    const isDev = process.env.NODE_ENV !== "production";

    return NextResponse.json({
      success: true,
      message: "If an account with that email exists, a reset token has been generated.",
      ...(isDev && { devToken: token }),
    });
  } catch (error) {
    console.error("[/api/vendor/forgot-password POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
