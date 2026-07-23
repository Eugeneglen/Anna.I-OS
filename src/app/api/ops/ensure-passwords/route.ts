/**
 * /api/ops/ensure-passwords
 * 
 * Manual backfill endpoint — sets passwordHash on any FamilyMember or Vendor
 * rows that have NULL (happens after schema push adds new columns).
 * 
 * Safe & idempotent: only touches NULL rows, never overwrites existing passwords.
 * 
 * Usage: GET /api/ops/ensure-passwords
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as bcrypt from "bcryptjs";

const MEMBER_DEFAULT_PWD = "household123";
const VENDOR_DEFAULT_PWD = "vendor123";

export async function GET() {
  try {
    // ── FamilyMember backfill ──
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

    // ── Vendor backfill ──
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

    // ── OpsUser backfill (belt-and-suspenders) ──
    const opsMissing = await db.opsUser.count({ where: { passwordHash: null } });
    let opsUpdated = 0;
    if (opsMissing > 0) {
      const opsHash = bcrypt.hashSync("admin123", 10);
      const res = await db.opsUser.updateMany({
        where: { passwordHash: null },
        data: { passwordHash: opsHash },
      });
      opsUpdated = res.count;
    }

    return NextResponse.json({
      success: true,
      backfilled: {
        familyMembers: { missing: membersMissing, updated: membersUpdated },
        vendors: { missing: vendorsMissing, updated: vendorsUpdated },
        opsUsers: { missing: opsMissing, updated: opsUpdated },
      },
      message:
        membersUpdated === 0 && vendorsUpdated === 0 && opsUpdated === 0
          ? "All passwords already set — no action needed."
          : `Backfilled ${membersUpdated} member(s), ${vendorsUpdated} vendor(s), ${opsUpdated} ops user(s).`,
    });
  } catch (error) {
    console.error("[/api/ops/ensure-passwords]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
