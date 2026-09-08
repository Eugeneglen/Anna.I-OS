import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasMinRole } from "@/lib/ops-auth";
import { requireAiPermission, aiGuardErrorResponse } from "@/lib/ai-guards";
import { decideBrief } from "@/lib/ai-dispute/brief-service";

// ─────────────────────────────────────────────────────────────
// POST /api/ops/ai/cases/[id]/decision — the HUMAN DECISION
// (§5): ACCEPT / REJECT / OVERRIDE.
//
// Guards (§13 security matrix):
//   401 unauthenticated
//   403 without ai:approve, or below COORDINATOR (the SAME
//       execution tier the manual escrow PATCH route demands —
//       the AI route grants no extra money authority)
//
// The decision is recorded BEFORE execution; accept/override
// with a refund-class action then hands control to the ONE
// money path with the refundConfirmed maker-checker enforced
// both here and inside it (§6). Reject requires a reason; so
// do accept and override.
// ─────────────────────────────────────────────────────────────

const decisionSchema = z.object({
  decision: z.enum(["accept", "reject", "override"]),
  reason: z.string().min(1, "A reason is required for every human decision").max(500),
  // Maker-checker mirror (§6): required true for refund-class execution.
  refundConfirmed: z.boolean().optional(),
  // Override: the human's chosen action from the eligible set.
  overrideAction: z
    .enum(["resolve_dismiss", "resolve_refund", "partial_refund", "resolve_voucher", "manual_review"])
    .optional(),
  // Override partial_refund amount (validated against CURRENT bounds).
  refundAmountCents: z.number().int().positive().optional(),
  // Override resolve_voucher amounts (validated against CURRENT bounds).
  voucherAmountCents: z.number().int().positive().optional(),
  voucherRefundAmountCents: z.number().int().nonnegative().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAiPermission("approve");
  if (!guard.ok) {
    return aiGuardErrorResponse(guard);
  }

  // Execution authority mirrors the manual escrow route exactly.
  if (!hasMinRole(guard.session.role, "COORDINATOR")) {
    return NextResponse.json(
      { error: "Insufficient permissions — COORDINATOR tier required for dispute decisions" },
      { status: 403 }
    );
  }

  try {
    const { id } = await params;
    const parsed = decisionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    return await decideBrief(id, guard.session, parsed.data);
  } catch (error) {
    console.error("[/api/ops/ai/cases/[id]/decision POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
