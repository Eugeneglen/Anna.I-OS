import { NextRequest, NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { previewSegmentMembers, type SegmentFilters } from "@/lib/marketing/segment-engine";
import { segmentFiltersSchema } from "@/lib/marketing/schemas";
import {
  checkRateLimit,
  opsRateKey,
  rateLimitResponsePayload,
} from "@/lib/rate-limit";

// POST /api/ops/marketing/segments/preview — preview member count
export async function POST(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const allowed = await hasPermission(session, "marketing", "view");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // ── F8: preview is the most expensive read (full behaviour recompute) —
    // rate-limit 10/min per ops user.
    const rlKey = opsRateKey(session.userId, "segment-preview");
    if (!checkRateLimit(rlKey, 10, 60_000)) {
      return NextResponse.json(rateLimitResponsePayload(rlKey), { status: 429 });
    }

    const body = await req.json();
    const { filters } = body;

    if (!filters) {
      return NextResponse.json({ error: "Filters are required" }, { status: 400 });
    }

    // ── F8: same schema as create — preview and compute cannot diverge.
    const parsedFilters = segmentFiltersSchema.safeParse(filters);
    if (!parsedFilters.success) {
      return NextResponse.json(
        { error: "Invalid segment filters", details: parsedFilters.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const result = await previewSegmentMembers(parsedFilters.data as SegmentFilters);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[/api/ops/marketing/segments/preview POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
