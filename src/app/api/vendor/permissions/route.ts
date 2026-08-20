import { NextResponse } from "next/server";
import { getVendorSession } from "@/lib/vendor-auth";
import { db } from "@/lib/db";

// ═════════════════════════════════════════════════════
// GET /api/vendor/permissions — List vendor permissions (v_ prefixed)
// ═════════════════════════════════════════════════════
export async function GET() {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const permissions = await db.permission.findMany({
      where: { module: { startsWith: "v_" } },
      orderBy: [{ module: "asc" }, { action: "asc" }],
    });

    return NextResponse.json({
      permissions: permissions.map((p) => ({
        id: p.id,
        module: p.module,
        action: p.action,
        description: p.description,
      })),
    });
  } catch (error) {
    console.error("[/api/vendor/permissions GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
