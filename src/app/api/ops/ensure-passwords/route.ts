/**
 * /api/ops/ensure-passwords
 *
 * Manual backfill endpoint — sets passwordHash on any FamilyMember, Vendor,
 * or OpsUser rows that have NULL (happens after schema push adds new columns).
 *
 * SECURITY: This endpoint sets known default passwords on accounts with null
 * hashes. It MUST be gated behind an authenticated super_admin session —
 * otherwise an attacker who triggers a null-hash condition could set known
 * passwords on arbitrary accounts and log in.
 *
 * Usage: GET /api/ops/ensure-passwords (requires super_admin session)
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as bcrypt from "bcryptjs";
import { getOpsSession } from "@/lib/ops-auth";

const MEMBER_DEFAULT_PWD = "household123";
const VENDOR_DEFAULT_PWD = "vendor123";

export async function GET() {
  try {
    // ── Auth + RBAC: only super_admin may backfill passwords ──
    // This sets known default passwords on accounts — too dangerous for
    // any role below super_admin, even operations (which has users:create).
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let isSuperAdmin = false;
    if (session.roleId) {
      const reqRole = await db.role.findUnique({ where: { id: session.roleId } });
      isSuperAdmin = reqRole?.slug === "super_admin";
    } else {
      // Legacy fallback (pre-RBAC OpsUser)
      isSuperAdmin = session.role === "ADMIN";
    }
    if (!isSuperAdmin) {
      return NextResponse.json(
        { error: "Forbidden — super_admin role required" },
        { status: 403 }
      );
    }

    // ── FamilyMember backfill (passwordHash is nullable: String?) ──
    const membersMissing = await db.familyMember.count({ where: { passwordHash: null } });
    let membersUpdated = 0;
    if (membersMissing > 0) {
      const memberHash = bcrypt.hashSync(MEMBER_DEFAULT_PWD, 10);
      const res = await db.familyMember.updateMany({
        where: { passwordHash: null },
        data: { passwordHash: memberHash },
      });
      membersUpdated = res.count;
    }

    // ── Vendor backfill (passwordHash is nullable: String?) ──
    const vendorsMissing = await db.vendor.count({ where: { passwordHash: null } });
    let vendorsUpdated = 0;
    if (vendorsMissing > 0) {
      const vendorHash = bcrypt.hashSync(VENDOR_DEFAULT_PWD, 10);
      const res = await db.vendor.updateMany({
        where: { passwordHash: null },
        data: { passwordHash: vendorHash },
      });
      vendorsUpdated = res.count;
    }

    // NOTE: OpsUser.passwordHash is a non-nullable String (required at the
    // schema level), so there can never be a null-hash OpsUser row to
    // backfill. The previous OpsUser backfill block caused a Prisma 6
    // validation error ("passwordHash must not be null") and has been removed.
    // Ops user provisioning is handled by /api/ops/ensure-users.

    return NextResponse.json({
      success: true,
      backfilled: {
        familyMembers: { missing: membersMissing, updated: membersUpdated },
        vendors: { missing: vendorsMissing, updated: vendorsUpdated },
      },
      message:
        membersUpdated === 0 && vendorsUpdated === 0
          ? "All passwords already set — no action needed."
          : `Backfilled ${membersUpdated} member(s), ${vendorsUpdated} vendor(s).`,
    });
  } catch (error) {
    console.error("[/api/ops/ensure-passwords]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
