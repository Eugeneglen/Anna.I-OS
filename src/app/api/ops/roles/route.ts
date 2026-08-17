import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission, auditLog } from "@/lib/permissions";

// ──────────────────────────────────────────────────────────
// GET /api/ops/roles — List all roles with permissions
// ──────────────────────────────────────────────────────────
export async function GET() {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await hasPermission(session, "roles", "view");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const roles = await db.role.findMany({
      orderBy: { level: "desc" },
      include: {
        rolePermissions: {
          include: { permission: true },
          orderBy: { permission: { module: "asc" } },
        },
        _count: { select: { users: true } },
      },
    });

    return NextResponse.json({
      roles: roles.map((r) => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        isSystem: r.isSystem,
        level: r.level,
        permissionCount: r.rolePermissions.length,
        userCount: r._count.users,
        permissions: r.rolePermissions.map(
          (rp) => `${rp.permission.module}:${rp.permission.action}`
        ),
      })),
    });
  } catch (error) {
    console.error("[/api/ops/roles GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ──────────────────────────────────────────────────────────
// POST /api/ops/roles — Create custom role
// ──────────────────────────────────────────────────────────
const createRoleSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1).regex(/^[a-z0-9_]+$/, "Slug must be lowercase alphanumeric with underscores"),
  description: z.string().optional(),
  level: z.number().int().min(1).max(10),
  permissionIds: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await hasPermission(session, "roles", "create");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = createRoleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { name, slug, description, level, permissionIds } = parsed.data;

    // Cannot create with level > requester's level
    let reqLevel = 0;
    if (session.roleId) {
      const reqRole = await db.role.findUnique({ where: { id: session.roleId } });
      reqLevel = reqRole?.level ?? 0;
    } else {
      const legacyLevels: Record<string, number> = { ADMIN: 3, COORDINATOR: 2, ANALYST: 1 };
      reqLevel = legacyLevels[session.role] || 0;
    }

    if (level > reqLevel) {
      return NextResponse.json(
        { error: "Cannot create role with level higher than your own" },
        { status: 403 }
      );
    }

    // Check slug uniqueness
    const existing = await db.role.findUnique({ where: { slug } });
    if (existing) {
      return NextResponse.json({ error: "Slug already exists" }, { status: 409 });
    }

    // Validate permission IDs
    let permsToConnect: { id: string }[] = [];
    if (permissionIds && permissionIds.length > 0) {
      const validPerms = await db.permission.findMany({
        where: { id: { in: permissionIds } },
        select: { id: true },
      });
      permsToConnect = validPerms.map((p) => ({ id: p.id }));
    }

    const role = await db.role.create({
      data: {
        name,
        slug,
        description: description ?? null,
        level,
        isSystem: false,
        rolePermissions: permsToConnect.length > 0
          ? { create: permsToConnect.map((p) => ({ permission: { connect: { id: p.id } } })) }
          : undefined,
      },
    });

    await auditLog({
      userId: session.userId,
      userName: session.name,
      action: "role.create",
      entityType: "Role",
      entityId: role.id,
      metadata: { name, slug, level, permissionCount: permsToConnect.length },
    });

    return NextResponse.json({ role }, { status: 201 });
  } catch (error) {
    console.error("[/api/ops/roles POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
