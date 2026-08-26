import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireVendorPermission } from "@/lib/vendor-guard";

// GET /api/vendor/users/[id]/audit-log — returns audit entries for a specific vendor user
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireVendorPermission("v_users", "view");
    if (!auth.success) return auth.response;

    const { id } = await params;

    // Get audit entries where:
    // - this vendor user was the entity (entityType = "VendorUser" AND entityId = id), AND
    // - the entry belongs to this vendor (vendorId = auth.vendorId)
    const entries = await db.auditLog.findMany({
      where: {
        vendorId: auth.vendorId,
        OR: [
          { entityType: "VendorUser", entityId: id },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({ entries });
  } catch (error) {
    console.error("[/api/vendor/users/[id]/audit-log GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
