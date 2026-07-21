import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as bcrypt from "bcryptjs";
import { createOpsToken } from "@/lib/ops-auth";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password required" },
        { status: 400 }
      );
    }

    const user = await db.opsUser.findUnique({ where: { email } });

    if (!user) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    const token = await createOpsToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    await db.opsUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const res = NextResponse.json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });

    res.cookies.set("ops_token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 3600,
    });

    return res;
  } catch (error) {
    console.error("[/api/ops/auth POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const res = NextResponse.json({ success: true });
    res.cookies.set("ops_token", "", {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return res;
  } catch (error) {
    console.error("[/api/ops/auth DELETE]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
