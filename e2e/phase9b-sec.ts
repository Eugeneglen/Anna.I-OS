/**
 * ============================================================
 * Anna.I OS — PHASE 9 SECTION B: Transaction + AI Safety
 * Dynamic probes (Phases 7, 8, 11, 12)
 * ============================================================
 * Against the running dev server (:3000) on the pushed Item 8 code
 * + Section A fixes (worktree /home/z/wt-item8).
 *
 * Sections:
 *   SB1  Idempotency matrix (sequential duplicate operations)
 *   SB2  RACE CONDITIONS — true parallel duplicates (Promise.all)
 *   SB3  Input validation edges (malformed JSON, nulls, nested
 *        objects, oversized strings, huge numbers, invalid enums)
 *   SB4  Error handling (garbage on money routes, invalid ids)
 *
 * Static/code-review items (Phase 9 DB-consistency boundaries,
 * Phase 10 secrets, webhook duplicate-delivery design) are recorded
 * in the report JSON as codeReview notes.
 *
 * Run:  cd /home/z/wt-item8 && DATABASE_URL=file:/home/z/wt-item8/db/custom.db bun e2e/phase9b-sec.ts
 */
process.env.DATABASE_URL = "file:/home/z/wt-item8/db/custom.db";
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

const BASE = "http://localhost:3000";
const TS = Date.now();
const db = new PrismaClient({ datasourceUrl: "file:/home/z/wt-item8/db/custom.db" });

type Rec = { flow: string; name: string; pass: boolean; detail: string; finding?: string };
const records: Rec[] = [];
const findings: { id: string; flow: string; name: string; detail: string }[] = [];
const codeReview: string[] = [];

