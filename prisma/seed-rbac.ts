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

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log("🔄 Seeding RBAC data…\n");

  // ── 1. Upsert all permissions ─────────────────────────────────
  console.log(`  Creating ${PERMISSIONS.length} permissions…`);
  let permCount = 0;
  for (const p of PERMISSIONS) {
    await db.permission.upsert({
      where: { module_action: { module: p.module, action: p.action } },
      update: { description: p.description },
      create: { module: p.module, action: p.action, description: p.description },
    });
    permCount++;
  }
  console.log(`  ✅ ${permCount} permissions upserted.\n`);

  // ── 2. Upsert all roles ───────────────────────────────────────
  console.log(`  Creating ${ROLES.length} system roles…`);
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

  // ── 3. Upsert role-permission mappings ────────────────────────
  console.log("  Assigning permissions to roles…");
  let rpCount = 0;
  for (const r of ROLES) {
    const roleId = roleIds[r.slug];
    for (const key of r.permissions) {
      const [module, action] = key.split(":");
      // Find the permission id
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
  console.log(`  ✅ ${rpCount} role-permission pairs upserted.\n`);

  // ── 4. Migrate existing OpsUser records ───────────────────────
  console.log("  Migrating existing OpsUser records to new RBAC roles…");
  const existingUsers = await db.opsUser.findMany({ select: { id: true, role: true, roleId: true } });
  let migrated = 0;
  let skipped = 0;
  for (const user of existingUsers) {
    // Skip if already migrated
    if (user.roleId) {
      skipped++;
      continue;
    }
    const targetSlug = ROLE_MIGRATION[user.role];
    if (!targetSlug || !roleIds[targetSlug]) {
      console.warn(`    ⚠️  No RBAC mapping for OpsRole ${user.role} — skipping user ${user.id}`);
      skipped++;
      continue;
    }
    await db.opsUser.update({
      where: { id: user.id },
      data: { roleId: roleIds[targetSlug] },
    });
    migrated++;
    console.log(`    ✅ User ${user.id} (${user.role}) → ${targetSlug}`);
  }
  console.log(`  ✅ Migrated ${migrated} users, ${skipped} already done/skipped.\n`);

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
