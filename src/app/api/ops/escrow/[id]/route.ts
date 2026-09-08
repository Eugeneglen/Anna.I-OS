import { NextRequest, NextResponse } from "next/server";
import { getOpsSession, hasMinRole } from "@/lib/ops-auth";
import { escrowActionSchema, executeEscrowAction } from "@/lib/escrow/execute-action";

// ─────────────────────────────────────────────────────────────
// PATCH /api/ops/escrow/[id] — manual ops entry point.
//
// Phase 2: the action logic (maker-checker gate, state guards,
// refunds, notifications, events) moved VERBATIM to
// src/lib/escrow/execute-action.ts so the AI-assisted decision
// route executes through the SAME money path. This route keeps
// its original auth contract:
//   401 unauthenticated · 403 below COORDINATOR · 400 bad body
//   409 unconfirmed refund-class actions (maker-checker, §6)
// ─────────────────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only ADMIN and COORDINATOR can manage escrow
    if (!hasMinRole(session.role, "COORDINATOR")) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const parsed = escrowActionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    return await executeEscrowAction(session, id, parsed.data);
  } catch (error) {
    console.error("[/api/ops/escrow/[id] PATCH]", error);
    return NextResponse.json(
      { error: "Failed to process escrow action" },
      { status: 500 }
    );
  }
}
