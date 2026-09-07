// ============================================================
// Anna.I — Vendor AI permission (v_ai:view)
// ============================================================
// AI Wave 2-A (A-6): the vendor RBAC catalogue had NO permission key for
// the AI assistant — VendorAiChat was mounted unconditionally in the
// vendor layout and /api/vendor/ai only checked that a vendor session
// existed. Every staff member of every role got the AI.
//
// This module introduces `v_ai:view` and backfills it ID EMPOTENTLY:
//   - the Permission row is upserted
//   - it is granted to the four vendor SYSTEM roles (super admin, admin,
//     manager, staff) — exactly the roles that had AI access before, so
//     NOBODY loses access on upgrade (no "fix one, break another")
//   - custom roles created/edited afterwards do NOT get it unless an
//     admin grants it — the gate becomes real going forward
//
// The backfill runs once per server process (module-level flag) and is
// called from /api/vendor/session (so the layout's can() sees it) and
// /api/vendor/ai (server-side enforcement).
// ============================================================

import { db } from "@/lib/db";
import type { VendorSession } from "./vendor-auth";

const VENDOR_AI_PERMISSION = { module: "v_ai", action: "view" } as const;

/** System roles that had AI access before the gate existed — grandfathered. */
const GRANDFATHERED_ROLE_SLUGS = [
  "vendor_super_admin",
  "vendor_admin",
  "vendor_manager",
  "vendor_staff_role",
];

let ensured = false;

/**
 * Idempotent, non-fatal permission backfill (once per process).
 * A failure here must never break the session/ai routes — it just means
 * the permission check will deny until the next successful ensure.
 */
export async function ensureVendorAiPermission(): Promise<void> {
  if (ensured) return;
  try {
    const perm = await db.permission.upsert({
      where: {
        module_action: {
          module: VENDOR_AI_PERMISSION.module,
          action: VENDOR_AI_PERMISSION.action,
        },
      },
      update: {},
      create: {
        module: VENDOR_AI_PERMISSION.module,
        action: VENDOR_AI_PERMISSION.action,
        description: "Vendor AI assistant (chat) access",
      },
    });

    const systemRoles = await db.role.findMany({
      where: { slug: { in: GRANDFATHERED_ROLE_SLUGS } },
      select: { id: true },
    });
    for (const role of systemRoles) {
      await db.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: perm.id },
        },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  } catch (err) {
    // Police (POLICE-1, risk #4): a transient DB failure must NOT latch the
    // "ensured" flag for the whole process lifetime (that would 403 every
    // vendor AI call until restart). Leave ensured=false so the next
    // request retries the backfill — it's all idempotent upserts.
    console.warn("[vendor-rbac] v_ai permission ensure failed (will retry on next call):", err);
    return;
  }

  ensured = true;
}

/**
 * Server-side gate for /api/vendor/ai: does this vendor actor's role
 * carry v_ai:view? Resolves the role exactly like /api/vendor/session
 * does (HQ staff → VendorUser.roleRel, owner → Vendor.roleRel).
 */
export async function vendorHasAiAccess(
  session: VendorSession
): Promise<boolean> {
  await ensureVendorAiPermission();

  let rolePermissions: { permission: { module: string; action: string } }[] | undefined;

  if (session.isStaff && session.userId) {
    const user = await db.vendorUser.findUnique({
      where: { id: session.userId },
      select: {
        roleRel: {
          select: {
            rolePermissions: {
              select: { permission: { select: { module: true, action: true } } },
            },
          },
        },
      },
    });
    rolePermissions = user?.roleRel?.rolePermissions;
  } else {
    const vendor = await db.vendor.findUnique({
      where: { id: session.vendorId },
      select: {
        roleRel: {
          select: {
            rolePermissions: {
              select: { permission: { select: { module: true, action: true } } },
            },
          },
        },
      },
    });
    rolePermissions = vendor?.roleRel?.rolePermissions;
  }

  return (
    rolePermissions?.some(
      (rp) =>
        rp.permission.module === VENDOR_AI_PERMISSION.module &&
        rp.permission.action === VENDOR_AI_PERMISSION.action
    ) ?? false
  );
}
