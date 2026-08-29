import { db } from "@/lib/db";
import { hasMinRole } from "@/lib/ops-auth";

// ──────────────────────────────────────────────────────────
// In-memory permission cache: roleId → { permissions[], expiresAt }
// ──────────────────────────────────────────────────────────

interface CacheEntry {
  permissions: string[];
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const permissionCache = new Map<string, CacheEntry>();

/**
 * Load permissions for a role, using cache when available.
 * Returns array of "module:action" strings like ["bookings:view", "bookings:edit"].
 */
export async function getUserPermissions(roleId: string): Promise<string[]> {
  // Check cache
  const cached = permissionCache.get(roleId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.permissions;
  }

  // Load from DB
  const rolePermissions = await db.rolePermission.findMany({
    where: { roleId },
    include: { permission: true },
  });

  const permissions = rolePermissions.map(
    (rp) => `${rp.permission.module}:${rp.permission.action}`
  );

  // Store in cache
  permissionCache.set(roleId, {
    permissions,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return permissions;
}

/**
 * Invalidate permission cache for a specific role, or all roles if no roleId given.
 */
export function invalidatePermissionCache(roleId?: string): void {
  if (roleId) {
    permissionCache.delete(roleId);
  } else {
    permissionCache.clear();
  }
}

/**
 * Check if a session has a specific permission.
 * Falls back to legacy hasMinRole("ADMIN") if no roleId is set on the session.
 */
export async function hasPermission(
  session: { roleId?: string; role?: string },
  module: string,
  action: string
): Promise<boolean> {
  // If session has roleId, use the new permission system
  if (session.roleId) {
    const perms = await getUserPermissions(session.roleId);
    return perms.includes(`${module}:${action}`);
  }

  // Legacy fallback: if no roleId, treat as ADMIN-only access
  // (the old system only had ADMIN/CORDINATOR/ANALYST with coarse checks)
  return session.role !== undefined && hasMinRole(session.role, "ADMIN");
}

/**
 * Check if a session has ANY of the given permissions.
 * Each permission string should be in "module:action" format.
 */
export async function hasAnyPermission(
  session: { roleId?: string; role?: string },
  perms: string[]
): Promise<boolean> {
  // If session has roleId, use the new permission system
  if (session.roleId) {
    const userPerms = await getUserPermissions(session.roleId);
    return perms.some((p) => userPerms.includes(p));
  }

  // Legacy fallback
  return session.role !== undefined && hasMinRole(session.role, "ADMIN");
}

// ──────────────────────────────────────────────────────────
// Audit logging helper
// ──────────────────────────────────────────────────────────

export async function auditLog(params: {
  userId: string;
  userName: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const meta = params.metadata as any;
  await db.auditLog.create({
    data: {
      userId: params.userId,
      userName: params.userName,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      metadata: meta,
    },
  });
}
