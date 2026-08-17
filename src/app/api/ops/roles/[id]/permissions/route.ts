import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission, auditLog, invalidatePermissionCache } from "@/lib/permissions";

// ──────────────────────────────────────────────────────────
// PUT /api/ops/roles/[id]/permissions — Replace role permissions
// ──────────────────────────────────────────────────────────
const setPermissionsSchema = z.object({
  permissionIds: z.array(z.string()),
});

export async function PUT(
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
    const parsed = setPermissionsSchema.safeParse(body);
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

    // Validate all permission IDs exist
    const validPerms = await db.permission.findMany({
      where: { id: { in: parsed.data.permissionIds } },
      select: { id: true },
    });
    const validIds = new Set(validPerms.map((p) => p.id));
    const invalidIds = parsed.data.permissionIds.filter((pid) => !validIds.has(pid));
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: "Invalid permission IDs", invalidIds },
        { status: 400 }
      );
    }

    // Delete existing + create new (full replacement)
    await db.$transaction([
      db.rolePermission.deleteMany({ where: { roleId: id } }),
      ...parsed.data.permissionIds.map((pid) =>
        db.rolePermission.create({
          data: { roleId: id, permissionId: pid },
        })
      ),
    ]);

    // Invalidate cache
    invalidatePermissionCache(id);

    await auditLog({
      userId: session.userId,
      userName: session.name,
      action: "role.set_permissions",
      entityType: "Role",
      entityId: id,
      metadata: {
        roleName: target.name,
        permissionCount: parsed.data.permissionIds.length,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/ops/roles/[id]/permissions PUT]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
