import { NextRequest, NextResponse } from "next/server";
import { requireAiPermission, aiGuardErrorResponse } from "@/lib/ai-guards";
import { prepareInsight } from "@/lib/ai-insight/insight-service";

// ─────────────────────────────────────────────────────────────
// POST /api/ops/ai/insights/[id]/prepare — the Ops Prepare flow.
//
// A HUMAN clicks Prepare on a recommended action. Outcomes:
//   • navigate actions → server-computed console deep link
//     (catalogue-owned; the LLM never supplies URLs);
//   • prepare_case_brief → stages the Phase-2 AI case brief for
//     this disputed task — a HUMAN still decides through the
//     maker-checker dialog. Nothing executes here;
//   • monitor_only → 400 (nothing to prepare).
//
// Gate: ai:prepare (this is preparation, not a decision).
// ─────────────────────────────────────────────────────────────

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAiPermission("prepare");
  if (!guard.ok) {
    return aiGuardErrorResponse(guard);
  }

  try {
    const { id } = await params;
    return await prepareInsight(id, guard.session);
  } catch (error) {
    console.error("[/api/ops/ai/insights/[id]/prepare POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
