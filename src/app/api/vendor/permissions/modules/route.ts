import { NextResponse } from "next/server";
import { getVendorSession } from "@/lib/vendor-auth";
import { db } from "@/lib/db";

// ═════════════════════════════════════════════════════
// GET /api/vendor/permissions/modules — Vendor module list
// ═════════════════════════════════════════════════════
export async function GET() {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const permissions = await db.permission.findMany({
      where: {
        OR: [
          { module: { startsWith: "v_" } },
          { module: "vendors" },
        ],
      },
      orderBy: [{ module: "asc" }, { action: "asc" }],
    });

    // Group by module
    const moduleMap = new Map<string, string[]>();
    for (const p of permissions) {
      const actions = moduleMap.get(p.module) || [];
      actions.push(p.action);
      moduleMap.set(p.module, actions);
    }

    const modules = Array.from(moduleMap.entries()).map(([module, actions]) => ({
      module,
      actions,
    }));

    return NextResponse.json({ modules });
  } catch (error) {
    console.error("[/api/vendor/permissions/modules GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
