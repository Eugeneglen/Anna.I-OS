import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  try {
    const { token, newPassword } = await req.json();

    if (!token || !newPassword) {
      return NextResponse.json(
        { error: "Token and new password are required" },
        { status: 400 }
      );
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Find and validate the reset token
    const resetToken = await db.passwordResetToken.findUnique({
      where: { token },
    });

    if (!resetToken) {
      return NextResponse.json(
        { error: "Invalid or expired reset token" },
        { status: 400 }
      );
    }

    if (resetToken.usedAt) {
      return NextResponse.json(
        { error: "This reset token has already been used" },
        { status: 400 }
      );
    }

    if (resetToken.expiresAt < new Date()) {
      return NextResponse.json(
        { error: "This reset token has expired. Please request a new one." },
        { status: 400 }
      );
    }

    // Find the member by email
    const member = await db.familyMember.findUnique({
      where: { email: resetToken.email },
    });

    if (!member) {
      return NextResponse.json(
        { error: "No account found associated with this token" },
        { status: 404 }
      );
    }

    // Hash the new password and update the member
    const newPasswordHash = bcrypt.hashSync(newPassword, 10);

    // Use a transaction to update password and mark token as used
    await db.$transaction([
      db.familyMember.update({
        where: { id: member.id },
        data: { passwordHash: newPasswordHash },
      }),
      db.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return NextResponse.json({
      success: true,
      message: "Password has been reset successfully. You can now sign in with your new password.",
    });
  } catch (error) {
    console.error("[/api/household/reset-password POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
