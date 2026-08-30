// F19 live probe: E4 (dup escrow/VOIDED), E3+409, B15 (race guards), E7 (cumulative cap), zombie reaper
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const BASE = "http://localhost:3000";
const TAG = "W2C-PROBE";
let pass = 0, fail = 0;
function t(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
}
const jars: Record<string, string> = {};
async function login(role: string, email: string, password: string) {
  const path = role === "ops" ? "/api/ops/auth" : role === "tan" || role === "household" ? "/api/household/auth" : "/api/vendor/auth";
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  jars[role] = res.headers.get("set-cookie")?.split(",").map((c) => c.split(";")[0]).join("; ") ?? "";
  if (!res.ok) throw new Error(`login ${role} ${res.status}`);
}
async function api(role: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { "Content-Type": "application/json", ...(jars[role] ? { cookie: jars[role] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json: any = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
async function mkTask(hh: string, householdId: string, amountCents: number, label: string) {
  const r = await api(hh, "POST", "/api/tasks", { householdId, category: "CLEANING", amountCents, instructions: `${TAG} ${label}` });
  return r.json.task?.id ?? r.json.id;
}
async function accept(bookingId: string) { return api("vendor", "PATCH", `/api/vendors/${SPARK}/bookings/${bookingId}`, { action: "accept" }); }
async function bookingOf(taskId: string) { return db.booking.findFirst({ where: { taskId }, orderBy: { createdAt: "desc" } }); }
let SPARK = "";

async function main() {
  await login("tan", "sarah.tan@example.com", "household123");
  await login("ops", "eugene@annai.sg", "anna1234");
  await login("vendor", "ops@sparkclean.sg", "vendor123");
  await login("fixit", "support@fixit.sg", "vendor123");
  const tan = (await db.household.findFirst({ where: { name: { contains: "Tan" } } }))!;
  SPARK = (await db.vendor.findFirst({ where: { name: { contains: "SparkClean" } } }))!.id;
  const FIXIT = (await db.vendor.findFirst({ where: { name: { contains: "FixIt" } } }))!.id;

  // ── E4: accept → reject → rematch → re-accept = single live HELD, stale VOIDED ──
  const t1 = await mkTask("tan", tan.id, 4000, "E4-rematch");
  await api("tan", "POST", `/api/tasks/${t1}/dispatch`, { vendorId: SPARK });
  const b1 = await bookingOf(t1);
  await accept(b1!.id);
  const esc1 = await db.escrowLedger.findFirst({ where: { taskId: t1 }, orderBy: { createdAt: "asc" } });
  t("E4: first escrow HELD", esc1?.state === "HELD", `state=${esc1?.state}`);
  const rej = await api("vendor", "PATCH", `/api/vendors/${SPARK}/bookings/${b1!.id}`, { action: "reject" });
  t("E4: vendor rejected booking1 (auto-route fires)", rej.status === 200, `status=${rej.status}`);
  // auto-route assigns the next vendor (FixIt) with a fresh assigned booking —
  // no manual dispatch needed (dispatch would 409: task left MATCHING)
  const b2 = await db.booking.findFirst({ where: { taskId: t1, status: "assigned" }, orderBy: { createdAt: "desc" } });
  t("E4: auto-routed booking exists", !!b2 && b2.vendorId === FIXIT, `booking=${b2?.id.slice(-6)} vendor=${b2?.vendorId?.slice(-6)}`);
  const acc2 = await api("fixit", "PATCH", `/api/vendors/${FIXIT}/bookings/${b2!.id}`, { action: "accept" });
  t("E4: second vendor accepted", acc2.status === 200, `status=${acc2.status}`);
  const esc1b = await db.escrowLedger.findUnique({ where: { id: esc1!.id } });
  const live = await db.escrowLedger.findMany({ where: { taskId: t1, state: "HELD" } });
  t("E4: stale entry VOIDED, exactly ONE live HELD",
    esc1b?.state === "VOIDED" && live.length === 1,
    `esc1=${esc1b?.state} liveHeld=${live.length}`);
  // release path pays exactly the live entry
  await api("fixit", "PATCH", `/api/vendors/${FIXIT}/bookings/${b2!.id}`, { action: "complete" });
  await api("tan", "POST", `/api/tasks/${t1}/verify`, { bookingId: b2!.id });
  const rel = await api("tan", "PATCH", `/api/tasks/${t1}/escrow`, { action: "release" });
  t("E4: release 200", rel.status === 200, `status=${rel.status}`);
  const released = await db.escrowLedger.findMany({ where: { taskId: t1, state: "RELEASED" } });
  t("E4: exactly one RELEASED (single payout)", released.length === 1 && released[0].amountCents === 4000,
    `released=${released.length} amt=${released[0]?.amountCents}`);

  // ── B15: parallel dispute vs release on same task ──
  const t2 = await mkTask("tan", tan.id, 3000, "B15-race");
  await api("tan", "POST", `/api/tasks/${t2}/dispatch`, { vendorId: SPARK });
  const b3 = await bookingOf(t2);
  await accept(b3!.id);
  await api("vendor", "PATCH", `/api/vendors/${SPARK}/bookings/${b3!.id}`, { action: "complete" });
  await api("tan", "POST", `/api/tasks/${t2}/verify`, { bookingId: b3!.id });
  const [rA, rB] = await Promise.all([
    api("tan", "PATCH", `/api/tasks/${t2}/escrow`, { action: "release" }),
    api("ops", "PATCH", `/api/ops/escrow/${(await db.escrowLedger.findFirst({ where: { taskId: t2 } }))!.id}`, { action: "release" }),
  ]);
  const okCount = [rA, rB].filter((r) => r.status === 200).length;
  const conflictCount = [rA, rB].filter((r) => r.status === 409).length;
  t("B15: exactly one release wins, loser 409", okCount === 1 && conflictCount === 1,
    `statuses=${rA.status}/${rB.status}`);
  const relRows = await db.notification.count({ where: { householdId: tan.id, eventType: "ESCROW_RELEASED", referenceId: t2 } });
  t("B15: no duplicate ESCROW_RELEASED notification sets", relRows <= (await db.familyMember.count({ where: { householdId: tan.id } })),
    `notifRows=${relRows}`);

  // ── E3: household resolve-dispute guard (no DISPUTED → 409, not silent/500) ──
  const e3 = await api("tan", "POST", `/api/tasks/${t2}/resolve-dispute`, {});
  t("E3: resolve with nothing DISPUTED → 409", e3.status === 409, `status=${e3.status} code=${e3.json?.code}`);

  // ── E7: cumulative 2x cap across partial-credit + resolve_voucher ──
  const t3 = await mkTask("tan", tan.id, 5000, "E7-cap"); // order 5000, cap 10000
  await api("tan", "POST", `/api/tasks/${t3}/dispatch`, { vendorId: SPARK });
  const b4 = await bookingOf(t3);
  await accept(b4!.id);
  await api("vendor", "PATCH", `/api/vendors/${SPARK}/bookings/${b4!.id}`, { action: "complete" });
  await api("tan", "POST", `/api/tasks/${t3}/verify`, { bookingId: b4!.id });
  await api("tan", "PATCH", `/api/tasks/${t3}/escrow`, { action: "dispute", reason: `${TAG} cap` });
  const esc4 = (await db.escrowLedger.findFirst({ where: { taskId: t3 } }))!;
  // partial refund $30 credit (refundCreditCents=3000) → then voucher $80 (3000+8000 > 2×5000) must 422
  const pr = await api("ops", "PATCH", `/api/ops/escrow/${esc4.id}`, { action: "partial_refund", refundAmountCents: 3000, idempotencyKey: `w2c-e7-${t3}`, resolution: `${TAG} partial` });
  t("E7: partial_refund 3000 ok (task stays DISPUTED)", pr.status === 200, `status=${pr.status}`);
  const over = await api("ops", "PATCH", `/api/ops/escrow/${esc4.id}`, {
    action: "resolve_voucher", voucherAmountCents: 8000, resolution: `${TAG} over-cap`, idempotencyKey: `w2c-e7b-${t3}`,
  });
  t("E7: cumulative cap 422 (3000 prior + 8000 > 2×5000)", over.status === 422, `status=${over.status} code=${over.json?.code}`);
  const under = await api("ops", "PATCH", `/api/ops/escrow/${esc4.id}`, {
    action: "resolve_voucher", voucherAmountCents: 5000, resolution: `${TAG} within-cap`, idempotencyKey: `w2c-e7c-${t3}`,
  });
  t("E7: within-cap resolve_voucher 200 (3000+5000 ≤ 10000)", under.status === 200, `status=${under.status}`);
  const esc4b = await db.escrowLedger.findUnique({ where: { id: esc4.id } });
  t("E7: escrow RELEASED + task ESCROW_RELEASED", esc4b?.state === "RELEASED", `state=${esc4b?.state}`);

  // ── Reaper: synthetic zombie RUNNING job → FAILED ──
  const { reapStaleIssuanceJobs } = await import("../../src/lib/marketing/voucher-engine");
  // ensure a segment+campaign exist for the synthetic job FKs
  const seg = await db.segment.findFirst({ select: { id: true } });
  const camp = await db.campaign.findFirst({ where: { type: "PUBLIC_PROMO" }, select: { id: true } });
  if (seg && camp) {
    const zombie = await db.voucherIssuanceJob.create({
      data: {
        campaignId: camp.id, segmentId: seg.id, status: "RUNNING",
        totalMembers: 1, processedCount: 0,
        startedAt: new Date(Date.now() - 20 * 60 * 1000),
      },
    });
    const n = await reapStaleIssuanceJobs();
    const z = await db.voucherIssuanceJob.findUnique({ where: { id: zombie.id } });
    t("Reaper: zombie RUNNING → FAILED", n >= 1 && z?.status === "FAILED", `reaped=${n} status=${z?.status}`);
    await db.voucherIssuanceJob.delete({ where: { id: zombie.id } });
  } else {
    t("Reaper: fixtures present", false, "no segment/campaign found");
  }

  console.log(`\nW2C PROBE: ${pass} pass / ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error("PROBE ERROR:", e); process.exit(1); }).finally(() => db.$disconnect());