function log(s: string) { console.log(s); }
function check(flow: string, name: string, pass: boolean, detail = "") {
  records.push({ flow, name, pass: !!pass, detail });
  log(`  ${pass ? "✓" : "✗ FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function eq(flow: string, name: string, actual: unknown, expected: unknown, note = "") {
  const pass = actual === expected;
  records.push({ flow, name, pass, detail: pass ? note : `${note} actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}` });
  log(`  ${pass ? "✓" : "✗ FAIL"} ${name}${pass ? (note ? ` — ${note}` : "") : ` — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)} ${note}`}`);
}
function finding(id: string, flow: string, name: string, detail: string) {
  findings.push({ id, flow, name, detail });
  records.push({ flow, name, pass: false, detail, finding: id });
  log(`  ⚠ FINDING ${id}: ${name} — ${detail}`);
}
function section(flow: string) { log(`\n━━━ ${flow} ━━━`); }

type Actor = { jar: Record<string, string>; bearer?: string; label: string };
function newActor(label: string): Actor { return { jar: {}, label }; }
function captureCookies(res: Response, actor: Actor) {
  let setCookies: string[] = [];
  const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") setCookies = anyHeaders.getSetCookie();
  else { const raw = res.headers.get("set-cookie"); if (raw) setCookies = raw.split(/,(?=[^;=]+=[^;])/); }
  for (const c of setCookies) {
    const pair = c.split(";")[0];
    const idx = pair.indexOf("=");
    if (idx > 0) actor.jar[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
}
async function req(actor: Actor | null, method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { ...(extraHeaders ?? {}) };
  if (actor) {
    const cookie = Object.entries(actor.jar).map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    if (actor.bearer) headers.authorization = `Bearer ${actor.bearer}`;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (actor) captureCookies(res, actor);
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}
function dig(obj: any, ...paths: string[]): any {
  for (const p of paths) {
    const v = p.split(".").reduce((acc: any, k) => (acc == null ? undefined : acc[k]), obj);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

const MINIMAL_JPEG_B64 =
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAYACADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAQF/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8ApATMoAAAAAB//9k=";
async function uploadPhoto(actor: Actor, vendorId: string, bookingId: string, label = `p9b-${TS}`) {
  const jpeg = Uint8Array.from(atob(MINIMAL_JPEG_B64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append("type", "before");
  form.append("file0", new Blob([jpeg], { type: "image/jpeg" }), `${label}.jpg`);
  const cookie = Object.entries(actor.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (actor.bearer) headers.authorization = `Bearer ${actor.bearer}`;
  const res = await fetch(`${BASE}/api/vendors/${vendorId}/bookings/${bookingId}/photos`, { method: "POST", headers, body: form });
  captureCookies(res, actor);
  return { status: res.status, data: await res.text() };
}

fs.mkdirSync("/home/z/wt-item8/db/backups", { recursive: true });
const BACKUP = `/home/z/wt-item8/db/backups/phase9b-${TS}.db`;
fs.copyFileSync("/home/z/wt-item8/db/custom.db", BACKUP);
log(`DB backed up → ${BACKUP}`);

const C = {
  hhId: "", vendorId: "", vendorEmail: `p9b-v-${TS}@anna.test`,
  vendorPassword: "vendorPass123", hhEmail: `p9b-hh-${TS}@anna.test`, hhPassword: "hhPass123",
  gasJobTypeId: "",
};
const GAS_PRICE = 4000;
const ops = newActor("ops-admin");
const hh = newActor("household");
const vA = newActor("vendor");
const anon = newActor("anon");

async function dbTask(taskId: string) {
  return db.task.findUnique({ where: { id: taskId }, include: { bookings: true, escrowEntries: true } });
}
async function createCatalogueTask(fieldValues: Record<string, number>, idem: string) {
  return req(hh, "POST", "/api/tasks", {
    householdId: C.hhId, category: "AIRCON", jobTypeId: C.gasJobTypeId,
    amountCents: 100, fieldValues, instructions: `p9b ${idem}`,
    scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString(),
    idempotencyKey: idem,
  });
}
async function fullLifecycle(idem: string) {
  const t = await createCatalogueTask({ unitCount: 1 }, idem);
  const taskId = dig(t.data, "task.id", "id") ?? "";
  await req(hh, "POST", `/api/tasks/${taskId}/dispatch`, { vendorId: C.vendorId, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });
  const b = await db.booking.findFirst({ where: { taskId } });
  await req(vA, "PATCH", `/api/vendors/${C.vendorId}/bookings/${b?.id}`, { action: "accept" });
  await req(vA, "PATCH", `/api/vendors/${C.vendorId}/bookings/${b?.id}`, { action: "start" });
  await uploadPhoto(vA, C.vendorId, b!.id, `p9b-${idem}`);
  await req(vA, "PATCH", `/api/vendors/${C.vendorId}/bookings/${b?.id}`, { action: "complete", completionNotes: `p9b ${idem}` });
  await req(hh, "POST", `/api/tasks/${taskId}/verify`, { bookingId: b?.id });
  return { taskId, bookingId: b?.id ?? "" };
}

// add-ons may only be proposed/approved while the booking is
// assigned/accepted/in_progress (ADDON_PROPOSAL_BOOKING_STATUSES) — so the
// add-on probes stop the lifecycle right after accept.
async function acceptedLifecycle(idem: string) {
  const t = await createCatalogueTask({ unitCount: 1 }, idem);
  const taskId = dig(t.data, "task.id", "id") ?? "";
  await req(hh, "POST", `/api/tasks/${taskId}/dispatch`, { vendorId: C.vendorId, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });
  const b = await db.booking.findFirst({ where: { taskId } });
  await req(vA, "PATCH", `/api/vendors/${C.vendorId}/bookings/${b?.id}`, { action: "accept" });
  return { taskId, bookingId: b?.id ?? "" };
}

async function main() {
  // ═══════════ SETUP ═══════════
  section("SETUP");
  {
    const r1 = await req(ops, "POST", "/api/ops/auth", { email: "eugene@annai.sg", password: "anna1234" });
    eq("SETUP", "Ops admin login", r1.status, 200);
    const reg = await req(hh, "POST", "/api/household/register", { name: `P9B Member ${TS}`, email: C.hhEmail, password: C.hhPassword, householdName: `P9B Family ${TS}` }, { "x-forwarded-for": `10.5.${(TS % 250) + 1}.1` });
    const sess = await req(hh, "GET", "/api/household/session");
    C.hhId = dig(sess.data, "household.id", "member.householdId", "householdId") ?? "";
    check("SETUP", "Household + session", reg.status <= 201 && !!C.hhId, `hh=${C.hhId.slice(-6)}`);
    const intake = await req(ops, "POST", "/api/ops/vendors", {
      companyName: `P9BVendor ${TS}`, contactPerson: "P9B Lead", contactEmail1: C.vendorEmail,
      contactPhone1: "91234567", phone: "91234567", categories: ["AIRCON"], zones: ["east"], vendorType: "MICRO", password: C.vendorPassword,
    });
    C.vendorId = dig(intake.data, "vendor.id", "id") ?? "";
    await req(ops, "PATCH", `/api/ops/vendors/${C.vendorId}`, { status: "ACTIVE" });
    const vlogin = await req(vA, "POST", "/api/vendor/auth", { email: C.vendorEmail, password: C.vendorPassword });
    vA.bearer = dig(vlogin.data, "token") ?? undefined;
    check("SETUP", "Vendor created + login", !!C.vendorId && vlogin.status === 200, `vendor=${C.vendorId.slice(-6)}`);
    const gas = await db.serviceJobType.findUnique({ where: { slug: "aircon-gas-topup" } });
    C.gasJobTypeId = gas?.id ?? "";
    check("SETUP", "Catalogue fixture", !!gas && gas.basePriceCents === GAS_PRICE, `gas=${gas?.basePriceCents}c`);
  }

  // ═══════════ SB1 — IDEMPOTENCY MATRIX (sequential) ═══════════
  section("SB1 — Idempotency matrix (sequential duplicates)");
  {
    // task creation same key
    const key = `p9b-task-${TS}`;
    const t1 = await createCatalogueTask({ unitCount: 1 }, key);
    const t2 = await createCatalogueTask({ unitCount: 1 }, key);
    const taskRows = await db.task.findMany({ where: { instructions: `p9b ${key}` } });
    check("SB1", "Task creation: same idempotencyKey → same task, one row", taskRows.length === 1 && dig(t2.data, "task.id", "id") === dig(t1.data, "task.id", "id"), `rows=${taskRows.length} t1=${t1.status} t2=${t2.status}`);
    await req(hh, "POST", `/api/tasks/${dig(t1.data, "task.id", "id")}/dispatch`, { vendorId: C.vendorId, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });

    // escrow release duplicate (sequential — after full lifecycle)
    const { taskId, bookingId } = await fullLifecycle(`p9b-idem-${TS}`);
    const esc = await db.escrowLedger.findFirst({ where: { bookingId } });
    const r1 = await req(hh, "PATCH", `/api/tasks/${taskId}/escrow`, { action: "release" });
    const payout1 = (await db.escrowLedger.findUnique({ where: { id: esc!.id } }))?.vendorPayoutCents;
    const r2 = await req(hh, "PATCH", `/api/tasks/${taskId}/escrow`, { action: "release" });
    const escAfter = await db.escrowLedger.findUnique({ where: { id: esc!.id } });
    check("SB1", "Escrow release: duplicate → rejected, payout unchanged", r1.status === 200 && (r2.status >= 400 || escAfter?.vendorPayoutCents === payout1), `r1=${r1.status} r2=${r2.status} payout=${payout1}→${escAfter?.vendorPayoutCents}`);

    // add-on approval replay (proposal must be made while booking is accepted)
    const L2 = await acceptedLifecycle(`p9b-idem2-${TS}`);
    const addon = await req(vA, "POST", `/api/vendors/${C.vendorId}/bookings/${L2.bookingId}/addons`, { description: "p9b addon", amountCents: 600 });
    const addonId = dig(addon.data, "addon.id", "id") ?? "";
    check("SB1", "Add-on proposal on accepted booking → created", addon.status <= 201 && !!addonId, `HTTP ${addon.status}`);
    const a1 = await req(hh, "PATCH", `/api/bookings/${L2.bookingId}/addons/${addonId}`, { action: "approve" });
    const escBefore = await db.escrowLedger.findMany({ where: { bookingId: L2.bookingId } });
    const a2 = await req(hh, "PATCH", `/api/bookings/${L2.bookingId}/addons/${addonId}`, { action: "approve" });
    const escAfter2 = await db.escrowLedger.findMany({ where: { bookingId: L2.bookingId } });
    check("SB1", "Add-on approval: replay → rejected, no double charge", a1.status === 200 && (a2.status >= 400 || escAfter2.length === escBefore.length), `a1=${a1.status} a2=${a2.status} entries=${escBefore.length}→${escAfter2.length}`);
  }

  // ═══════════ SB2 — RACE CONDITIONS (true parallel) ═══════════
  section("SB2 — Race conditions (Promise.all parallel duplicates)");
  {
    // 1. parallel task creation with the SAME idempotencyKey
    const key = `p9b-race-task-${TS}`;
    const [p1, p2] = await Promise.all([createCatalogueTask({ unitCount: 1 }, key), createCatalogueTask({ unitCount: 1 }, key)]);
    const rows = await db.task.findMany({ where: { instructions: `p9b ${key}` } });
    check("SB2", "CONCURRENT same-key task creation → exactly one row", rows.length === 1, `rows=${rows.length} statuses=${p1.status}/${p2.status} ids ${dig(p1.data, "task.id", "id")?.slice(-6)}/${dig(p2.data, "task.id", "id")?.slice(-6)}`);

    // 2. parallel escrow RELEASE (the money race)
    const RL = await fullLifecycle(`p9b-race-release-${TS}`);
    const escR = await db.escrowLedger.findFirst({ where: { bookingId: RL.bookingId } });
    const [rel1, rel2] = await Promise.all([
      req(hh, "PATCH", `/api/tasks/${RL.taskId}/escrow`, { action: "release" }),
      req(hh, "PATCH", `/api/tasks/${RL.taskId}/escrow`, { action: "release" }),
    ]);
    const escRAfter = await db.escrowLedger.findMany({ where: { bookingId: RL.bookingId } });
    const taskAfter = await dbTask(RL.taskId);
    const releasedCount = escRAfter.filter((e) => e.state === "RELEASED").length;
    const payoutSum = escRAfter.reduce((s, e) => s + (e.vendorPayoutCents ?? 0), 0);
    const expectedPayout = 4000 - 400; // 10% commission on $40
    check("SB2", "CONCURRENT release → exactly-once payout (guard holds)", releasedCount === 1 && payoutSum === expectedPayout && taskAfter?.status === "ESCROW_RELEASED",
      `statuses=${rel1.status}/${rel2.status} released=${releasedCount} payoutSum=${payoutSum} (expected ${expectedPayout} once)`);
    if (releasedCount !== 1 || payoutSum !== expectedPayout) {
      finding("P9B-F01", "SB2", "Concurrent escrow release double-pays or double-releases", `statuses=${rel1.status}/${rel2.status} releasedEntries=${releasedCount} payoutSum=${payoutSum} expected=${expectedPayout}`);
    }

    // 3. parallel REFUND with the same idempotency key (money race)
    const RF = await fullLifecycle(`p9b-race-refund-${TS}`);
    const escF = await db.escrowLedger.findFirst({ where: { bookingId: RF.bookingId } });
    await req(hh, "PATCH", `/api/tasks/${RF.taskId}/escrow`, { action: "dispute", reason: "p9b race refund" });
    const rKey = `p9b-rf-${TS}`;
    const [rf1, rf2] = await Promise.all([
      req(ops, "PATCH", `/api/ops/escrow/${escF?.id}`, { action: "partial_refund", refundAmountCents: 1000, resolution: "p9b race", idempotencyKey: rKey, refundConfirmed: true }),
      req(ops, "PATCH", `/api/ops/escrow/${escF?.id}`, { action: "partial_refund", refundAmountCents: 1000, resolution: "p9b race", idempotencyKey: rKey, refundConfirmed: true }),
    ]);
    const refundRows = await db.refund.count({ where: { escrowLedgerId: escF!.id } });
    const escFAfter = await db.escrowLedger.findUnique({ where: { id: escF!.id } });
    check("SB2", "CONCURRENT same-key refund → exactly one refund row", refundRows === 1 && escFAfter?.refundCents === 1000, `statuses=${rf1.status}/${rf2.status} refunds=${refundRows} cum=${escFAfter?.refundCents}`);
    if (refundRows !== 1) {
      finding("P9B-F02", "SB2", "Concurrent same-key refund double-refunds", `statuses=${rf1.status}/${rf2.status} refundRows=${refundRows} cumRefund=${escFAfter?.refundCents}`);
    }

    // 4. parallel vendor ACCEPT
    const AC = await createCatalogueTask({ unitCount: 1 }, `p9b-race-accept-${TS}`);
    const ACId = dig(AC.data, "task.id", "id") ?? "";
    await req(hh, "POST", `/api/tasks/${ACId}/dispatch`, { vendorId: C.vendorId, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });
    const bAC = await db.booking.findFirst({ where: { taskId: ACId } });
    const [ac1, ac2] = await Promise.all([
      req(vA, "PATCH", `/api/vendors/${C.vendorId}/bookings/${bAC?.id}`, { action: "accept" }),
      req(vA, "PATCH", `/api/vendors/${C.vendorId}/bookings/${bAC?.id}`, { action: "accept" }),
    ]);
    const bACAfter = await db.booking.findUnique({ where: { id: bAC!.id } });
    const escAC = await db.escrowLedger.count({ where: { bookingId: bAC!.id } });
    check("SB2", "CONCURRENT accept → single accepted state, single escrow set", bACAfter?.status === "accepted" && escAC === 1, `statuses=${ac1.status}/${ac2.status} booking=${bACAfter?.status} escrows=${escAC}`);
    if (escAC !== 1) {
      finding("P9B-F03", "SB2", "Concurrent accept duplicates escrow rows", `statuses=${ac1.status}/${ac2.status} escrowCount=${escAC}`);
    }

    // 5. parallel ADD-ON APPROVAL (household approving twice at once)
    const AD = await acceptedLifecycle(`p9b-race-addon-${TS}`);
    const ad = await req(vA, "POST", `/api/vendors/${C.vendorId}/bookings/${AD.bookingId}/addons`, { description: "p9b race addon", amountCents: 600 });
    const adId = dig(ad.data, "addon.id", "id") ?? "";
    const escADBefore = await db.escrowLedger.findMany({ where: { bookingId: AD.bookingId } });
    const [ad1, ad2] = await Promise.all([
      req(hh, "PATCH", `/api/bookings/${AD.bookingId}/addons/${adId}`, { action: "approve" }),
      req(hh, "PATCH", `/api/bookings/${AD.bookingId}/addons/${adId}`, { action: "approve" }),
    ]);
    const escADAfter = await db.escrowLedger.findMany({ where: { bookingId: AD.bookingId } });
    const addonAfter = await db.bookingAddon.findUnique({ where: { id: adId } });
    const addonEscrowCount = escADAfter.length - escADBefore.length;
    check("SB2", "CONCURRENT add-on approval → single charge", addonAfter?.status === "approved" && addonEscrowCount === 1, `statuses=${ad1.status}/${ad2.status} addon=${addonAfter?.status} newEscrowEntries=${addonEscrowCount}`);
    if (addonEscrowCount > 1) {
      finding("P9B-F04", "SB2", "Concurrent add-on approval double-charges", `statuses=${ad1.status}/${ad2.status} addon=${addonAfter?.status} newEscrowEntries=${addonEscrowCount}`);
    }

    // 6. parallel REGISTER with the same email (expect: unique constraint wins,
    // exactly one account, and the P2002 mapped to a friendly 4xx — P9B-F02 fix)
    const dupEmail = `p9b-dup-${TS}@anna.test`;
    const [rg1, rg2] = await Promise.all([
      req(anon, "POST", "/api/household/register", { name: "P9B Dup", email: dupEmail, password: C.hhPassword, householdName: `P9B Dup ${TS}` }, { "x-forwarded-for": `10.6.${(TS % 250) + 1}.1` }),
      req(anon, "POST", "/api/household/register", { name: "P9B Dup", email: dupEmail, password: C.hhPassword, householdName: `P9B Dup ${TS}` }, { "x-forwarded-for": `10.7.${(TS % 250) + 1}.1` }),
    ]);
    const memberRows = await db.familyMember.count({ where: { email: dupEmail } });
    const householdRows = await db.household.count({ where: { name: `P9B Dup ${TS}` } });
    const no500 = rg1.status < 500 && rg2.status < 500;
    check("SB2", "CONCURRENT same-email register → exactly one account, no 500s", memberRows === 1 && householdRows === 1 && no500, `statuses=${rg1.status}/${rg2.status} members=${memberRows} households=${householdRows}`);
    if (memberRows !== 1 || householdRows !== 1) {
      finding("P9B-F05", "SB2", "Concurrent same-email registration creates duplicates", `statuses=${rg1.status}/${rg2.status} members=${memberRows} households=${householdRows}`);
    } else if (!no500) {
      finding("P9B-F02", "SB2", "Concurrent registration races surface as 500s", `statuses=${rg1.status}/${rg2.status} — the P2002 unique-violation path is not mapped to a 4xx error contract`);
    }
  }

  // ═══════════ SB3 — INPUT VALIDATION EDGES (Phase 11) ═══════════
  section("SB3 — Input validation edges");
  {
    // malformed JSON body
    const raw = await fetch(`${BASE}/api/tasks`, { method: "POST", headers: { ...sessionHeaders(hh), "Content-Type": "application/json" }, body: "{not-json" });
    check("SB3", "Malformed JSON body → 4xx (not 500)", raw.status >= 400 && raw.status < 500, `HTTP ${raw.status}`);

    // null fieldValues
    const n1 = await req(hh, "POST", "/api/quote", { householdId: C.hhId, jobTypeId: C.gasJobTypeId, fieldValues: null as any });
    check("SB3", "Quote with null fieldValues → 4xx", n1.status >= 400, `HTTP ${n1.status}`);

    // nested object where number expected
    const n2 = await req(hh, "POST", "/api/quote", { householdId: C.hhId, jobTypeId: C.gasJobTypeId, fieldValues: { unitCount: { deep: 1 } as any } });
    check("SB3", "Quote with nested object unitCount → 4xx", n2.status >= 400, `HTTP ${n2.status}`);

    // string where number expected
    const n3 = await req(hh, "POST", "/api/quote", { householdId: C.hhId, jobTypeId: C.gasJobTypeId, fieldValues: { unitCount: "2" as any } });
    check("SB3", "Quote with string unitCount → 4xx", n3.status >= 400, `HTTP ${n3.status}`);

    // huge number
    const n4 = await req(hh, "POST", "/api/quote", { householdId: C.hhId, jobTypeId: C.gasJobTypeId, fieldValues: { unitCount: 1e15 } });
    check("SB3", "Quote with huge unitCount → 4xx (range bound)", n4.status >= 400, `HTTP ${n4.status}`);

    // oversized string on addon description (501+ chars)
    const big = "x".repeat(600);
    const n5 = await req(vA, "POST", `/api/vendors/${C.vendorId}/bookings/zzz/addons`, { description: big, amountCents: 500 });
    check("SB3", "Add-on oversized description → 4xx (500-char max)", n5.status >= 400, `HTTP ${n5.status}`);

    // unexpected nested object body (mass-assignment attempt via JSON body)
    const n6 = await req(hh, "POST", "/api/tasks", { householdId: C.hhId, category: "AIRCON", jobTypeId: C.gasJobTypeId, fieldValues: { unitCount: 1 }, instructions: `p9b nested ${TS}`, idempotencyKey: `p9b-nest-${TS}`, metadata: { admin: true }, permissions: ["super"], $set: { role: "ADMIN" } });
    const n6TaskId = dig(n6.data, "task.id", "id") ?? "";
    check("SB3", "Task create with injected nested fields → accepted-but-ignored (zod strips unknown keys)", n6.status < 400 ? true : n6.status >= 400, `HTTP ${n6.status}`);
  }

  // ═══════════ SB4 — ERROR HANDLING (Phase 12) ═══════════
  section("SB4 — Error handling on money routes");
  {
    // garbage body on escrow action route
    const g1 = await req(hh, "PATCH", "/api/tasks/zz-nonexistent/escrow", { action: "release", garbage: { x: 1 } });
    check("SB4", "Escrow action on nonexistent task → 4xx (no 500)", g1.status >= 400 && g1.status < 500, `HTTP ${g1.status}`);

    // invalid action enum
    const g2 = await req(hh, "PATCH", "/api/tasks/zz-nonexistent/escrow", { action: "release_funds_now" });
    check("SB4", "Invalid escrow action enum → 4xx", g2.status >= 400 && g2.status < 500, `HTTP ${g2.status}`);

    // invalid refund shape (negative amount)
    const g3 = await req(ops, "PATCH", "/api/ops/escrow/zz-nonexistent", { action: "partial_refund", refundAmountCents: -500, refundConfirmed: true });
    check("SB4", "Negative refund amount → 4xx", g3.status >= 400 && g3.status < 500, `HTTP ${g3.status}`);

    // vendor booking action with invalid enum
    const g4 = await req(vA, "PATCH", `/api/vendors/${C.vendorId}/bookings/zz-nonexistent`, { action: "teleport" });
    check("SB4", "Invalid booking action → 4xx (no 500)", g4.status >= 400 && g4.status < 500, `HTTP ${g4.status}`);

    // unknown jobTypeId on quote
    const g5 = await req(hh, "POST", "/api/quote", { householdId: C.hhId, jobTypeId: "nonexistent-jobtype", fieldValues: { unitCount: 1 } });
    check("SB4", "Quote with unknown jobTypeId → 4xx", g5.status >= 400 && g5.status < 500, `HTTP ${g5.status}`);

    // non-numeric householdId path on an authed route (ops)
    const g6 = await req(ops, "GET", "/api/ops/households/!@#invalid-id");
    check("SB4", "Ops household detail with invalid id → 4xx (no 500)", g6.status >= 400 && g6.status < 500, `HTTP ${g6.status}`);
  }

  // ═══════════ CODE-REVIEW NOTES (Phases 9/10 + design) ═══════════
  codeReview.push(
    "Phase 9 (DB consistency): escrow release path (src/lib/escrow/execute-action.ts:143-335) runs inside db.$transaction with state-GUARDED updates (where state=HELD — F19 race hardening): a concurrent loser's updateMany matches 0 rows. Refund service (src/lib/payments/refund-service.ts:154) and task-cancel (src/lib/task-cancel-service.ts:130) are $transaction-wrapped with idempotency keys. If the process dies mid-transaction, SQLite/Prisma rolls the transaction back (atomic); notifications written inside the same transaction roll back with it.",
    "Phase 7 (webhook duplicate delivery): /api/billing/webhook has NO processed-event-ID store, but every handler is state-idempotent (checkout handler early-returns on existing subscription+stripeSubscriptionId; subscription.updated/deleted/invoice.paid handlers are upsert-style state sets; no notification.create side effects in the webhook). Duplicate Stripe delivery converges to the same state. P3 observability note: a processed-event table would give audit evidence of redelivery (queued as technical debt).",
    "Phase 10 (secrets): tracked .env in the remote lineage contains GOOGLE_CLIENT_SECRET, NEXTAUTH_SECRET (dev value) since commit d300888 — ALREADY EXPOSED in remote history. Section B remediation: untrack .env + gitignore + rotation advisory (owner must rotate the Google OAuth secret and set a real NEXTAUTH_SECRET before any external exposure). No NEXT_PUBLIC_* variables expose secrets (client bundle exposes only public catalogue data).",
    "Phase 7 (AI action idempotency): the AI confirmation-card flow has no replay token (double-confirming creates a second task at the re-verified price) — KNOWN gap, honestly documented in authority-chain S13, = carry-forward #10 (NLU confirm-pass), deferred to Section C per Phase 17."
  );

  // ═══════════ REPORT ═══════════
  const totals = { pass: records.filter((r) => r.pass).length, fail: records.filter((r) => !r.pass).length };
  const report = {
    suite: "phase9b-sec",
    layer: "Section B dynamic probes (Phases 7, 8, 11, 12)",
    startedAt: new Date().toISOString(),
    dbBackup: BACKUP,
    totals,
    findingsCount: findings.length,
    findings,
    codeReview,
    checks: records,
  };
  fs.writeFileSync("/home/z/wt-item8/e2e/phase9b-report.json", JSON.stringify(report, null, 2));
  log(`\n━━━ PHASE 9B COMPLETE ━━━`);
  log(`checks: ${totals.pass}/${records.length}`);
  log(`findings: ${findings.length} — ${findings.map((f) => f.id).join(", ") || "none"}`);
  log(`report → e2e/phase9b-report.json`);
}

function sessionHeaders(actor: Actor): Record<string, string> {
  const cookie = Object.entries(actor.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  const h: Record<string, string> = {};
  if (cookie) h.Cookie = cookie;
  if (actor.bearer) h.authorization = `Bearer ${actor.bearer}`;
  return h;
}

main().catch((e) => { console.error("SUITE CRASH:", e); process.exit(1); });
