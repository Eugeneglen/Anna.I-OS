import { NextRequest, NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { generateInsights } from "@/lib/marketing/insight-engine";

// GET /api/ops/marketing/insights — AI-generated marketing recommendations
export async function GET(_req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const allowed = await hasPermission(session, "marketing", "view");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const insights = await generateInsights();

    return NextResponse.json({ insights });
  } catch (error) {
    console.error("[/api/ops/marketing/insights GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
