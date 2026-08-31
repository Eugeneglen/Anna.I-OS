import { NextRequest, NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { previewSegmentMembers, type SegmentFilters } from "@/lib/marketing/segment-engine";
import {
  segmentFiltersSchema,
  sanitizeSegmentFilters,
  type SegmentFiltersInput,
} from "@/lib/marketing/schemas";
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
    // ── F4: legacy junk tolerance — if the strict schema rejects (e.g. a
    // pre-F8 stored segment replayed through preview), sanitize instead of
    // 400ing: keep the keys that individually validate, drop the rest with
    // warnings. New segments still cannot persist junk (create stays strict).
    const parsedFilters = segmentFiltersSchema.safeParse(filters);
    let effectiveFilters: SegmentFiltersInput;
    let warnings: string[] = [];
    if (parsedFilters.success) {
      effectiveFilters = parsedFilters.data;
    } else {
      const sanitized = sanitizeSegmentFilters(filters);
      effectiveFilters = sanitized.filters;
      warnings = sanitized.warnings;
      console.warn(
        "[/api/ops/marketing/segments/preview] legacy/malformed filters normalized:",
        warnings
      );
    }

    const result = await previewSegmentMembers(effectiveFilters as SegmentFilters);
    return NextResponse.json(warnings.length > 0 ? { ...result, warnings } : result);
  } catch (error) {
    console.error("[/api/ops/marketing/segments/preview POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
