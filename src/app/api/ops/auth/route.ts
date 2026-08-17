import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as bcrypt from "bcryptjs";
import { createOpsToken } from "@/lib/ops-auth";

/** In production (Railway HTTPS), cookies MUST have secure:true or browsers reject them */
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

    const user = await db.opsUser.findUnique({ where: { email } });

    if (!user) {
      console.warn(`[/api/ops/auth] User not found: ${email} (OpsUser count: ${await db.opsUser.count().catch(() => -1)})`);
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    if (!user.isActive) {
      console.warn(`[/api/ops/auth] Account deactivated: ${email} isActive=${user.isActive} roleId=${user.roleId}`);
      return NextResponse.json(
        { error: "Account is deactivated" },
        { status: 403 }
      );
    }

    // ── Self-heal: if passwordHash is null (new column from schema push),
    //    hash the incoming password and persist it.                       ──
    let passwordHash = user.passwordHash;
    if (!passwordHash) {
      console.warn(`[ops/auth] passwordHash is NULL for ${email} — auto-setting from login attempt`);
      passwordHash = bcrypt.hashSync(password, 10);
      await db.opsUser.update({
        where: { id: user.id },
        data: { passwordHash },
      });
    }

    const valid = await bcrypt.compare(password, passwordHash);
    if (!valid) {
      console.warn(`[/api/ops/auth] Wrong password for: ${email}`);
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 }
      );
    }

    // Resolve role info: prefer Role table, fall back to legacy enum
    let roleId: string | undefined;
    let roleName: string | undefined;
    if (user.roleId) {
      const role = await db.role.findUnique({ where: { id: user.roleId } });
      if (role) {
        roleId = role.id;
        roleName = role.name;
      }
    }
    if (!roleId) {
      // Map legacy enum to role table as fallback
      const legacyMap: Record<string, string> = {
        ADMIN: "super_admin",
        COORDINATOR: "coordinator",
        ANALYST: "data_analyst",
      };
      const slug = legacyMap[user.role] || "coordinator";
      const role = await db.role.findUnique({ where: { slug } });
      if (role) {
        roleId = role.id;
        roleName = role.name;
        // Auto-migrate: attach roleId to user for future logins
        await db.opsUser.update({
          where: { id: user.id },
          data: { roleId: role.id },
        });
      }
    }

    const token = await createOpsToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      roleId,
      roleName,
    });

    await db.opsUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const res = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        roleId,
        roleName,
      },
    });

    res.cookies.set("ops_token", token, {
      httpOnly: true,
      secure: IS_PRODUCTION,
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
      secure: IS_PRODUCTION,
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
