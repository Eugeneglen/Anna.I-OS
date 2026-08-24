import { NextResponse } from "next/server";
import { requireVendorPermission } from "@/lib/vendor-guard";
import { db } from "@/lib/db";

// ═════════════════════════════════════════════════════
// GET /api/vendor/roles/[id]/permissions — Role + its permissions
// ═════════════════════════════════════════════════════
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireVendorPermission("v_roles", "view");
    if (!auth.success) return auth.response;

    const { id } = await params;

    const role = await db.role.findFirst({
      where: { id, slug: { startsWith: "vendor_" } },
      include: {
        rolePermissions: {
          include: { permission: true },
          orderBy: { permission: { module: "asc" } },
        },
      },
    });

    if (!role) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 });
    }

    return NextResponse.json({
      role: {
        id: role.id,
        name: role.name,
        slug: role.slug,
        description: role.description,
        isSystem: role.isSystem,
        level: role.level,
        permissions: role.rolePermissions.map((rp) => ({
          id: rp.permission.id,
          module: rp.permission.module,
          action: rp.permission.action,
          description: rp.permission.description,
        })),
      },
    });
  } catch (error) {
    console.error("[/api/vendor/roles/[id]/permissions GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ═════════════════════════════════════════════════════
// PATCH /api/vendor/roles/[id]/permissions — Update role permissions
// NOTE: vendor roles are shared globally across all vendors. Editing a
// role's permissions affects EVERY vendor that uses that role. This is
// gated behind v_roles:edit and fully audited.
// ═════════════════════════════════════════════════════
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireVendorPermission("v_roles", "edit");
    if (!auth.success) return auth.response;

    const { id } = await params;
    const body = await req.json();
    const { permissions }: { permissions: string[] } = body;

    if (!Array.isArray(permissions)) {
      return NextResponse.json({ error: "permissions array required" }, { status: 400 });
    }

    // Verify it's a vendor-scoped role
    const role = await db.role.findFirst({
      where: { id, slug: { startsWith: "vendor_" } },
    });
    if (!role) {
      return NextResponse.json({ error: "Vendor role not found" }, { status: 404 });
    }

    // Capture before-state for audit
    const beforePerms = await db.rolePermission.findMany({
      where: { roleId: id },
      include: { permission: { select: { module: true, action: true } } },
    });
    const beforeKeys = beforePerms.map((rp) => `${rp.permission.module}:${rp.permission.action}`);

    // Delete all existing permission mappings for this role
    await db.rolePermission.deleteMany({ where: { roleId: id } });

    // Re-insert the new set
    let assigned = 0;
    for (const key of permissions) {
      const [mod, act] = key.split(":");
      const perm = await db.permission.findUnique({
        where: { module_action: { module: mod, action: act } },
      });
      if (!perm) continue;
      await db.rolePermission.create({
        data: { roleId: id, permissionId: perm.id },
      });
      assigned++;
    }

    // Audit log (critical operation — capture before/after)
    await db.auditLog.create({
      data: {
        userName: auth.session.name,
        vendorId: auth.vendorId,
        action: "vendor.role.permissions.update",
        entityType: "Role",
        entityId: id,
        metadata: {
          roleName: role.name,
          roleSlug: role.slug,
          before: beforeKeys,
          after: permissions,
          assignedCount: assigned,
        },
      },
    }).catch((err: unknown) => {
      console.warn("[vendor audit] failed to write role-permissions audit log:", err);
    });

    console.log(
      `[PATCH /api/vendor/roles/${id}/permissions] ${assigned} permissions updated for ${role.name} (audited)`
    );

    return NextResponse.json({ success: true, assigned });
  } catch (error) {
    console.error("[/api/vendor/roles/[id]/permissions PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
