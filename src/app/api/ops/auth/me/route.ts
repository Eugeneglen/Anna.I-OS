import { NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { db } from "@/lib/db";

/** Legacy OpsRole → Role slug mapping for fallback */
const LEGACY_ROLE_MAP: Record<string, string> = {
  ADMIN: "super_admin",
  COORDINATOR: "coordinator",
  ANALYST: "data_analyst",
};

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
    } else {
      // Legacy fallback: user has no roleId yet (not migrated to RBAC).
      // Try to find the matching Role by slug and auto-assign.
      const targetSlug = LEGACY_ROLE_MAP[user.role];
      if (targetSlug) {
        const fallbackRole = await db.role.findUnique({ where: { slug: targetSlug } });
        if (fallbackRole) {
          // Auto-migrate: link user to the RBAC role
          await db.opsUser.update({
            where: { id: user.id },
            data: { roleId: fallbackRole.id },
          });
          // Load permissions from the role
          const rolePerms = await db.rolePermission.findMany({
            where: { roleId: fallbackRole.id },
            include: { permission: true },
          });
          permissions = rolePerms.map(
            (rp) => rp.permission.module + ":" + rp.permission.action
          );
          role = {
            id: fallbackRole.id,
            name: fallbackRole.name,
            slug: fallbackRole.slug,
            level: fallbackRole.level,
            isSystem: fallbackRole.isSystem,
          };
          console.log(`[auth/me] Auto-migrated legacy user ${user.email} (${user.role}) → ${targetSlug}`);
        }
      }
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
