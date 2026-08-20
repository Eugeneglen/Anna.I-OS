import { NextResponse } from "next/server";
import { getVendorSession } from "@/lib/vendor-auth";
import { db } from "@/lib/db";

// ═════════════════════════════════════════════════════
// GET /api/vendor/roles/[id]/permissions — Role + its permissions
// ═════════════════════════════════════════════════════
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
// ═════════════════════════════════════════════════════
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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

    console.log(
      `[PATCH /api/vendor/roles/${id}/permissions] ${assigned} permissions updated for ${role.name}`
    );

    return NextResponse.json({ success: true, assigned });
  } catch (error) {
    console.error("[/api/vendor/roles/[id]/permissions PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
