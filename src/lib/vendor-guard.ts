/**
 * Server-side guard for vendor API routes under /api/vendors/[id]/
 * Prevents Insecure Direct Object Reference (IDOR) by verifying
 * that the authenticated vendor session matches the requested vendorId.
 *
 * Also provides server-side RBAC permission enforcement via
 * requireVendorPermission() — the frontend can() gate is cosmetic only;
 * this is the authoritative check.
 */
import { NextResponse } from "next/server";
import { getVendorSession, type VendorSession } from "@/lib/vendor-auth";
import { db } from "@/lib/db";

export interface VendorOwnershipResult {
  success: true;
  vendorId: string;
}

export interface VendorOwnershipError {
  success: false;
  response: NextResponse;
}

/**
 * Validates that the currently authenticated vendor (from JWT cookie)
 * matches the vendorId supplied in the URL path.
 *
 * Usage:
 *   const auth = await requireVendorOwnership(id);
 *   if (!auth.success) return auth.response;
 *   // auth.vendorId is safe to use
 */
export async function requireVendorOwnership(
  urlVendorId: string
): Promise<VendorOwnershipResult | VendorOwnershipError> {
  const session = await getVendorSession();

  if (!session) {
    return {
      success: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (session.vendorId !== urlVendorId) {
    return {
      success: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { success: true, vendorId: session.vendorId };
}

// ─────────────────────────────────────────────────────────────
// Server-side RBAC permission enforcement
// ─────────────────────────────────────────────────────────────

/**
 * Resolves the full set of permission strings ("module:action") for the
 * authenticated actor. HQ staff (VendorUser) resolve via their roleId;
 * vendor owners resolve via Vendor.roleId. Falls back to an empty array
 * if no role is assigned (deny-by-default).
 */
async function resolvePermissions(session: VendorSession): Promise<string[]> {
  if (session.isStaff && session.userId) {
    const user = await db.vendorUser.findUnique({
      where: { id: session.userId },
      select: {
        roleId: true,
        roleRel: {
          select: {
            rolePermissions: {
              select: { permission: { select: { module: true, action: true } } },
            },
          },
        },
      },
    });
    return (
      user?.roleRel?.rolePermissions.map(
        (rp) => `${rp.permission.module}:${rp.permission.action}`
      ) ?? []
    );
  }

  const vendor = await db.vendor.findUnique({
    where: { id: session.vendorId },
    select: {
      roleId: true,
      roleRel: {
        select: {
          rolePermissions: {
            select: { permission: { select: { module: true, action: true } } },
          },
        },
      },
    },
  });
  return (
    vendor?.roleRel?.rolePermissions.map(
      (rp) => `${rp.permission.module}:${rp.permission.action}`
    ) ?? []
  );
}

export interface VendorPermissionResult extends VendorOwnershipResult {
  session: VendorSession;
  permissions: string[];
}

/**
 * Authoritative server-side RBAC check. Verifies the request is
 * authenticated AND that the actor's role grants the requested
 * (module, action) permission. Call this at the top of every mutating
 * vendor API route — the frontend can() gate is cosmetic and trivially
 * bypassed by a direct API call.
 *
 * Usage:
 *   const auth = await requireVendorPermission("v_users", "create");
 *   if (!auth.success) return auth.response;
 *   // auth.session + auth.vendorId + auth.permissions available
 */
export async function requireVendorPermission(
  module: string,
  action: string
): Promise<VendorPermissionResult | VendorOwnershipError> {
  const session = await getVendorSession();

  if (!session) {
    return {
      success: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const permissions = await resolvePermissions(session);
  const required = `${module}:${action}`;

  // Vendor owners with the super_admin role implicitly have all permissions
  // (super_admin is seeded with every permission, so this is belt-and-braces).
  if (!permissions.includes(required)) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Forbidden — insufficient permissions" },
        { status: 403 }
      ),
    };
  }

  return { success: true, vendorId: session.vendorId, session, permissions };
}

/**
 * Returns a NextResponse with X-Vendor-Id header set.
 * Use this in all vendor API routes so the frontend can detect
 * cookie-overwrite / session-switch issues.
 */
export function vendorJson(
  data: unknown,
  vendorId: string,
  init?: { status?: number; headers?: Record<string, string> }
): NextResponse {
  return new NextResponse(JSON.stringify(data), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      "X-Vendor-Id": vendorId,
      ...(init?.headers ?? {}),
    },
  });
}
