import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOpsSession, hasMinRole } from "@/lib/ops-auth";
import {
  suspendCompensationVoucher,
  reactivateCompensationVoucher,
  removeCompensationVoucher,
} from "@/lib/marketing/service-recovery";
import { RefundError } from "@/lib/payments/refund-service";

const voucherActionSchema = z.object({
  action: z.enum(["suspend", "reactivate", "remove"]),
  reason: z.string().min(1).max(500),
});

// PATCH /api/ops/escrow/vouchers/[voucherId]
// Suspend / reactivate / permanently remove a compensation voucher.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ voucherId: string }> }
) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasMinRole(session.role, "COORDINATOR")) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { voucherId } = await params;
    const body = await request.json();
    const parsed = voucherActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    try {
      if (parsed.data.action === "suspend") {
        await suspendCompensationVoucher(voucherId, parsed.data.reason);
      } else if (parsed.data.action === "reactivate") {
        await reactivateCompensationVoucher(voucherId);
      } else if (parsed.data.action === "remove") {
        await removeCompensationVoucher(voucherId, parsed.data.reason);
      }
      return NextResponse.json({ ok: true, action: parsed.data.action });
    } catch (e) {
      if (e instanceof RefundError) {
        return NextResponse.json(
          { error: e.message, code: e.code },
          { status: e.statusCode }
        );
      }
      throw e;
    }
  } catch (error) {
    console.error("[/api/ops/escrow/vouchers/[voucherId] PATCH]", error);
    return NextResponse.json(
      { error: "Failed to update compensation voucher" },
      { status: 500 }
    );
  }
}
