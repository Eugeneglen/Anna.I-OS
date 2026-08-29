import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";

// ──────────────────────────────────────────────────────────
// GET /api/ops/permissions/modules — Modules + available actions
// ──────────────────────────────────────────────────────────
export async function GET() {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const permissions = await db.permission.findMany({
      orderBy: [{ module: "asc" }, { action: "asc" }],
    });

    // Group by module
    const modules: Record<string, string[]> = {};
    for (const p of permissions) {
      if (!modules[p.module]) modules[p.module] = [];
      modules[p.module].push(p.action);
    }

    // All possible actions (ordered)
    const allActions = [
      "view", "create", "edit", "delete", "export",
      "approve", "assign", "configure",
    ];

    const result = Object.entries(modules).map(([module, actions]) => ({
      module,
      actions: allActions.filter((a) => actions.includes(a)),
    }));

    return NextResponse.json({ modules: result });
  } catch (error) {
    console.error("[/api/ops/permissions/modules GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
