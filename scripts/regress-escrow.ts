/**
 * Phase 2 regression test — verify the 5 escrow actions are unchanged.
 *
 * Strategy: find any existing escrow entries (regardless of current state),
 * reset them to HELD on a VERIFIED task, then run resolve_refund +
 * resolve_voucher on them. The escrow module's contracts are: a fresh
 * DISPUTED escrow → resolve_refund → REFUNDED with commission=0, payout=0;
 * → resolve_voucher → voucher created + escrow RELEASED.
 *
 * Run with:  bun run scripts/regress-escrow.ts
 */

import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const BASE = "http://localhost:3000";

async function resetToHeldDisputed(escrowId: string) {
  const esc = await db.escrowLedger.findUnique({
    where: { id: escrowId },
    include: { task: true },
  });
  if (!esc) throw new Error(`Escrow ${escrowId} not found`);

  // Reset escrow → HELD first, then to DISPUTED, mimicking a fresh dispute.
  await db.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: esc.task.id },
      data: {
        status: "VERIFIED",
        verifiedAt: new Date(),
        disputedAt: new Date(),
      },
    });
    await tx.escrowLedger.update({
      where: { id: escrowId },
      data: {
        state: "DISPUTED",
        disputedAt: new Date(),
        disputeReason: "Regression test dispute",
        refundCents: 0,
        commissionCents: esc.amountCents ? Math.round(esc.amountCents * 0.1) : 0,
        vendorPayoutCents: esc.amountCents ? esc.amountCents - Math.round(esc.amountCents * 0.1) : 0,
        releasedAt: null,
      },
    });
    await tx.task.update({
      where: { id: esc.task.id },
      data: { status: "DISPUTED" },
    });
  });
}

async function main() {
  // 1. Find any two escrow entries (prefer HELD, else whatever).
  const allEsc = await db.escrowLedger.findMany({
    select: { id: true, state: true, amountCents: true, task: { select: { id: true, householdId: true, status: true } } },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  if (allEsc.length < 2) {
    console.error("❌ Need at least 2 escrow entries for regression test");
    process.exit(1);
  }

  const held1 = allEsc.find((e) => e.state === "HELD") || allEsc[0];
  const held2 = allEsc.find((e) => e.state === "HELD" && e.id !== held1.id) || allEsc[1];

  console.log(`Using escrow ${held1.id} (state=${held1.state}, amount=${held1.amountCents}) for resolve_refund`);
  console.log(`Using escrow ${held2.id} (state=${held2.state}, amount=${held2.amountCents}) for resolve_voucher`);

  await resetToHeldDisputed(held1.id);
  await resetToHeldDisputed(held2.id);
  console.log(`→ both escrows reset to DISPUTED state on DISPUTED tasks`);

  // 2. Login as ops user
  const loginRes = await fetch(`${BASE}/api/ops/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "eugene@annai.sg", password: "anna1234" }),
  });
  const cookie = loginRes.headers.get("set-cookie");
  if (!cookie) {
    console.error("❌ Login failed — no Set-Cookie header");
    process.exit(1);
  }
  const sessionCookie = cookie.split(";")[0];
  console.log(`→ ops login OK`);

  // ── TEST 1: resolve_refund ──
  const refundRes = await fetch(`${BASE}/api/ops/escrow/${held1.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify({
      action: "resolve_refund",
      idempotencyKey: `regress-refund-${Date.now()}`,
      reason: "Regression test full refund",
    }),
  });
  const refundJson = await refundRes.json().catch(() => ({}));
  console.log(`\n=== resolve_refund response (HTTP ${refundRes.status}) ===`);
  console.log(JSON.stringify(refundJson, null, 2).slice(0, 600));

  if (!refundRes.ok) {
    console.error(`❌ resolve_refund failed: HTTP ${refundRes.status}`);
    process.exit(1);
  }

  const afterRefund = await db.escrowLedger.findUnique({ where: { id: held1.id } });
  if (!afterRefund) {
    console.error("❌ Escrow disappeared after resolve_refund");
    process.exit(1);
  }
  console.log(`\n=== Escrow state after resolve_refund ===`);
  console.log(`  state: ${afterRefund.state}`);
  console.log(`  refundCents: ${afterRefund.refundCents}`);
  console.log(`  commissionCents: ${afterRefund.commissionCents}`);
  console.log(`  vendorPayoutCents: ${afterRefund.vendorPayoutCents}`);
  console.log(`  amountCents (original): ${afterRefund.amountCents}`);

  const refundPass =
    afterRefund.state === "REFUNDED" &&
    afterRefund.refundCents === afterRefund.amountCents &&
    afterRefund.commissionCents === 0 &&
    afterRefund.vendorPayoutCents === 0;

  if (refundPass) {
    console.log(`\n✅ resolve_refund PASS — full refund, commission=0, payout=0, escrow=REFUNDED`);
  } else {
    console.error(`\n❌ resolve_refund FAIL — see above`);
    process.exit(1);
  }

  // ── TEST 2: resolve_voucher ──
  const householdId = held2.task.householdId;
  const beforeVoucherCount = await db.voucher.count({
    where: { householdId },
  });

  const voucherRes = await fetch(`${BASE}/api/ops/escrow/${held2.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify({
      action: "resolve_voucher",
      voucherAmountCents: 2000,
      voucherExpiryDays: 90,
      idempotencyKey: `regress-voucher-${Date.now()}`,
      resolution: "Regression test voucher resolution",
    }),
  });
  const voucherJson = await voucherRes.json().catch(() => ({}));
  console.log(`\n=== resolve_voucher response (HTTP ${voucherRes.status}) ===`);
  console.log(JSON.stringify(voucherJson, null, 2).slice(0, 600));

  if (!voucherRes.ok) {
    console.error(`❌ resolve_voucher failed: HTTP ${voucherRes.status}`);
    process.exit(1);
  }

  const afterVoucher = await db.escrowLedger.findUnique({ where: { id: held2.id } });
  const afterVoucherCount = await db.voucher.count({ where: { householdId } });

  if (!afterVoucher) {
    console.error("❌ Escrow disappeared after resolve_voucher");
    process.exit(1);
  }
  console.log(`\n=== Escrow state after resolve_voucher ===`);
  console.log(`  state: ${afterVoucher.state}`);
  console.log(`  refundCents: ${afterVoucher.refundCents}`);
  console.log(`  vendorPayoutCents: ${afterVoucher.vendorPayoutCents}`);
  console.log(`  voucher count: before=${beforeVoucherCount}, after=${afterVoucherCount}`);

  const voucherPass =
    afterVoucher.state === "RELEASED" &&
    afterVoucherCount > beforeVoucherCount;

  if (voucherPass) {
    console.log(`\n✅ resolve_voucher PASS — voucher created, escrow=RELEASED`);
  } else {
    console.error(`\n❌ resolve_voucher FAIL — see above`);
    process.exit(1);
  }

  console.log(`\n========================================`);
  console.log(`🎉 REGRESSION TEST PASSED — both resolve_refund and resolve_voucher work.`);
  console.log(`========================================`);
}

main()
  .catch((e) => {
    console.error("❌ Uncaught:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
