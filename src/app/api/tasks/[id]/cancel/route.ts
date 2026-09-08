import { NextResponse } from "next/server";
import { z } from "zod";
import { guardTaskAccess, guardErrorResponse } from "@/lib/api-guards";
import { cancelTask } from "@/lib/task-cancel-service";

// ── F18 (C6 / policy R3): household-initiated task cancellation ──
//
// AI Wave 2-A (A-4): the cancellation core (terminal CANCELLED state,
// HELD → REFUNDED escrow math, REFUND_CREDIT issuance, voucher restore,
// notifications, events, audit) now lives in src/lib/task-cancel-service.ts
// so that BOTH this route AND the Ask Anna cancel_task tool run the exact
// same money path. This file keeps only auth + input validation +
// response mapping — the transaction logic itself is unchanged.
//
// Refund window: ANY pre-completion status. COMPLETED/VERIFIED/
// ESCROW_RELEASED must go through the dispute flow instead (money has
// either been earned or released); DISPUTED must be resolved first.
//
// Two-way refund split (REFUND-SPLIT-1): the cancel money path in
// task-cancel-service.ts books BOTH legs of every refund event — the
// household cash leg (→ REFUND_CREDIT) and the platform promo leg
// (→ restored voucher, subsidyReversedCents) — and writes the Refund
// trail rows inside the terminal transaction.

const cancelSchema = z.object({
  reason: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // ── F21 auth gate: owning household or ops only ──
    // ── F9 (police-2b f13): cancel is a money action (HELD → REFUNDED +
    // REFUND_CREDIT issuance) — ops actors must be COORDINATOR+ (mirrors
    // the console's escrow money-action tier in /api/ops/escrow/[id]).
    const guard = await guardTaskAccess(id, { opsMinRole: "COORDINATOR" });
    if (!guard.ok) return guardErrorResponse(guard);
    const actor = guard.actor;

    // ── P8 (AUDIT-4): household role differentiation — cancel triggers the
    // refund pipeline (HELD → REFUNDED + REFUND_CREDIT), so within the
    // household it is restricted to the OWNER. MEMBERs previously had
    // identical authority to the OWNER on every action (roles cosmetic).
    // Ops actors are unaffected (COORDINATOR+ tier above). ──
    if (actor.kind === "household" && actor.memberRole !== "OWNER") {
      return NextResponse.json(
        { error: "Only the household owner can cancel a task. Please ask the owner to do this." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = cancelSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const outcome = await cancelTask({
      taskId: id,
      reason: parsed.data.reason,
      actor:
        actor.kind === "ops"
          ? { kind: "ops", userId: actor.userId, name: actor.session.name }
          : { kind: "household", householdId: actor.householdId },
    });

    if (!outcome.ok) {
      return NextResponse.json(
        { error: outcome.error, code: outcome.code },
        { status: outcome.status as 400 | 401 | 403 | 404 | 409 }
      );
    }

    const d = outcome.data;
    return NextResponse.json({
      task: d.task,
      refundedCents: d.refundedCents,
      // Two-way refund split (this cancellation): the household cash leg is
      // delivered as REFUND_CREDIT (`credit` above); the platform promo leg
      // is delivered as the restored original voucher (`voucherRestored`).
      platformDiscountReversedCents: d.platformDiscountReversedCents,
      refundRowsWritten: d.refundRowsWritten,
      credit: d.credit,
      creditPending: d.creditPending, // true = refund landed but credit issuance failed; recover via backfill mode-2
      voucherRestored: d.voucherRestored,
      cancelledBookings: d.cancelledBookings,
      zeroCashTerminalized: d.zeroCashTerminalized,
    });
  } catch (error) {
    console.error("POST /api/tasks/[id]/cancel error:", error);
    return NextResponse.json(
      { error: "Failed to cancel task" },
      { status: 500 }
    );
  }
}
