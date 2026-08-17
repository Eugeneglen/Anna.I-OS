import { NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Load fresh user data from DB
    const user = await db.opsUser.findUnique({
      where: { id: session.userId },
      include: {
        roleRel: {
          include: {
            rolePermissions: {
              include: { permission: true },
            },
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Build permissions array
    let permissions: string[] = [];
    let role: {
      id: string;
      name: string;
      slug: string;
      level: number;
      isSystem: boolean;
    } | null = null;

    if (user.roleRel && user.roleId) {
      permissions = user.roleRel.rolePermissions.map(
        (rp) => rp.permission.module + ":" + rp.permission.action
      );
      role = {
        id: user.roleRel.id,
        name: user.roleRel.name,
        slug: user.roleRel.slug,
        level: user.roleRel.level,
        isSystem: user.roleRel.isSystem,
      };
    }

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        isActive: user.isActive,
      },
      role,
      permissions,
    });
  } catch (error) {
    console.error("[/api/ops/auth/me GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
