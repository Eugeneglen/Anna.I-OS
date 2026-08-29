// Test 7: Regression — dispute/refund flow
// Creates fresh tasks via API and verifies resolve_refund and resolve_voucher

const HH_BASE = "http://localhost:3000";
const VENDOR_ID = "cmrn548s0009kqvnzeu57kyod"; // CoolAir
const HH_ID = "cmrn548id000kqvnzeu57kyo4"; // Tan Family
const HH_MEMBER_ID = "cmrn548l0003kqvnzeu57kyo7"; // Sarah
const OPS_USER_ID = "cmtdvl6yb002zm7dzws55v0n7"; // Eugene

async function loadCookies(file) {
  const fs = await import("node:fs");
  const txt = fs.readFileSync(file, "utf8");
  const lines = txt.split("\n").filter(l => l && !l.startsWith("#"));
  return lines.map(l => l.split("\t").filter(Boolean)).filter(p => p.length >= 7).map(p => `${p[5]}=${p[6]}`).join("; ");
}

const { PrismaClient } = await import("@prisma/client");
const db = new PrismaClient();

async function createFreshTaskFlow({ instructions = "Test E2E — Test 7 regression" }) {
  const hhCookies = await loadCookies("/tmp/hh_cookies.txt");
  // 1. Create task
  const taskBody = {
    householdId: HH_ID,
    category: "AIRCON",
    jobTypeId: "cmtdvl6yv003cm7dz3kkic1h6", // Standard Service
    amountCents: 5000,
    instructions,
    recurrencePattern: { type: "ONE_OFF", interval: 1 },
    scheduledStart: "2026-10-15T10:00:00",
  };
  const createRes = await fetch(`${HH_BASE}/api/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: hhCookies },
    body: JSON.stringify(taskBody),
  });
  const createJson = await createRes.json();
  const taskId = createJson.task?.id ?? createJson.id;
  console.log("  Created task:", createJson.task?.jobNo, taskId);
  return { taskId, hhCookies };
}

async function dispatchAcceptComplete(taskId, hhCookies) {
  // 2. Dispatch
  const dispatchRes = await fetch(`${HH_BASE}/api/tasks/${taskId}/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: hhCookies },
    body: "{}",
  });
  const dispatchJson = await dispatchRes.json();
  const booking = dispatchJson.booking;
  console.log("  Dispatched, booking:", booking?.id, "vendor:", booking?.vendor?.name);
  if (!booking) throw new Error("No booking created");

  // 3. Vendor accept
  const vendorCookies = await loadCookies("/tmp/vendor_cookies.txt");
  const acceptRes = await fetch(`${HH_BASE}/api/vendors/${VENDOR_ID}/bookings/${booking.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: vendorCookies },
    body: JSON.stringify({ action: "accept" }),
  });
  const acceptJson = await acceptRes.json();
  console.log("  Accepted:", acceptJson.booking?.status);

  // 4. Vendor complete
  const completeRes = await fetch(`${HH_BASE}/api/vendors/${VENDOR_ID}/bookings/${booking.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: vendorCookies },
    body: JSON.stringify({ action: "complete", completionNotes: "Test 7 regression — completed" }),
  });
  const completeJson = await completeRes.json();
  console.log("  Completed:", completeJson.booking?.status);

  return { booking, vendorCookies };
}

async function disputeTask(taskId, hhCookies, reason = "Test 7 — dispute for regression") {
  const res = await fetch(`${HH_BASE}/api/tasks/${taskId}/escrow`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: hhCookies },
    body: JSON.stringify({ action: "dispute", reason }),
  });
  const json = await res.json();
  console.log("  Disputed, task.status:", json.task?.status, "escrow.state:", json.escrow?.state);
  return json;
}

