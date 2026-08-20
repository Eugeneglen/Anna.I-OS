import { NextResponse } from "next/server";
import { getVendorSession } from "@/lib/vendor-auth";
import { db } from "@/lib/db";

// Vendor RBAC self-heal — ensures vendor roles/permissions exist

let vendorSelfHealed = false;

const VENDOR_PERMISSIONS = [
  { module: "v_schedule", action: "view" }, { module: "v_schedule", action: "edit" },
  { module: "v_schedule", action: "create" }, { module: "v_schedule", action: "delete" },
  { module: "v_calendar", action: "view" }, { module: "v_calendar", action: "edit" },
  { module: "v_earnings", action: "view" }, { module: "v_earnings", action: "export" },
  { module: "v_earnings", action: "edit" }, { module: "v_earnings", action: "dispute" },
  { module: "v_staff", action: "view" }, { module: "v_staff", action: "create" },
  { module: "v_staff", action: "edit" }, { module: "v_staff", action: "delete" },
  { module: "v_bookings", action: "view" }, { module: "v_bookings", action: "accept" },
  { module: "v_bookings", action: "reject" }, { module: "v_bookings", action: "complete" },
  { module: "v_bookings", action: "cancel" },
  { module: "v_settings", action: "view" }, { module: "v_settings", action: "edit" },
  { module: "v_settings", action: "configure" },
  { module: "v_users", action: "view" }, { module: "v_users", action: "create" },
  { module: "v_users", action: "edit" }, { module: "v_users", action: "delete" },
  { module: "v_users", action: "assign" },
  { module: "v_roles", action: "view" }, { module: "v_roles", action: "edit" },
  { module: "v_roles", action: "assign" },
];

function perm(mod: string, actions: string[]) {
  return actions.map((a) => `${mod}:${a}`);
}

const VENDOR_ROLE_DEFS = [
  {
    name: "Super Admin", slug: "vendor_super_admin", description: "Controls user management, role management & all vendor modules", level: 5,
    permissions: VENDOR_PERMISSIONS.map((p) => `${p.module}:${p.action}`),
  },
  {
    name: "Vendor Admin", slug: "vendor_admin", description: "Full vendor portal control — all permissions", level: 4,
    permissions: VENDOR_PERMISSIONS.map((p) => `${p.module}:${p.action}`),
  },
  {
    name: "Vendor Manager", slug: "vendor_manager", description: "Day-to-day operations", level: 3,
    permissions: [
      ...perm("v_schedule", ["view", "edit", "create", "delete"]),
      ...perm("v_calendar", ["view", "edit"]),
      ...perm("v_earnings", ["view", "export"]),
      ...perm("v_staff", ["view", "create", "edit"]),
      ...perm("v_bookings", ["view", "accept", "reject", "complete"]),
      ...perm("v_settings", ["view"]),
      ...perm("v_users", ["view"]),
      ...perm("v_roles", ["view"]),
    ],
  },
  {
    name: "Vendor Staff", slug: "vendor_staff_role", description: "Basic access", level: 1,
    permissions: [
      ...perm("v_schedule", ["view"]),
      ...perm("v_calendar", ["view"]),
      ...perm("v_bookings", ["view"]),
    ],
  },
];

async function ensureVendorRbac() {
  if (vendorSelfHealed) return;

  const vendorRoleCount = await db.role.count({
    where: { slug: { startsWith: "vendor_" } },
  });
  if (vendorRoleCount >= 4) {
    vendorSelfHealed = true;
    return;
  }

  console.log("[ensureVendorRbac] Seeding vendor RBAC data…");

  // Create vendor permissions
  for (const p of VENDOR_PERMISSIONS) {
    await db.permission.upsert({
      where: { module_action: { module: p.module, action: p.action } },
      update: {},
      create: { module: p.module, action: p.action, description: `Vendor: ${p.module} ${p.action}` },
    });
  }

  // Create vendor roles
  const roleIds: Record<string, string> = {};
  for (const r of VENDOR_ROLE_DEFS) {
    const role = await db.role.upsert({
      where: { slug: r.slug },
      update: { name: r.name, description: r.description, level: r.level, isSystem: true },
      create: { name: r.name, slug: r.slug, description: r.description, level: r.level, isSystem: true },
    });
    roleIds[r.slug] = role.id;
  }

  // Assign permissions to roles
  for (const r of VENDOR_ROLE_DEFS) {
    const roleId = roleIds[r.slug];
    for (const key of r.permissions) {
      const [mod, act] = key.split(":");
      const perm = await db.permission.findUnique({ where: { module_action: { module: mod, action: act } } });
      if (!perm) continue;
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: perm.id } },
        update: {},
        create: { roleId, permissionId: perm.id },
      });
    }
  }

  // Assign vendors without roleId to Super Admin
  const superAdminId = roleIds["vendor_super_admin"];
  if (superAdminId) {
    await db.vendor.updateMany({ where: { roleId: null }, data: { roleId: superAdminId } });
  }

  console.log("[ensureVendorRbac] ✅ Vendor RBAC self-heal complete.");
  vendorSelfHealed = true;
}

// ═════════════════════════════════════════════════════
// GET /api/vendor/roles — List vendor-scoped roles
// ═════════════════════════════════════════════════════
export async function GET() {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureVendorRbac();

    const roles = await db.role.findMany({
      where: { slug: { startsWith: "vendor_" } },
      orderBy: { level: "desc" },
      include: {
        rolePermissions: { include: { permission: true }, orderBy: { permission: { module: "asc" } } },
        _count: { select: { vendors: true, vendorStaff: true } },
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
        userCount: r._count.vendors + r._count.vendorStaff,
        permissions: r.rolePermissions.map((rp) => `${rp.permission.module}:${rp.permission.action}`),
      })),
    });
  } catch (error) {
    console.error("[/api/vendor/roles GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
