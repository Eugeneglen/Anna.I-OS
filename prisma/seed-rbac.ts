/**
 * seed-rbac.ts — Idempotent RBAC seed script
 *
 * Creates 72 permissions, 4 system roles, and migrates existing OpsUser records.
 *
 * Usage:  bun run prisma/seed-rbac.ts
 */

import { db } from "./seed-db";

// ─── Permission definitions ────────────────────────────────────────

interface PermDef {
  module: string;
  action: string;
  description: string;
}

const PERMISSIONS: PermDef[] = [
  // analytics: 2
  { module: "analytics", action: "view", description: "View analytics dashboard" },
  { module: "analytics", action: "export", description: "Export analytics data" },

  // bookings: 7
  { module: "bookings", action: "view", description: "View bookings" },
  { module: "bookings", action: "create", description: "Create bookings" },
  { module: "bookings", action: "edit", description: "Edit bookings" },
  { module: "bookings", action: "delete", description: "Delete bookings" },
  { module: "bookings", action: "export", description: "Export bookings" },
  { module: "bookings", action: "approve", description: "Approve bookings" },
  { module: "bookings", action: "assign", description: "Assign bookings to vendors" },

  // households: 6
  { module: "households", action: "view", description: "View households" },
  { module: "households", action: "create", description: "Create households" },
  { module: "households", action: "edit", description: "Edit households" },
  { module: "households", action: "delete", description: "Delete households" },
  { module: "households", action: "export", description: "Export households" },
  { module: "households", action: "assign", description: "Assign households to coordinators" },

  // vendors: 5
  { module: "vendors", action: "view", description: "View vendors" },
  { module: "vendors", action: "create", description: "Create vendors" },
  { module: "vendors", action: "edit", description: "Edit vendors" },
  { module: "vendors", action: "delete", description: "Delete vendors" },
  { module: "vendors", action: "export", description: "Export vendors" },

  // escrow: 6
  { module: "escrow", action: "view", description: "View escrow transactions" },
  { module: "escrow", action: "create", description: "Create escrow entries" },
  { module: "escrow", action: "edit", description: "Edit escrow entries" },
  { module: "escrow", action: "delete", description: "Delete escrow entries" },
  { module: "escrow", action: "export", description: "Export escrow data" },
  { module: "escrow", action: "approve", description: "Approve escrow release" },

  // config: 2
  { module: "config", action: "view", description: "View platform configuration" },
  { module: "config", action: "configure", description: "Modify platform configuration" },

  // autonomy: 3
  { module: "autonomy", action: "view", description: "View autonomy settings" },
  { module: "autonomy", action: "edit", description: "Edit autonomy settings" },
  { module: "autonomy", action: "configure", description: "Configure autonomy thresholds" },

  // notifications: 7
  { module: "notifications", action: "view", description: "View notifications" },
  { module: "notifications", action: "create", description: "Create/send notifications" },
  { module: "notifications", action: "edit", description: "Edit notifications" },
  { module: "notifications", action: "delete", description: "Delete notifications" },
  { module: "notifications", action: "export", description: "Export notifications" },
  { module: "notifications", action: "configure", description: "Configure notification settings" },

  // anomalies: 5
  { module: "anomalies", action: "view", description: "View anomalies" },
  { module: "anomalies", action: "edit", description: "Edit anomalies" },
  { module: "anomalies", action: "delete", description: "Delete anomalies" },
  { module: "anomalies", action: "export", description: "Export anomalies" },
  { module: "anomalies", action: "approve", description: "Approve anomaly resolutions" },

  // subscriptions: 6
  { module: "subscriptions", action: "view", description: "View subscriptions" },
  { module: "subscriptions", action: "create", description: "Create subscriptions" },
  { module: "subscriptions", action: "edit", description: "Edit subscriptions" },
  { module: "subscriptions", action: "delete", description: "Delete subscriptions" },
  { module: "subscriptions", action: "export", description: "Export subscriptions" },
  { module: "subscriptions", action: "approve", description: "Approve subscription changes" },

  // users: 6
  { module: "users", action: "view", description: "View ops users" },
  { module: "users", action: "create", description: "Create ops users" },
  { module: "users", action: "edit", description: "Edit ops users" },
  { module: "users", action: "delete", description: "Delete ops users" },
  { module: "users", action: "export", description: "Export ops users" },
  { module: "users", action: "assign", description: "Assign roles to ops users" },

  // roles: 5
  { module: "roles", action: "view", description: "View roles" },
  { module: "roles", action: "create", description: "Create roles" },
  { module: "roles", action: "edit", description: "Edit roles" },
  { module: "roles", action: "delete", description: "Delete roles" },
  { module: "roles", action: "assign", description: "Assign roles to users" },
];