async function resolveRefund(escrowId, resolution, fullAmountCents) {
  const opsCookies = await loadCookies("/tmp/ops_cookies.txt");
  const res = await fetch(`${HH_BASE}/api/ops/escrow/${escrowId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: opsCookies },
    body: JSON.stringify({
      action: "resolve_refund",
      resolution,
      refundAmountCents: fullAmountCents,
      idempotencyKey: `e2e-test7-refund-${Date.now()}`,
    }),
  });
  const json = await res.json();
  console.log("  resolve_refund response status:", res.status);
  return json;
}

async function resolveVoucher(escrowId, resolution) {
  const opsCookies = await loadCookies("/tmp/ops_cookies.txt");
  const res = await fetch(`${HH_BASE}/api/ops/escrow/${escrowId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: opsCookies },
    body: JSON.stringify({
      action: "resolve_voucher",
      resolution,
      voucherAmountCents: 5000, // $50 voucher
      voucherRefundAmountCents: 0,
      voucherExpiryDays: 90,
      idempotencyKey: `e2e-test7-voucher-${Date.now()}`,
    }),
  });
  const json = await res.json();
  console.log("  resolve_voucher response status:", res.status);
  return json;
}

async function main() {
  console.log("\n=== TEST 7a: Fresh disputed task -> resolve_refund ===");
  const { taskId: t1, hhCookies: hc1 } = await createFreshTaskFlow({ instructions: "Test 7a — refund flow" });
  await dispatchAcceptComplete(t1, hc1);
  await disputeTask(t1, hc1, "Test 7a — refund flow regression");
  // Get escrow ID
  const esc1 = await db.escrowLedger.findFirst({ where: { taskId: t1 }, orderBy: { createdAt: "asc" } });
  console.log("  Escrow before refund:", JSON.stringify({ id: esc1.id, amountCents: esc1.amountCents, state: esc1.state, commission: esc1.commissionCents, payout: esc1.vendorPayoutCents, refund: esc1.refundCents }, null, 2));
  const refundResult = await resolveRefund(esc1.id, "Test 7a — full refund regression", esc1.amountCents);
  console.log("  Refund result:", JSON.stringify(refundResult, null, 2).substring(0, 800));
  // Verify
  const esc1After = await db.escrowLedger.findFirst({ where: { taskId: t1 }, orderBy: { createdAt: "asc" } });
  console.log("\n  VERIFICATION (Test 7a):");
  console.log("    escrow.state:", esc1After.state, "— expected: REFUNDED");
  console.log("    escrow.refundCents:", esc1After.refundCents, "— expected:", esc1After.amountCents, "(full refund)");
  console.log("    escrow.commissionCents:", esc1After.commissionCents, "— expected: 0");
  console.log("    escrow.vendorPayoutCents:", esc1After.vendorPayoutCents, "— expected: 0");
  const t1After = await db.task.findUnique({ where: { id: t1 } });
  console.log("    task.status:", t1After.status, "— expected: DISPUTE_CLOSED or REFUNDED");

  console.log("\n=== TEST 7b: Fresh disputed task -> resolve_voucher ===");
  const { taskId: t2, hhCookies: hc2 } = await createFreshTaskFlow({ instructions: "Test 7b — voucher flow" });
  await dispatchAcceptComplete(t2, hc2);
  await disputeTask(t2, hc2, "Test 7b — voucher flow regression");
  const esc2 = await db.escrowLedger.findFirst({ where: { taskId: t2 }, orderBy: { createdAt: "asc" } });
  console.log("  Escrow before voucher:", JSON.stringify({ id: esc2.id, amountCents: esc2.amountCents, state: esc2.state }, null, 2));
  const voucherResult = await resolveVoucher(esc2.id, "Test 7b — voucher compensation regression");
  console.log("  Voucher result:", JSON.stringify(voucherResult, null, 2).substring(0, 800));
  // Verify
  const esc2After = await db.escrowLedger.findFirst({ where: { taskId: t2 }, orderBy: { createdAt: "asc" } });
  console.log("\n  VERIFICATION (Test 7b):");
  console.log("    escrow.state:", esc2After.state, "— expected: RELEASED");
  console.log("    escrow.voucherCompensationCents:", esc2After.voucherCompensationCents, "— expected: 5000");
  const voucher = await db.voucher.findFirst({ where: { issuedFromTaskId: t2 } });
  console.log("    voucher created:", !!voucher, "— expected: true");
  console.log("    voucher code:", voucher ? (await db.discountCode.findUnique({ where: { id: voucher.discountCodeId } }))?.code : "n/a");
  const t2After = await db.task.findUnique({ where: { id: t2 } });
  console.log("    task.status:", t2After.status, "— expected: ESCROW_RELEASED");

  await db.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
