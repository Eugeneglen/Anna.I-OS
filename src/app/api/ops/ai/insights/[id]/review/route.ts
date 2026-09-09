import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAiPermission, aiGuardErrorResponse } from "@/lib/ai-guards";
import { reviewInsight } from "@/lib/ai-insight/insight-service";

// ─────────────────────────────────────────────────────────────
// POST /api/ops/ai/insights/[id]/review — the HUMAN review act
// (ai:approve — the same permission that records human decisions
// on AI case briefs). ACKNOWLEDGED / DISMISSED with an optional
// reason; the decision is recorded, never executed.
// ─────────────────────────────────────────────────────────────

const reviewSchema = z.object({
  status: z.enum(["ACKNOWLEDGED", "DISMISSED"]),
  note: z.string().max(500).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAiPermission("approve");
  if (!guard.ok) {
    return aiGuardErrorResponse(guard);
  }

  try {
    const { id } = await params;
    const parsed = reviewSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    return await reviewInsight(id, guard.session, parsed.data);
  } catch (error) {
    console.error("[/api/ops/ai/insights/[id]/review POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
