import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission, auditLog } from "@/lib/permissions";

// ──────────────────────────────────────────────────────────
// PATCH /api/ops/roles/[id] — Update role
// ──────────────────────────────────────────────────────────
const updateRoleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  level: z.number().int().min(1).max(10).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await hasPermission(session, "roles", "edit");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const parsed = updateRoleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const target = await db.role.findUnique({ where: { id } });
    if (!target) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    // System roles: only description can be modified
    if (target.isSystem) {
      const disallowed = Object.keys(parsed.data).filter(
        (k) => k !== "description"
      );
      if (disallowed.length > 0) {
        return NextResponse.json(
          { error: `Cannot modify ${disallowed.join(", ")} on system roles` },
          { status: 403 }
        );
      }
    }

    // Level constraint: cannot set level > own level
    if (parsed.data.level !== undefined) {
      let reqLevel = 0;
      if (session.roleId) {
        const reqRole = await db.role.findUnique({ where: { id: session.roleId } });
        reqLevel = reqRole?.level ?? 0;
      } else {
        const legacyLevels: Record<string, number> = { ADMIN: 3, COORDINATOR: 2, ANALYST: 1 };
        reqLevel = legacyLevels[session.role] || 0;
      }

      if (parsed.data.level > reqLevel) {
        return NextResponse.json(
          { error: "Cannot set level higher than your own" },
          { status: 403 }
        );
      }
    }

    const updated = await db.role.update({
      where: { id },
      data: parsed.data,
    });

    await auditLog({
      userId: session.userId,
      userName: session.name,
      action: "role.update",
      entityType: "Role",
      entityId: id,
      metadata: { changes: parsed.data },
    });

    return NextResponse.json({ role: updated });
  } catch (error) {
    console.error("[/api/ops/roles/[id] PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ──────────────────────────────────────────────────────────
// DELETE /api/ops/roles/[id] — Delete custom role
// ──────────────────────────────────────────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await hasPermission(session, "roles", "delete");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const target = await db.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!target) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    if (target.isSystem) {
      return NextResponse.json(
        { error: "Cannot delete system roles" },
        { status: 403 }
      );
    }

    if (target._count.users > 0) {
      return NextResponse.json(
        { error: "Cannot delete role with assigned users" },
        { status: 403 }
      );
    }

    await db.role.delete({ where: { id } });

    await auditLog({
      userId: session.userId,
      userName: session.name,
      action: "role.delete",
      entityType: "Role",
      entityId: id,
      metadata: { roleName: target.name, slug: target.slug },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/ops/roles/[id] DELETE]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
