import { NextRequest, NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { previewSegmentMembers, type SegmentFilters } from "@/lib/marketing/segment-engine";

// POST /api/ops/marketing/segments/preview — preview member count
export async function POST(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const allowed = await hasPermission(session, "marketing", "view");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const { filters } = body;

    if (!filters) {
      return NextResponse.json({ error: "Filters are required" }, { status: 400 });
    }

    const result = await previewSegmentMembers(filters as SegmentFilters);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[/api/ops/marketing/segments/preview POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
