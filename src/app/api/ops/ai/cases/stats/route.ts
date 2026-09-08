import { NextResponse } from "next/server";
import { requireAiPermission, aiGuardErrorResponse } from "@/lib/ai-guards";
import { getCoverageStats } from "@/lib/ai-dispute/brief-service";

// ─────────────────────────────────────────────────────────────
// GET /api/ops/ai/cases/stats — coverage metrics (§8).
//
// Acceptance gate: 100% of qualifying disputes hold an active
// brief. Tracks: total qualifying disputes, briefs generated,
// generation failures (active + historical), retries, expired
// briefs, manual-review fallbacks. Nothing is hidden — FAILED
// rows stay in the queue with their error visible.
// ─────────────────────────────────────────────────────────────

export async function GET() {
  const guard = await requireAiPermission("prepare");
  if (!guard.ok) {
    return aiGuardErrorResponse(guard);
  }

  try {
    const stats = await getCoverageStats();
    return NextResponse.json({ stats });
  } catch (error) {
    console.error("[/api/ops/ai/cases/stats GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
