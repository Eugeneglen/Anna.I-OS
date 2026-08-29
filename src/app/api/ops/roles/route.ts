import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission, auditLog } from "@/lib/permissions";

// ═════════════════════════════════════════════════════
// Self-healing RBAC seed — runs once per server process if the
// roles table is empty (seed never ran on Railway, etc.)
// ═════════════════════════════════════════════════════

let selfHealed = false;

const PERMISSIONS: { module: string; action: string; description: string }[] = [
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
  // marketing: 4
  { module: "marketing", action: "view", description: "View campaigns and discount codes" },
  { module: "marketing", action: "create", description: "Create campaigns and generate codes" },
  { module: "marketing", action: "edit", description: "Edit campaigns and manage codes" },
  { module: "marketing", action: "delete", description: "Delete campaigns (DRAFT only)" },
];

function perm(mod: string, actions: string[]): string[] {
  return actions.map((a) => `${mod}:${a}`);
}

const ALL_PERMS: string[] = PERMISSIONS.map((p) => `${p.module}:${p.action}`);

const ROLE_DEFS: {
  name: string;
  slug: string;
  description: string;
  level: number;
  permissions: string[];
}[] = [
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
      ...perm("config", ["view"]),
      ...perm("autonomy", ["view", "edit"]),
      ...perm("notifications", ["view", "create", "edit", "delete", "export"]),
      ...perm("anomalies", ["view", "edit", "delete", "export", "approve"]),
      ...perm("subscriptions", ["view", "create", "edit", "delete", "export", "approve"]),
      ...perm("users", ["view", "create", "edit", "export", "assign"]),
      ...perm("roles", ["view"]),
      ...perm("marketing", ["view", "create", "edit", "delete"]),
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
      ...perm("vendors", ["view"]),
      ...perm("escrow", ["view"]),
      ...perm("config", ["view"]),
      ...perm("autonomy", ["view"]),
      ...perm("notifications", ["view", "create"]),
      ...perm("anomalies", ["view"]),
      ...perm("subscriptions", ["view", "create"]),
      ...perm("marketing", ["view", "create"]),
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
      ...perm("escrow", ["view", "export"]),
      ...perm("config", ["view", "export"]),
      ...perm("autonomy", ["view", "export"]),
      ...perm("notifications", ["view", "export"]),
      ...perm("anomalies", ["view", "export"]),
      ...perm("subscriptions", ["view", "export"]),
    ],
  },
];

const ROLE_MIGRATION: Record<string, string> = {
  ADMIN: "super_admin",
  COORDINATOR: "coordinator",
  ANALYST: "data_analyst",
};

async function ensureRbacSeeded() {
  if (selfHealed) return;

  const roleCount = await db.role.count();
  if (roleCount > 0) {
    console.log("[ensureRbacSeeded] Roles already exist, skipping.");
    selfHealed = true;
    return;
  }

  console.log("[ensureRbacSeeded] No roles found — self-healing RBAC data…");

  // 1. Create all 72 permissions
  console.log(`[ensureRbacSeeded] Creating ${PERMISSIONS.length} permissions…`);
  for (const p of PERMISSIONS) {
    await db.permission.create({
      data: { module: p.module, action: p.action, description: p.description },
    });
  }
  console.log(`[ensureRbacSeeded] ✅ ${PERMISSIONS.length} permissions created.`);

  // 2. Create all 4 system roles
  const roleIds: Record<string, string> = {};
  for (const r of ROLE_DEFS) {
    const role = await db.role.create({
      data: {
        name: r.name,
        slug: r.slug,
        description: r.description,
        level: r.level,
        isSystem: true,
      },
    });
    roleIds[r.slug] = role.id;
    console.log(`[ensureRbacSeeded]   ✅ Role created: ${r.slug} (${role.id})`);
  }

  // 3. Create role-permission mappings
  console.log("[ensureRbacSeeded] Assigning permissions to roles…");
  let rpTotal = 0;
  for (const r of ROLE_DEFS) {
    const roleId = roleIds[r.slug];
    for (const key of r.permissions) {
      const [mod, act] = key.split(":");
      const permRecord = await db.permission.findUnique({
        where: { module_action: { module: mod, action: act } },
        select: { id: true },
      });
      if (!permRecord) {
        console.warn(`[ensureRbacSeeded]   ⚠️  Permission not found: ${key} — skipping`);
        continue;
      }
      await db.rolePermission.create({
        data: { roleId, permissionId: permRecord.id },
      });
      rpTotal++;
    }
    console.log(`[ensureRbacSeeded]   ✅ ${r.slug}: ${r.permissions.length} permissions assigned`);
  }
  console.log(`[ensureRbacSeeded] ✅ ${rpTotal} role-permission pairs created.`);

  // 4. Migrate legacy users without roleId
  console.log("[ensureRbacSeeded] Migrating legacy users…");
  const existingUsers = await db.opsUser.findMany({
    select: { id: true, role: true, roleId: true },
  });
  let migrated = 0;
  for (const user of existingUsers) {
    if (user.roleId) continue;
    const targetSlug = ROLE_MIGRATION[user.role];
    if (!targetSlug || !roleIds[targetSlug]) {
      console.warn(`[ensureRbacSeeded]   ⚠️  No mapping for ${user.role} — skipping user ${user.id}`);
      continue;
    }
    await db.opsUser.update({
      where: { id: user.id },
      data: { roleId: roleIds[targetSlug] },
    });
    migrated++;
    console.log(`[ensureRbacSeeded]   ✅ User ${user.id} (${user.role}) → ${targetSlug}`);
  }
  console.log(`[ensureRbacSeeded] ✅ Migrated ${migrated} users.`);

  // 5. Update PlatformConfig seed_version
  try {
    await db.platformConfig.upsert({
      where: { key: "seed_version" },
      update: { value: "rbac-self-heal", label: "RBAC self-heal" },
      create: { key: "seed_version", value: "rbac-self-heal", label: "RBAC self-heal" },
    });
    console.log("[ensureRbacSeeded] ✅ PlatformConfig seed_version updated.");
  } catch (e) {
    console.warn("[ensureRbacSeeded] ⚠️  Could not update PlatformConfig:", e);
  }

  console.log("[ensureRbacSeeded] ✅ Self-heal complete.");
  selfHealed = true;
}

// ═════════════════════════════════════════════════════
// GET /api/ops/roles — List all roles with permissions
// ═════════════════════════════════════════════════════
export async function GET() {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await ensureRbacSeeded();

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

// ═════════════════════════════════════════════════════
// POST /api/ops/roles — Create custom role
// ═════════════════════════════════════════════════════
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

    await ensureRbacSeeded();

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
