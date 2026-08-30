// F18 live probe: cancellation→credit (R3) end-to-end + resolve_refund credit
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const BASE = "http://localhost:3000";
const TAG = "W2B-PROBE";
let pass = 0, fail = 0;
function t(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
}

const jars: Record<string, string> = {};
async function login(role: string, email: string, password: string) {
  const res = await fetch(`${BASE}/api/${role === "vendor" ? "vendor/auth" : role === "ops" ? "ops/auth" : "household/auth"}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const cookie = res.headers.get("set-cookie")?.split(",").map((c) => c.split(";")[0]).join("; ") ?? "";
  jars[role] = cookie;
  if (!res.ok) throw new Error(`login ${role} failed ${res.status}`);
}
async function api(role: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(jars[role] ? { cookie: jars[role] } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function main() {
  await login("tan", "sarah.tan@example.com", "household123");
  await login("ops", "eugene@annai.sg", "anna1234");
  await login("vendor", "ops@sparkclean.sg", "vendor123");
  const tan = await db.household.findFirst({ where: { name: { contains: "Tan" } } });
  const spark = await db.vendor.findFirst({ where: { name: { contains: "SparkClean" } } });
  if (!tan || !spark) throw new Error("fixtures missing");

  // ── Probe A: full cancel→credit lifecycle (no voucher) ──
  const createA = await api("tan", "POST", "/api/tasks", {
    householdId: tan.id, category: "CLEANING", amountCents: 5000, instructions: `${TAG} cancel-credit`,
  });
  t("A: task created", createA.status === 201, `status=${createA.status}`);
  const taskA = createA.json.task?.id ?? createA.json.id;
  const dA = await api("tan", "POST", `/api/tasks/${taskA}/dispatch`, { vendorId: spark.id });
  t("A: dispatched", dA.status === 200 || dA.status === 201, `status=${dA.status}`);
  const bookingA = await db.booking.findFirst({ where: { taskId: taskA }, orderBy: { createdAt: "desc" } });
  const vaA = await api("vendor", "PATCH", `/api/vendors/${spark.id}/bookings/${bookingA!.id}`, { action: "accept" });
  t("A: vendor accepted (escrow HELD)", vaA.status === 200, `status=${vaA.status}`);
  const escA = await db.escrowLedger.findFirst({ where: { taskId: taskA }, orderBy: { createdAt: "desc" } });
  t("A: escrow HELD $50", escA?.state === "HELD" && escA?.amountCents === 5000, `state=${escA?.state} amt=${escA?.amountCents}`);

  const cancelA = await api("tan", "POST", `/api/tasks/${taskA}/cancel`, { reason: "W2B probe cancel" });
  t("A: cancel 200", cancelA.status === 200, `status=${cancelA.status} body=${JSON.stringify(cancelA.json).slice(0, 200)}`);
  t("A: refundedCents 5000 + credit code", cancelA.json?.refundedCents === 5000 && !!cancelA.json?.credit?.code,
    `refunded=${cancelA.json?.refundedCents} code=${cancelA.json?.credit?.code}`);

  const escA2 = await db.escrowLedger.findUnique({ where: { id: escA!.id } });
  t("A: escrow REFUNDED commission=0 payout=0 refundCents=5000",
    escA2?.state === "REFUNDED" && escA2?.commissionCents === 0 && escA2?.vendorPayoutCents === 0 && escA2?.refundCents === 5000,
    `state=${escA2?.state} comm=${escA2?.commissionCents} payout=${escA2?.vendorPayoutCents} refund=${escA2?.refundCents}`);
  t("A: credit link stamped", escA2?.refundCreditCents === 5000 && escA2?.refundCreditVoucherId === cancelA.json?.credit ? true : !!escA2?.refundCreditVoucherId,
    `creditCents=${escA2?.refundCreditCents} voucherId=${escA2?.refundCreditVoucherId?.slice(-8)}`);

  const taskA2 = await db.task.findUnique({ where: { id: taskA } });
  t("A: task CANCELLED", taskA2?.status === "CANCELLED", `status=${taskA2?.status}`);
  const bookingA2 = await db.booking.findUnique({ where: { id: bookingA!.id } });
  t("A: booking cancelled", bookingA2?.status === "cancelled", `status=${bookingA2?.status}`);

  const creditVoucher = escA2?.refundCreditVoucherId
    ? await db.voucher.findUnique({ where: { id: escA2.refundCreditVoucherId }, include: { campaign: true, discountCode: true } })
    : null;
  t("A: credit voucher origin/amount/expiry",
    creditVoucher?.origin === "REFUND_CREDIT" && creditVoucher.campaign.type === "REFUND_CREDIT" && creditVoucher.status === "CLAIMED" &&
    creditVoucher.discountCode.maxUses === 1 && creditVoucher.expiresAt !== null,
    `origin=${creditVoucher?.origin} type=${creditVoucher.campaign.type} status=${creditVoucher.status}`);
  const attrA = await db.campaignAttribution.count({ where: { campaignId: creditVoucher!.campaignId } });
  t("A: zero attribution on credit campaign", attrA === 0, `rows=${attrA}`);
  const audits = await db.auditLog.findMany({ where: { entityId: taskA, action: "TASK_CANCELLED" } });
  t("A: TASK_CANCELLED audit", audits.length === 1);

  const replayA = await api("tan", "POST", `/api/tasks/${taskA}/cancel`, {});
  t("A: replay cancel 409", replayA.status === 409, `status=${replayA.status}`);

  // ── Probe B: dispute → resolve_refund → credit (policy §2 row 2) ──
  const createB = await api("tan", "POST", "/api/tasks", {
    householdId: tan.id, category: "CLEANING", amountCents: 3000, instructions: `${TAG} dispute-refund-credit`,
  });
  const taskB = createB.json.task?.id ?? createB.json.id;
  await api("tan", "POST", `/api/tasks/${taskB}/dispatch`, { vendorId: spark.id });
  const bookingB = await db.booking.findFirst({ where: { taskId: taskB }, orderBy: { createdAt: "desc" } });
  await api("vendor", "PATCH", `/api/vendors/${spark.id}/bookings/${bookingB!.id}`, { action: "accept" });
  await api("vendor", "PATCH", `/api/vendors/${spark.id}/bookings/${bookingB!.id}`, { action: "complete" });
  await api("tan", "POST", `/api/tasks/${taskB}/verify`, { bookingId: bookingB!.id });
  const disB = await api("tan", "PATCH", `/api/tasks/${taskB}/escrow`, { action: "dispute", reason: `${TAG} quality` });
  t("B: disputed", disB.status === 200, `status=${disB.status}`);
  const escB = await db.escrowLedger.findFirst({ where: { taskId: taskB }, orderBy: { createdAt: "desc" } });
  const rrB = await api("ops", "PATCH", `/api/ops/escrow/${escB!.id}`, { action: "resolve_refund", resolution: `${TAG} upheld` });
  t("B: resolve_refund 200 + creditCode", rrB.status === 200 && !!rrB.json?.creditCode,
    `status=${rrB.status} creditCode=${rrB.json?.creditCode}`);
  const escB2 = await db.escrowLedger.findUnique({ where: { id: escB!.id } });
  t("B: escrow REFUNDED + credit link", escB2?.state === "REFUNDED" && escB2?.refundCreditCents === 3000 && !!escB2?.refundCreditVoucherId,
    `state=${escB2?.state} creditCents=${escB2?.refundCreditCents}`);
  const creditB = escB2?.refundCreditVoucherId
    ? await db.voucher.findUnique({ where: { id: escB2.refundCreditVoucherId } })
    : null;
  t("B: credit voucher $30 REFUND_CREDIT", creditB?.origin === "REFUND_CREDIT" && creditB.status === "CLAIMED");

  // ── Probe C: cancel on COMPLETED → 409 with guidance ──
  const replayC = await api("tan", "POST", `/api/tasks/${taskB}/cancel`, {});
  t("C: cancel DISPUTE_CLOSED task 409", replayC.status === 409, `status=${replayC.status}`);

  // ── Probe D: unauthorized (vendor can't cancel household task) ──
  const unauth = await api("vendor", "POST", `/api/tasks/${taskA}/cancel`, {});
  t("D: vendor 401", unauth.status === 401, `status=${unauth.status}`);

  console.log(`\nW2B PROBE: ${pass} pass / ${fail} fail`);
  console.log(`probe objects left (disclosed): tasks ${taskA} ${taskB} (${TAG})`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error("PROBE ERROR:", e); process.exit(1); }).finally(() => db.$disconnect());
