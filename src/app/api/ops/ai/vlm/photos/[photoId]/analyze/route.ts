import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAiPermission, aiGuardErrorResponse } from "@/lib/ai-guards";
import { analyzeVerificationPhoto } from "@/lib/vlm-analysis";

// ─────────────────────────────────────────────────────────────
// POST /api/ops/ai/vlm/photos/[photoId]/analyze — run (or re-run)
// the persisted VLM analysis for ONE verification photo (ai:prepare).
//
// DECISION SUPPORT ONLY: the verdict is persisted for humans to
// read; it can never release escrow, verify the photo, or move
// money. Idempotent unless forced.
// ─────────────────────────────────────────────────────────────

const analyzeSchema = z.object({
  force: z.boolean().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ photoId: string }> }
) {
  const guard = await requireAiPermission("prepare");
  if (!guard.ok) {
    return aiGuardErrorResponse(guard);
  }

  try {
    const { photoId } = await params;
    let force = false;
    try {
      const parsed = analyzeSchema.safeParse(await request.json());
      if (parsed.success) force = parsed.data.force ?? false;
    } catch {
      // Empty body is fine — force defaults to false.
    }

    const result = await analyzeVerificationPhoto(photoId, {
      trigger: "manual",
      force,
    });

    if (result.status === "not_found") {
      return NextResponse.json({ error: "Verification photo not found" }, { status: 404 });
    }

    const verdict = result.photoVerificationId
      ? await db.photoVerification.findUnique({
          where: { id: result.photoVerificationId },
        })
      : null;

    return NextResponse.json({ result, verdict });
  } catch (error) {
    console.error("[/api/ops/ai/vlm/photos/[photoId]/analyze POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
