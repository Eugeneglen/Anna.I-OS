import { NextRequest, NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { createSegment, type SegmentFilters } from "@/lib/marketing/segment-engine";

// GET /api/ops/marketing/segments — list all segments
export async function GET() {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const allowed = await hasPermission(session, "marketing", "view");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const segments = await db.segment.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { members: true } } },
    });

    return NextResponse.json({
      segments: segments.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        status: s.status,
        memberCount: s._count.members > 0 ? s._count.members : s.memberCount,
        lastComputedAt: s.lastComputedAt,
        createdAt: s.createdAt,
      })),
    });
  } catch (error) {
    console.error("[/api/ops/marketing/segments GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// POST /api/ops/marketing/segments — create a segment
export async function POST(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const allowed = await hasPermission(session, "marketing", "create");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const { name, description, filters } = body;

    if (!name || !filters) {
      return NextResponse.json({ error: "Name and filters are required" }, { status: 400 });
    }

    const segment = await createSegment({
      name,
      description,
      filters: filters as SegmentFilters,
      createdById: session.userId,
      createdByName: session.name,
    });

    return NextResponse.json({ segment }, { status: 201 });
  } catch (error) {
    console.error("[/api/ops/marketing/segments POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
