import { NextRequest, NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import { logAction } from "@/lib/audit-log";
import { computeSegmentMembers, archiveSegment, unarchiveSegment } from "@/lib/marketing/segment-engine";

// GET /api/ops/marketing/segments/[id] — segment details + paginated members
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const allowed = await hasPermission(session, "marketing", "view");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const segment = await db.segment.findUnique({ where: { id } });
    if (!segment) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const members = await db.segmentMember.findMany({
      where: { segmentId: id },
      include: { household: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: "desc" },
      take: 100,
    });

    return NextResponse.json({
      segment: {
        id: segment.id,
        name: segment.name,
        description: segment.description,
        status: segment.status,
        filters: segment.filters,
        memberCount: segment.memberCount,
        lastComputedAt: segment.lastComputedAt,
      },
      members: members.map((m) => ({
        householdId: m.household.id,
        householdName: m.household.name,
        email: m.household.email,
        reason: m.reason,
        joinedAt: m.joinedAt,
      })),
    });
  } catch (error) {
    console.error("[/api/ops/marketing/segments/[id] GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// PATCH /api/ops/marketing/segments/[id] — recompute members
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const allowed = await hasPermission(session, "marketing", "edit");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await req.json();
    const action = body.action;

    if (action === "recompute") {
      const result = await computeSegmentMembers(id);
      // ── P6 (AUDIT-3): audit row for segment membership recompute ──
      const seg = await db.segment.findUnique({
        where: { id },
        select: { name: true },
      });
      await logAction({
        userId: session.userId,
        userName: session.name,
        action: "segment.recompute",
        entityType: "Segment",
        entityId: id,
        metadata: {
          name: seg?.name ?? null,
          total: result.total,
          added: result.added,
          removed: result.removed,
        },
      });
      return NextResponse.json(result);
    }

    if (action === "archive") {
      await archiveSegment(id);
      // ── P6 (AUDIT-3): audit row for segment archive ──
      const seg = await db.segment.findUnique({
        where: { id },
        select: { name: true },
      });
      await logAction({
        userId: session.userId,
        userName: session.name,
        action: "segment.archive",
        entityType: "Segment",
        entityId: id,
        metadata: { name: seg?.name ?? null, via: "PATCH" },
      });
      return NextResponse.json({ success: true });
    }

    // Phase 2 Fix 12 — reactivate an ARCHIVED segment back to ACTIVE,
    // recomputing members so it is immediately usable.
    if (action === "unarchive") {
      // Guard: only ARCHIVED segments can be reactivated.
      const seg = await db.segment.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!seg) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (seg.status !== "ARCHIVED") {
        return NextResponse.json(
          { error: "Segment is not archived" },
          { status: 400 },
        );
      }
      const result = await unarchiveSegment(id);
      // ── P6 (AUDIT-3): audit row for segment reactivation ──
      await logAction({
        userId: session.userId,
        userName: session.name,
        action: "segment.unarchive",
        entityType: "Segment",
        entityId: id,
        metadata: {
          total: result.total,
          added: result.added,
          removed: result.removed,
        },
      });
      return NextResponse.json({
        success: true,
        total: result.total,
        added: result.added,
        removed: result.removed,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[/api/ops/marketing/segments/[id] PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// DELETE /api/ops/marketing/segments/[id] — archive
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const allowed = await hasPermission(session, "marketing", "delete");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    await archiveSegment(id);
    // ── P6 (AUDIT-3): audit row for segment archive via DELETE ──
    // (DELETE archives rather than hard-deleting — membership history is
    // retained; the audit row records which ops user triggered it and how.)
    const seg = await db.segment.findUnique({
      where: { id },
      select: { name: true },
    });
    await logAction({
      userId: session.userId,
      userName: session.name,
      action: "segment.archive",
      entityType: "Segment",
      entityId: id,
      metadata: { name: seg?.name ?? null, via: "DELETE" },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/ops/marketing/segments/[id] DELETE]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
