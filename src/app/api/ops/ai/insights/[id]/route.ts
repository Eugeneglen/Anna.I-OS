import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAiPermission, aiGuardErrorResponse } from "@/lib/ai-guards";

// ─────────────────────────────────────────────────────────────
// GET /api/ops/ai/insights/[id] — insight detail + full audit
// chain reconstruction by aiChainId (mirrors /api/ops/ai/cases/[id]).
// ─────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAiPermission("prepare");
  if (!guard.ok) {
    return aiGuardErrorResponse(guard);
  }

  try {
    const { id } = await params;
    const insight = await db.aiInsight.findUnique({
      where: { id },
      include: {
        household: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
    if (!insight) {
      return NextResponse.json({ error: "Insight not found" }, { status: 404 });
    }

    let chain: unknown[] = [];
    if (insight.aiChainId) {
      // Same query shape as /api/ops/ai/cases/[id] (documented in
      // src/lib/ai-audit.ts, executed server-side).
      const rows = await db.$queryRawUnsafe(
        `SELECT id, userName, action, entityType, entityId, metadata, createdAt
         FROM AuditLog
         WHERE json_extract(metadata, '$.ai') = 1
           AND json_extract(metadata, '$.aiChainId') = ?
         ORDER BY createdAt ASC`,
        insight.aiChainId
      );
      chain = rows as unknown[];
    }

    return NextResponse.json({ insight, chain });
  } catch (error) {
    console.error("[/api/ops/ai/insights/[id] GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
