/**
 * F18 backfill: orphaned HELD escrow on CANCELLED tasks (audit C6/N4).
 *
 * Before the cancel route existed, tasks could reach CANCELLED with their
 * escrow entries stuck HELD forever (no refund path). This script converts
 * those entries to REFUNDED and issues the owed REFUND_CREDIT voucher per
 * policy R3 — the same math the /api/tasks/[id]/cancel route applies.
 *
 * Idempotent: re-running is a no-op (HELD filter + deterministic credit
 * idempotency key `cancel-credit-<taskId>` + restore's marker semantics).
 *
 * Usage: bunx tsx scripts/ops/backfill-cancelled-escrow.ts [--dry]
 */
import { db } from "../../src/lib/db";
import { TaskStatus, EscrowState } from "@prisma/client";
import { calculateRefundImpact } from "../../src/lib/payments/calculations";

async function main() {
  const dry = process.argv.includes("--dry");

  // Orphans: CANCELLED task + escrow entry still HELD with money remaining
  const orphanTasks = await db.task.findMany({
    where: {
      status: TaskStatus.CANCELLED,
      escrowEntries: { some: { state: EscrowState.HELD } },
    },
    select: {
      id: true,
      jobNo: true,
      category: true,
      householdId: true,
      discountCodeId: true,
      escrowEntries: {
        where: { state: EscrowState.HELD },
        select: {
          id: true,
          amountCents: true,
          refundCents: true,
          commissionRate: true,
        },
      },
    },
  });

  if (orphanTasks.length === 0) {
    console.log("[backfill] no orphaned HELD escrow on CANCELLED tasks — nothing to do");
    return;
  }

  const { issueRefundCreditVoucher } = await import("../../src/lib/marketing/refund-credit");
  const { restoreVoucherOnCancellation } = await import("../../src/lib/marketing/voucher-engine");

  for (const task of orphanTasks) {
    const refunded: { id: string; amountCents: number }[] = [];
    for (const entry of task.escrowEntries) {
      const remaining = entry.amountCents - entry.refundCents;
      if (remaining <= 0) continue;
      const calc = calculateRefundImpact({
        amountCents: entry.amountCents,
        existingRefundCents: entry.refundCents,
        refundAmountCents: remaining,
        commissionRate: entry.commissionRate,
      });
      console.log(
        `[backfill] ${dry ? "[dry] " : ""}${task.jobNo ?? task.id}: entry ${entry.id} HELD $${(remaining / 100).toFixed(2)} -> REFUNDED (credit)`
      );
      if (dry) {
        refunded.push({ id: entry.id, amountCents: remaining });
        continue;
      }
      const claimed = await db.escrowLedger.updateMany({
        where: { id: entry.id, state: EscrowState.HELD },
        data: {
          refundCents: calc.newRefundCents,
          commissionCents: calc.newCommissionCents,
          vendorPayoutCents: calc.newVendorPayoutCents,
          state: EscrowState.REFUNDED,
          refundedAt: new Date(),
          disputeResolution: "Backfill: task cancelled pre-F18 — refunded as Anna.I credit (policy R3)",
          disputeResolvedBy: "system backfill",
          disputeResolvedAt: new Date(),
        },
      });
      if (claimed.count > 0) refunded.push({ id: entry.id, amountCents: remaining });
    }

    const total = refunded.reduce((s, e) => s + e.amountCents, 0);
    if (dry || total === 0) continue;

    const credit = await issueRefundCreditVoucher({
      householdId: task.householdId,
      taskId: task.id,
      creditAmountCents: total,
      reason: "Backfill: escrow orphaned by pre-F18 cancellation",
      idempotencyKey: `cancel-credit-${task.id}`,
      escrowLedgerId: refunded[0]?.id,
      escrowEntries: refunded,
      issuedById: undefined,
      issuedByName: undefined,
    });
    console.log(`[backfill] ${task.jobNo ?? task.id}: credit $${(total / 100).toFixed(2)} -> voucher ${credit.code}${credit.isDuplicate ? " (existing — idempotent)" : ""}`);

    if (task.discountCodeId) {
      const restore = await restoreVoucherOnCancellation(task.id);
      console.log(`[backfill] ${task.jobNo ?? task.id}: voucher restore -> ${JSON.stringify(restore)}`);
    }
  }
  console.log("[backfill] done");
}

main()
  .catch((e) => {
    console.error("[backfill] FAILED:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