// ─── Role definitions ─────────────────────────────────────────────

interface RoleDef {
  name: string;
  slug: string;
  description: string;
  level: number;
  /** List of "module:action" strings */
  permissions: string[];
}

/**
 * Helper: build a module:action set from shorthand arrays.
 * E.g. modules("analytics", ["view", "export"]) → ["analytics:view", "analytics:export"]
 */
function perm(mod: string, actions: string[]): string[] {
  return actions.map((a) => `${mod}:${a}`);
}

/** All modules and their full action sets for super_admin */
const ALL_PERMS: string[] = PERMISSIONS.map((p) => `${p.module}:${p.action}`);

const ROLES: RoleDef[] = [
  {
    name: "Super Admin",
    slug: "super_admin",
    description: "Full system access — all permissions on all modules",
    level: 4,
    permissions: [...ALL_PERMS],
  },
  {
    name: "Operations",
    slug: "operations",
    description: "Day-to-day operations — no system config, no role management, no user deletion",
    level: 3,
    permissions: [
      ...perm("analytics", ["view", "export"]),
      ...perm("bookings", ["view", "create", "edit", "delete", "export", "approve", "assign"]),
      ...perm("households", ["view", "create", "edit", "delete", "export", "assign"]),
      ...perm("vendors", ["view", "create", "edit", "delete", "export"]),
      ...perm("escrow", ["view", "create", "edit", "delete", "export", "approve"]),
      ...perm("config", ["view"]),                      // NO configure
      ...perm("autonomy", ["view", "edit"]),            // NO configure
      ...perm("notifications", ["view", "create", "edit", "delete", "export"]), // NO configure
      ...perm("anomalies", ["view", "edit", "delete", "export", "approve"]),
      ...perm("subscriptions", ["view", "create", "edit", "delete", "export", "approve"]),
      ...perm("users", ["view", "create", "edit", "export", "assign"]), // NO delete
      ...perm("roles", ["view"]),                        // NO create/edit/delete/assign
    ],
  },
  {
    name: "Coordinator",
    slug: "coordinator",
    description: "Frontline coordination — bookings & households, limited vendor/escrow access",
    level: 2,
    permissions: [
      ...perm("analytics", ["view"]),
      ...perm("bookings", ["view", "create", "edit", "delete", "assign"]),
      ...perm("households", ["view", "create", "edit", "delete"]),
      ...perm("vendors", ["view"]),                      // NO write
      ...perm("escrow", ["view"]),                      // NO write
      ...perm("config", ["view"]),
      ...perm("autonomy", ["view"]),
      ...perm("notifications", ["view", "create"]),
      ...perm("anomalies", ["view"]),
      ...perm("subscriptions", ["view", "create"]),
      // NO users, NO roles
    ],
  },
  {
    name: "Data Analyst",
    slug: "data_analyst",
    description: "Read-only analytics — view + export on data modules, no vendors",
    level: 1,
    permissions: [
      ...perm("analytics", ["view", "export"]),
      ...perm("bookings", ["view", "export"]),
      ...perm("households", ["view", "export"]),
      // NO vendors
      ...perm("escrow", ["view", "export"]),
      ...perm("config", ["view", "export"]),             // export config data for analysis
      ...perm("autonomy", ["view", "export"]),           // export autonomy data
      ...perm("notifications", ["view", "export"]),
      ...perm("anomalies", ["view", "export"]),
      ...perm("subscriptions", ["view", "export"]),
      // NO users, NO roles
    ],
  },
];

// ─── MAPPING: old OpsRole enum → new Role slug ────────────────────

const ROLE_MIGRATION: Record<string, string> = {
  ADMIN: "super_admin",
  COORDINATOR: "coordinator",
  ANALYST: "data_analyst",
};

// ─── Vendor RBAC permissions (v_ prefix) ────────────────────────────

