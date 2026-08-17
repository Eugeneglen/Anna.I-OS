import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";

// ──────────────────────────────────────────────────────────
// GET /api/ops/permissions — List all permissions
// ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const moduleFilter = searchParams.get("module") || undefined;

    const where: Record<string, unknown> = {};
    if (moduleFilter) {
      where.module = moduleFilter;
    }

    const permissions = await db.permission.findMany({
      where,
      orderBy: [{ module: "asc" }, { action: "asc" }],
    });

    return NextResponse.json({ permissions });
  } catch (error) {
    console.error("[/api/ops/permissions GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
