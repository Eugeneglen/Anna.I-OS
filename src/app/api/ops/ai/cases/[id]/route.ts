import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAiPermission, aiGuardErrorResponse } from "@/lib/ai-guards";

// ─────────────────────────────────────────────────────────────
// GET /api/ops/ai/cases/[id] — full brief detail (ai:prepare).
// Includes the contextSnapshot (deterministic case + policy)
// and the complete audit chain rows for the brief's aiChainId —
// the DB-level reconstruction of the full story (§7).
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
    const brief = await db.aiCaseBrief.findUnique({
      where: { id },
      include: {
        household: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
    if (!brief) {
      return NextResponse.json({ error: "AI case brief not found" }, { status: 404 });
    }

    // Reconstruct the audit chain (same query shape documented in
    // src/lib/ai-audit.ts, executed server-side).
    let chain: unknown[] = [];
    if (brief.aiChainId) {
      const rows = await db.$queryRawUnsafe(
        `SELECT id, userName, action, entityType, entityId, metadata, createdAt
         FROM AuditLog
         WHERE json_extract(metadata, '$.ai') = 1
           AND json_extract(metadata, '$.aiChainId') = ?
         ORDER BY createdAt ASC`,
        brief.aiChainId
      );
      chain = rows as unknown[];
    }

    return NextResponse.json({ brief, chain });
  } catch (error) {
    console.error("[/api/ops/ai/cases/[id] GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