const VENDOR_PERMISSIONS: PermDef[] = [
  // v_schedule: 4
  { module: "v_schedule", action: "view", description: "View schedule" },
  { module: "v_schedule", action: "edit", description: "Edit schedule" },
  { module: "v_schedule", action: "create", description: "Create schedule entries" },
  { module: "v_schedule", action: "delete", description: "Delete schedule entries" },

  // v_calendar: 2
  { module: "v_calendar", action: "view", description: "View calendar" },
  { module: "v_calendar", action: "edit", description: "Edit calendar" },

  // v_earnings: 4
  { module: "v_earnings", action: "view", description: "View earnings" },
  { module: "v_earnings", action: "export", description: "Export earnings" },
  { module: "v_earnings", action: "edit", description: "Edit earnings" },
  { module: "v_earnings", action: "dispute", description: "Dispute earnings" },

  // v_staff: 4
  { module: "v_staff", action: "view", description: "View staff roster" },
  { module: "v_staff", action: "create", description: "Add staff" },
  { module: "v_staff", action: "edit", description: "Edit staff" },
  { module: "v_staff", action: "delete", description: "Remove staff" },

  // v_bookings: 5
  { module: "v_bookings", action: "view", description: "View bookings" },
  { module: "v_bookings", action: "accept", description: "Accept bookings" },
  { module: "v_bookings", action: "reject", description: "Reject bookings" },
  { module: "v_bookings", action: "complete", description: "Complete bookings" },
  { module: "v_bookings", action: "cancel", description: "Cancel bookings" },

  // v_settings: 3
  { module: "v_settings", action: "view", description: "View settings" },
  { module: "v_settings", action: "edit", description: "Edit settings" },
  { module: "v_settings", action: "configure", description: "Configure vendor profile" },

  // v_users: 5
  { module: "v_users", action: "view", description: "View vendor users" },
  { module: "v_users", action: "create", description: "Add vendor users" },
  { module: "v_users", action: "edit", description: "Edit vendor users" },
  { module: "v_users", action: "delete", description: "Remove vendor users" },
  { module: "v_users", action: "assign", description: "Assign roles to vendor users" },

  // v_roles: 3
  { module: "v_roles", action: "view", description: "View vendor roles" },
  { module: "v_roles", action: "edit", description: "Edit vendor role permissions" },
  { module: "v_roles", action: "assign", description: "Assign roles to vendor staff" },
];

const VENDOR_ROLE_DEFS: RoleDef[] = [
  {
    name: "Super Admin",
    slug: "vendor_admin",
    description: "Full vendor portal control — users, roles & all modules",
    level: 4,
    permissions: VENDOR_PERMISSIONS.map((p) => `${p.module}:${p.action}`),
  },
  {
    name: "Vendor Manager",
    slug: "vendor_manager",
    description: "Manage day-to-day operations — schedule, staff, bookings, earnings",
    level: 3,
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
    name: "Vendor Staff",
    slug: "vendor_staff_role",
    description: "Basic access — view schedule, calendar, and own bookings",
    level: 1,
    permissions: [
      ...perm("v_schedule", ["view"]),
      ...perm("v_calendar", ["view"]),
      ...perm("v_bookings", ["view"]),
    ],
  },
];

// Legacy vendor emails to assign vendor_admin role
const VENDOR_ADMIN_EMAILS = [
  "ops@sparkclean.sg",
  "hello@freshwash.sg",
  "bookings@coolair.sg",
  "support@fixit.sg",
  "ops@greensweep.sg",
];

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log("🔄 Seeding RBAC data…\n");

  // ── 1. Upsert all permissions ─────────────────────────────────
  console.log(`  Creating ${PERMISSIONS.length} ops permissions…`);
  let permCount = 0;
  for (const p of PERMISSIONS) {
    await db.permission.upsert({
      where: { module_action: { module: p.module, action: p.action } },
      update: { description: p.description },
      create: { module: p.module, action: p.action, description: p.description },
    });
    permCount++;
  }
  console.log(`  ✅ ${permCount} ops permissions upserted.\n`);

  // ── 1b. Upsert vendor permissions ─────────────────────────────
  console.log(`  Creating ${VENDOR_PERMISSIONS.length} vendor permissions…`);
  let vPermCount = 0;
  for (const p of VENDOR_PERMISSIONS) {
    await db.permission.upsert({
      where: { module_action: { module: p.module, action: p.action } },
      update: { description: p.description },
      create: { module: p.module, action: p.action, description: p.description },
    });
    vPermCount++;
  }
  console.log(`  ✅ ${vPermCount} vendor permissions upserted.\n`);

  // ── 2. Upsert all ops roles ───────────────────────────────────
  console.log(`  Creating ${ROLES.length} ops system roles…`);
  const roleIds: Record<string, string> = {};
  for (const r of ROLES) {
    const role = await db.role.upsert({
      where: { slug: r.slug },
      update: { name: r.name, description: r.description, level: r.level, isSystem: true },
      create: {
        name: r.name,
        slug: r.slug,
        description: r.description,
        level: r.level,
        isSystem: true,
      },
    });
    roleIds[r.slug] = role.id;
    console.log(`    ✅ ${r.slug} (id: ${role.id})`);
  }
  console.log("");

  // ── 2b. Upsert vendor roles ───────────────────────────────────
  console.log(`  Creating ${VENDOR_ROLE_DEFS.length} vendor roles…`);
  for (const r of VENDOR_ROLE_DEFS) {
    const role = await db.role.upsert({
      where: { slug: r.slug },
      update: { name: r.name, description: r.description, level: r.level, isSystem: true },
      create: {
        name: r.name,
        slug: r.slug,
        description: r.description,
        level: r.level,
        isSystem: true,
      },
    });
    roleIds[r.slug] = role.id;
    console.log(`    ✅ ${r.slug} (id: ${role.id})`);
  }
  console.log("");

  // ── 3. Upsert ops role-permission mappings ────────────────────
  console.log("  Assigning ops permissions to roles…");
  let rpCount = 0;
  for (const r of ROLES) {
    const roleId = roleIds[r.slug];
    for (const key of r.permissions) {
      const [module, action] = key.split(":");
      const permRecord = await db.permission.findUnique({
        where: { module_action: { module, action } },
        select: { id: true },
      });
      if (!permRecord) {
        console.warn(`    ⚠️  Permission not found: ${key} — skipping`);
        continue;
      }
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permRecord.id } },
        update: {},
        create: { roleId, permissionId: permRecord.id },
      });
      rpCount++;
    }
    console.log(`    ✅ ${r.slug}: ${r.permissions.length} permissions assigned`);
  }
  console.log(`  ✅ ${rpCount} ops role-permission pairs upserted.\n`);

  // ── 3b. Upsert vendor role-permission mappings ────────────────
  console.log("  Assigning vendor permissions to roles…");
  let vRpCount = 0;
  for (const r of VENDOR_ROLE_DEFS) {
    const roleId = roleIds[r.slug];
    for (const key of r.permissions) {
      const [module, action] = key.split(":");
      const permRecord = await db.permission.findUnique({
        where: { module_action: { module, action } },
        select: { id: true },
      });
      if (!permRecord) {
        console.warn(`    ⚠️  Permission not found: ${key} — skipping`);
        continue;
      }
      await db.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId: permRecord.id } },
        update: {},
        create: { roleId, permissionId: permRecord.id },
      });
      vRpCount++;
    }
    console.log(`    ✅ ${r.slug}: ${r.permissions.length} vendor permissions assigned`);
  }
  console.log(`  ✅ ${vRpCount} vendor role-permission pairs upserted.\n`);

  // ── 4. Migrate existing OpsUser records ───────────────────────
  console.log("  Migrating existing OpsUser records to new RBAC roles…");
  const existingUsers = await db.opsUser.findMany({ select: { id: true, role: true, roleId: true } });
  let migrated = 0;
  let skipped = 0;
  for (const user of existingUsers) {
    if (user.roleId) { skipped++; continue; }
    const targetSlug = ROLE_MIGRATION[user.role];
    if (!targetSlug || !roleIds[targetSlug]) {
      console.warn(`    ⚠️  No RBAC mapping for OpsRole ${user.role} — skipping user ${user.id}`);
      skipped++; continue;
    }
    await db.opsUser.update({ where: { id: user.id }, data: { roleId: roleIds[targetSlug] } });
    migrated++;
    console.log(`    ✅ User ${user.id} (${user.role}) → ${targetSlug}`);
  }
  console.log(`  ✅ Migrated ${migrated} users, ${skipped} already done/skipped.\n`);

  // ── 5. Assign legacy vendors to vendor_admin role ────────────
  console.log("  Assigning legacy vendors to vendor_admin role…");
  const vendorAdminRoleId = roleIds["vendor_admin"];
  if (vendorAdminRoleId) {
    let vendorMigrated = 0;
    for (const email of VENDOR_ADMIN_EMAILS) {
      const vendor = await db.vendor.findUnique({ where: { email }, select: { id: true, roleId: true } });
      if (!vendor) {
        console.warn(`    ⚠️  Vendor not found: ${email}`);
        continue;
      }
      if (vendor.roleId) {
        console.log(`    ⏭️  Vendor ${email} already has roleId — skipping`);
        continue;
      }
      await db.vendor.update({ where: { id: vendor.id }, data: { roleId: vendorAdminRoleId } });
      vendorMigrated++;
      console.log(`    ✅ Vendor ${email} → vendor_admin`);
    }
    console.log(`  ✅ ${vendorMigrated} vendors assigned vendor_admin.\n`);
  } else {
    console.warn("  ⚠️  vendor_admin role not found — skipping vendor assignment.\n");
  }

  // ── Summary ───────────────────────────────────────────────────
  const totalPerms = await db.permission.count();
  const totalRoles = await db.role.count();
  const totalRP = await db.rolePermission.count();
  console.log("═══════════════════════════════════════");
  console.log(`  Permissions : ${totalPerms}`);
  console.log(`  Roles       : ${totalRoles}`);
  console.log(`  Role-Perms  : ${totalRP}`);
  console.log("═══════════════════════════════════════");
  console.log("\n✅ RBAC seed complete.\n");
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error("❌ RBAC seed failed:", e);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}

export default main;
