/**
 * ============================================================
 * Anna.I OS — End-to-End Business Workflow Test Harness
 * ============================================================
 * Drives REAL HTTP requests against the running dev server (:3000)
 * and cross-checks every step against the SQLite database
 * (source of truth) and across the THREE environments:
 *
 *   USER environment      — household portal APIs (household_token)
 *   VENDOR environment    — vendor portal APIs    (vendor_token)
 *   OPS environment       — ops console APIs      (ops_token)
 *
 * Flows:
 *   1  User → Vendor → Ops core lifecycle (account → onboarding → browse
 *      → booking → payment/escrow → acceptance → execution → completion
 *      → verification → payout)
 *   2  Add-on (order → add-on → revised total → escrow → completion → payout)
 *   3  Refund (order → partial refund → provider refund → escrow adjustment
 *      → user totals → vendor payout → ops records)
 *   4  Dispute (order → dispute → actions → ops review → settlement →
 *      terminal status)
 *   5  Voucher / Promotion (campaign → targeted user → issuance → checkout
 *      → discount → accounting → refund behaviour → reissue)
 *   6  Marketing (behaviour → insight → segment → campaign → conversion →
 *      ROI)
 *
 * Run:  cd /home/z/my-project && bun e2e/run-flows.ts
 * (dev server must be running on port 3000)
 */
process.env.DATABASE_URL ??= "file:/home/z/my-project/db/custom.db";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3000";
const TS = Date.now();
const db = new PrismaClient();

// ────────────────────────────────────────────────────────────
// Tiny test framework
// ────────────────────────────────────────────────────────────
type Rec = { flow: string; name: string; pass: boolean; detail: string };
const records: Rec[] = [];
const trace: string[] = [];

function log(s: string) {
  trace.push(s);
  console.log(s);
}
function check(flow: string, name: string, pass: boolean, detail = "") {
  records.push({ flow, name, pass: !!pass, detail });
  log(`  ${pass ? "✓" : "✗ FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function eq(flow: string, name: string, actual: unknown, expected: unknown, note = "") {
  const pass = actual === expected;
  records.push({ flow, name, pass, detail: pass ? note : `${note} actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}` });
  log(`  ${pass ? "✓" : "✗ FAIL"} ${name}${pass ? (note ? ` — ${note}` : "") : ` — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)} ${note}`}`);
}
function section(flow: string) {
  log(`\n━━━ ${flow} ━━━`);
}

// ────────────────────────────────────────────────────────────
// HTTP actor with cookie jar
// ────────────────────────────────────────────────────────────
type Actor = { jar: Record<string, string>; bearer?: string; label: string };

function newActor(label: string): Actor {
  return { jar: {}, label };
}
function captureCookies(res: Response, actor: Actor) {
  let setCookies: string[] = [];
  const anyHeaders = res.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    setCookies = anyHeaders.getSetCookie();
  } else {
    const raw = res.headers.get("set-cookie");
    if (raw) setCookies = raw.split(/,(?=[^;=]+=[^;])/);
  }
  for (const c of setCookies) {
    const pair = c.split(";")[0];
    const eq2 = pair.indexOf("=");
    if (eq2 <= 0) continue;
    const name = pair.slice(0, eq2).trim();
    const value = pair.slice(eq2 + 1).trim();
    if (value === "") delete actor.jar[name];
    else actor.jar[name] = value;
  }
}
// ── Service/Pricing/Availability Authority suite adaptation ──
// Remote 46a3d91 ships the job-completion photo gate (PlatformConfig
// "require_verification_photos", DEFAULT TRUE): a booking cannot be
// completed without at least one verification photo. The lifecycle flows
// below now upload a minimal "before" photo before `complete` — the real
// product flow. type="before" never triggers the VLM analysis path, so
// this suite stays provider-independent.
const MINIMAL_JPEG_B64 =
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAYACADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAQF/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8ApATMoAAAAAB//9k=";

async function uploadGatePhoto(actor: Actor, bookingId: string): Promise<{ status: number; data: any }> {
  const jpeg = Uint8Array.from(atob(MINIMAL_JPEG_B64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append("type", "before");
  form.append("file0", new Blob([jpeg], { type: "image/jpeg" }), `e2e-gate-${Date.now()}.jpg`);
  const cookie = Object.entries(actor.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  const headers: Record<string, string> = {};
  if (cookie) headers["cookie"] = cookie;
  if (actor.bearer) headers["authorization"] = `Bearer ${actor.bearer}`;
  const res = await fetch(`${BASE}/api/vendors/${C.vendorId}/bookings/${bookingId}/photos`, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(90_000),
  });
  captureCookies(res, actor);
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

async function req(actor: Actor, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  const cookie = Object.entries(actor.jar).map(([k, v]) => `${k}=${v}`).join("; ");
  if (cookie) headers["cookie"] = cookie;
  if (actor.bearer) headers["authorization"] = `Bearer ${actor.bearer}`;
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    log(`  [HTTP] ${method} ${path} → NETWORK ERROR ${String(e)}`);
    return { status: 0, data: null };
  }
  captureCookies(res, actor);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (res.status >= 400) {
    log(`  [HTTP] ${method} ${path} → ${res.status} :: ${text.slice(0, 220)}`);
  } else {
    log(`  [HTTP] ${method} ${path} → ${res.status}`);
  }
  return { status: res.status, data };
}
const dig = (o: any, ...paths: string[]): any => {
  for (const p of paths) {
    const v = p.split(".").reduce((acc: any, k) => (acc == null ? undefined : acc[k]), o);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ────────────────────────────────────────────────────────────
// Cross-environment truth checker
// ────────────────────────────────────────────────────────────
async function vendorEarningsDb(vendorId: string) {
  const entries = await db.escrowLedger.findMany({
    where: { booking: { vendorId } },
    select: { state: true, vendorPayoutCents: true, commissionCents: true, amountCents: true, refundCents: true },
  });
  return {
    pending: entries.filter((e) => e.state === "HELD" || e.state === "DISPUTED").reduce((s, e) => s + e.vendorPayoutCents, 0),
    earned: entries.filter((e) => e.state === "RELEASED").reduce((s, e) => s + e.vendorPayoutCents, 0),
    refunded: entries.reduce((s, e) => s + e.refundCents, 0),
    commission: entries.reduce((s, e) => s + e.commissionCents, 0),
    count: entries.length,
  };
}

interface TruthCtx {
  flow: string;
  label: string;
  hh: Actor;
  vendor: Actor;
  ops: Actor;
  hhEmail: string;
  hhName: string;
  vendorId: string;
  taskId: string;
}

/**
 * Verifies the SAME underlying truth is visible in all 3 environments + DB:
 *  - USER      : GET /api/tasks/{id}            (task status, escrows, addons)
 *  - VENDOR    : GET /api/vendors/{id}/schedule (booking status per task)
 *                GET /api/vendors/{id}/earnings (payout/refund totals)
 *  - OPS       : GET /api/ops/escrow?search     (ledger entries)
 *                GET /api/ops/bookings?search   (booking rows)
 *  - DB        : Prisma — source of truth
 */
async function truthCheck(c: TruthCtx) {
  const { flow, label } = c;
  log(`  ⟤ TRUTH CHECK [${label}] — user × vendor × ops × DB`);

  // ── DB ground truth ──
  const dbTask = await db.task.findUnique({
    where: { id: c.taskId },
    include: { bookings: true, escrowEntries: true },
  });
  if (!dbTask) {
    check(flow, `[${label}] task exists in DB`, false);
    return;
  }

  // ── USER view ──
  const uv = await req(c.hh, "GET", `/api/tasks/${c.taskId}`);
  const userTask = dig(uv.data, "task") ?? uv.data;
  eq(flow, `[${label}] USER task status = DB task status`, userTask?.status, dbTask.status, `status=${dbTask.status}`);

  // user escrow parity
  const userEscrows: any[] = (userTask?.escrowEntries ?? []).slice().sort((a: any, b: any) => a.id.localeCompare(b.id));
  const dbEscrows = dbTask.escrowEntries.slice().sort((a, b) => a.id.localeCompare(b.id));
  eq(flow, `[${label}] USER escrow entry count = DB`, userEscrows.length, dbEscrows.length);
  for (let i = 0; i < dbEscrows.length; i++) {
    const dbE = dbEscrows[i];
    const uE = userEscrows[i];
    if (!uE) break;
    eq(flow, `[${label}] USER escrow ${dbE.id.slice(-6)} state = DB`, uE.state, dbE.state);
    eq(flow, `[${label}] USER escrow ${dbE.id.slice(-6)} amount = DB`, uE.amountCents, dbE.amountCents);
  }

  // ── VENDOR view ──
  const sv = await req(c.vendor, "GET", `/api/vendors/${c.vendorId}/schedule?search=${encodeURIComponent(c.hhName)}`);
  check(flow, `[${label}] VENDOR schedule search endpoint healthy (200)`, sv.status === 200, `status=${sv.status}`);
  const schedItems: any[] = (dig(sv.data, "schedule") ?? []).filter((b: any) => b.jobNo === dbTask.jobNo);
  eq(flow, `[${label}] VENDOR schedule booking count = DB`, schedItems.length, dbTask.bookings.length, `jobNo=${dbTask.jobNo} bookings=${dbTask.bookings.length}`);
  for (const dbB of dbTask.bookings) {
    const vB = schedItems.find((b: any) => b.id === dbB.id);
    if (!vB) {
      check(flow, `[${label}] VENDOR sees booking ${dbB.id.slice(-6)}`, false);
      continue;
    }
    eq(flow, `[${label}] VENDOR booking ${dbB.id.slice(-6)} status = DB`, vB.status, dbB.status);
    eq(flow, `[${label}] VENDOR booking ${dbB.id.slice(-6)} task status = DB`, vB.taskStatus, dbTask.status);
  }

  // vendor earnings parity (vendor is exclusive to E2E households in this run)
  const ev = await req(c.vendor, "GET", `/api/vendors/${c.vendorId}/earnings`);
  const dbEarn = await vendorEarningsDb(c.vendorId);
  const vEarn = ev.data ?? {};
  eq(flow, `[${label}] VENDOR earnings.pendingPayout = DB Σ payout(HELD+DISPUTED)`, vEarn.pendingPayout, dbEarn.pending, `${dbEarn.pending}c`);
  eq(flow, `[${label}] VENDOR earnings.totalEarned = DB Σ payout(RELEASED)`, vEarn.totalEarned, dbEarn.earned, `${dbEarn.earned}c`);
  eq(flow, `[${label}] VENDOR earnings.totalRefunded = DB Σ refundCents`, vEarn.totalRefunded, dbEarn.refunded, `${dbEarn.refunded}c`);

  // ── OPS view ──
  const ov = await req(c.ops, "GET", `/api/ops/escrow?search=${encodeURIComponent(c.hhEmail)}&limit=100`);
  const opsEntries: any[] = (dig(ov.data, "entries") ?? []).filter((e: any) => (e.task?.id ?? e.taskId) === c.taskId);
  eq(flow, `[${label}] OPS ledger entries for task = DB`, opsEntries.length, dbEscrows.length);
  for (const dbE of dbEscrows) {
    const oE = opsEntries.find((e: any) => e.id === dbE.id);
    if (!oE) {
      check(flow, `[${label}] OPS ledger shows escrow ${dbE.id.slice(-6)}`, false);
      continue;
    }
    eq(flow, `[${label}] OPS escrow ${dbE.id.slice(-6)} state = DB`, oE.state, dbE.state);
    eq(flow, `[${label}] OPS escrow ${dbE.id.slice(-6)} amount = DB`, oE.amountCents, dbE.amountCents);
    eq(flow, `[${label}] OPS escrow ${dbE.id.slice(-6)} payout = DB`, oE.vendorPayoutCents, dbE.vendorPayoutCents);
  }
  const ob = await req(c.ops, "GET", `/api/ops/bookings?search=${encodeURIComponent(c.hhName)}&limit=100`);
  const opsBookings: any[] = (dig(ob.data, "bookings") ?? []).filter((b: any) => (b.task?.id ?? b.taskId) === c.taskId);
  eq(flow, `[${label}] OPS bookings rows for task = DB`, opsBookings.length, dbTask.bookings.length);
  for (const dbB of dbTask.bookings) {
    const oB = opsBookings.find((b: any) => b.id === dbB.id);
    if (!oB) {
      check(flow, `[${label}] OPS bookings shows ${dbB.id.slice(-6)}`, false);
      continue;
    }
    eq(flow, `[${label}] OPS booking ${dbB.id.slice(-6)} status = DB`, oB.status, dbB.status);
  }
}

// ────────────────────────────────────────────────────────────
// Shared context
// ────────────────────────────────────────────────────────────
const ops = newActor("ops");
const hh = newActor("household");
const vendor = newActor("vendor");
const C = {
  hhEmail: `e2e-alpha+${TS}@anna.test`,
  hhPassword: "E2eHousehold123!",
  hhName: `E2E Alpha ${TS}`,
  vendorCompany: `E2E Sparkle ${TS}`,
  vendorEmail: `e2e-vendor+${TS}@anna.test`,
  vendorPassword: "E2eVendor123!",
  householdId: "",
  memberId: "",
  vendorId: "",
};

const commissionOf = (base: number) => Math.round((base * 10) / 100);

// ────────────────────────────────────────────────────────────
// Setup: three actors
// ────────────────────────────────────────────────────────────
async function setup() {
  section("SETUP — ops login, user account, vendor onboarding");
  // ops
  const opsLogin = await req(ops, "POST", "/api/ops/auth", { email: "eugene@annai.sg", password: "anna1234" });
  eq("SETUP", "Ops admin login (eugene@annai.sg)", opsLogin.status, 200);

  // ops session identity
  const opsMe = await req(ops, "GET", "/api/ops/auth/me");
  check("SETUP", "Ops session resolves RBAC identity", opsMe.status === 200 && !!dig(opsMe.data, "user"), `role=${dig(opsMe.data, "user.role", "user.roleName")}`);

  // household registration (user account creation)
  const reg = await req(hh, "POST", "/api/household/register", {
    name: "E2E Owner Alpha",
    email: C.hhEmail,
    password: C.hhPassword,
    householdName: C.hhName,
  });
  check("SETUP", "Household register (201/200)", reg.status === 201 || reg.status === 200, `status=${reg.status}`);
  const sess = await req(hh, "GET", "/api/household/session");
  C.householdId = dig(sess.data, "household.id", "member.householdId", "session.householdId", "householdId") ?? "";
  C.memberId = dig(sess.data, "member.id", "session.memberId", "memberId") ?? "";
  check("SETUP", "Household session → householdId + memberId", !!C.householdId && !!C.memberId, `hh=${C.householdId.slice(-6)} member=${C.memberId.slice(-6)}`);
  eq("SETUP", "New household onboardingStep = 0", dig(sess.data, "household.onboardingStep"), 0);

  // vendor intake by ops (PENDING), then activation
  const intake = await req(ops, "POST", "/api/ops/vendors", {
    companyName: C.vendorCompany,
    contactPerson: "E2E Vendor Lead",
    contactEmail1: C.vendorEmail,
    contactPhone1: "91234567",
    phone: "91234567",
    categories: ["CLEANING"],
    zones: ["east"],
    vendorType: "MICRO",
    password: C.vendorPassword,
  });
  C.vendorId = dig(intake.data, "vendor.id", "id") ?? "";
  check("SETUP", "Ops vendor intake creates vendor", intake.status === 201 && !!C.vendorId, `vendor=${C.vendorId.slice(-6)} status=${dig(intake.data, "vendor.status")}`);

  // negative check: pending vendor must NOT be publicly visible
  const pubPending = await req(hh, "GET", `/api/vendors?category=CLEANING`);
  const visiblePending = (pubPending.data?.vendors ?? pubPending.data ?? []).some((v: any) => v.id === C.vendorId);
  check("SETUP", "PENDING vendor NOT visible in public browse", !visiblePending);

  const act = await req(ops, "PATCH", `/api/ops/vendors/${C.vendorId}`, { status: "ACTIVE" });
  check("SETUP", "Ops activates vendor", act.status === 200, `status=${act.status}`);
  const pubActive = await req(hh, "GET", `/api/vendors?category=CLEANING`);
  const visibleActive = (pubActive.data?.vendors ?? pubActive.data ?? []).some((v: any) => v.id === C.vendorId);
  check("SETUP", "ACTIVE vendor visible in public browse (user discovery)", visibleActive);

  // vendor portal login
  const vlogin = await req(vendor, "POST", "/api/vendor/auth", { email: C.vendorEmail, password: C.vendorPassword });
  vendor.bearer = dig(vlogin.data, "token") ?? undefined;
  check("SETUP", "Vendor portal login", vlogin.status === 200, `status=${vlogin.status} bearer=${!!vendor.bearer}`);
}

// ────────────────────────────────────────────────────────────
// Helpers: task lifecycle shortcuts
// ────────────────────────────────────────────────────────────
async function createTask(flow: string, amountCents: number, extra: Record<string, unknown> = {}) {
  const r = await req(hh, "POST", "/api/tasks", {
    householdId: C.householdId,
    category: "CLEANING",
    amountCents,
    instructions: `E2E ${flow}`,
    scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString(),
    idempotencyKey: `e2e-${flow}-${TS}-${Math.random().toString(36).slice(2, 8)}`,
    ...extra,
  });
  const taskId = dig(r.data, "task.id", "id") ?? "";
  if (!taskId) throw new Error(`task creation failed: ${JSON.stringify(r.data).slice(0, 300)}`);
  return { taskId, jobNo: dig(r.data, "task.jobNo", "jobNo"), res: r };
}
async function dispatchTask(taskId: string) {
  const r = await req(hh, "POST", `/api/tasks/${taskId}/dispatch`, {
    vendorId: C.vendorId,
    scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString(),
    scheduledEnd: new Date(Date.now() + 29 * 3600 * 1000).toISOString(),
  });
  const t = await db.task.findUnique({ where: { id: taskId }, include: { bookings: true } });
  return { r, bookingId: t?.bookings[0]?.id ?? "" };
}
async function vendorAccept(bookingId: string) {
  return req(vendor, "PATCH", `/api/vendors/${C.vendorId}/bookings/${bookingId}`, { action: "accept" });
}
async function vendorComplete(bookingId: string, notes = "E2E completion notes") {
  // Job-completion photo gate (remote 46a3d91 feature, default ON):
  // upload a minimal "before" verification photo so `complete` passes.
  const up = await uploadGatePhoto(vendor, bookingId);
  if (up.status !== 200) {
    log(`  [GATE] photo upload failed ${up.status}: ${JSON.stringify(up.data ?? {}).slice(0, 180)}`);
  }
  return req(vendor, "PATCH", `/api/vendors/${C.vendorId}/bookings/${bookingId}`, { action: "complete", completionNotes: notes });
}
async function householdVerify(taskId: string, bookingId: string) {
  return req(hh, "POST", `/api/tasks/${taskId}/verify`, { bookingId });
}
async function householdRelease(taskId: string) {
  return req(hh, "PATCH", `/api/tasks/${taskId}/escrow`, { action: "release" });
}
async function dbTask(taskId: string) {
  return db.task.findUnique({ where: { id: taskId }, include: { bookings: true, escrowEntries: true, quotation: true } });
}

// ────────────────────────────────────────────────────────────
// FLOW 1 — User → Vendor → Ops core lifecycle
// ────────────────────────────────────────────────────────────
async function flow1() {
  const flow = "FLOW 1 · User→Vendor→Ops lifecycle";
  section(flow);

  // 1. onboarding steps
  const steps: Array<[number, Record<string, unknown> | null]> = [
    [1, null],
    [2, { homeType: "HDB", occupants: 4 }],
    [3, { adults: 2, children: 2 }],
    [4, { painPoints: ["time"] }],
    [5, { frequency: "weekly" }],
    [6, { preferredDay: "monday", preferredTime: "morning" }],
    [7, null],
    [8, null],
    [9, null],
  ];
  let okSteps = 0;
  for (const [step, data] of steps) {
    const r = await req(hh, "PATCH", "/api/household/onboarding", data ? { step, data } : { step });
    if (r.status === 200) okSteps++;
  }
  eq(flow, "Onboarding steps 1–9 accepted", okSteps, 9, `${okSteps}/9`);
  const sess2 = await req(hh, "GET", "/api/household/session");
  eq(flow, "Onboarding completed (step 9, completedAt set)", dig(sess2.data, "household.onboardingStep"), 9);

  // 2. browse services
  const jt = await req(hh, "GET", "/api/job-types?category=CLEANING");
  const jobTypes: any[] = jt.data?.jobTypes ?? jt.data ?? [];
  check(flow, "Browse service catalog (CLEANING job types)", jobTypes.length >= 1, `${jobTypes.length} types`);
  const regular = jobTypes.find((j: any) => j.slug === "cleaning-regular-maintenance") ?? jobTypes[0];
  const pricing = await req(hh, "GET", "/api/pricing");
  check(flow, "Pricing config visible to user", pricing.status === 200, `commission=${dig(pricing.data, "commissionRate")}`);

  // 3. quotation (checkout preview)
  const quote = await req(hh, "POST", "/api/quote", {
    householdId: C.householdId,
    jobTypeId: regular.id,
    fieldValues: { floorArea: 1.0 },
    selectedAddOns: ["pet_hair"],
  });
  const quotationId = dig(quote.data, "quotation.id", "id") ?? "";
  const quoteTotal = dig(quote.data, "quotation.totalCents", "totalCents") ?? 0;
  check(flow, "Quotation created ($80 base + $8 pet-hair add-on)", quote.status === 201 || (quote.status === 200 && !!quotationId), `total=${quoteTotal}c`);
  eq(flow, "Quotation total = 8800c", quoteTotal, 8800);

  // 4. booking (task creation) — with idempotency duplicate protection
  const idemKey = `e2e-f1-${TS}`;
  const t1 = await req(hh, "POST", "/api/tasks", {
    householdId: C.householdId,
    category: "CLEANING",
    amountCents: quoteTotal,
    quotationId,
    jobTypeId: regular.id,
    instructions: "E2E flow-1 booking",
    scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString(),
    idempotencyKey: idemKey,
  });
  const taskId = dig(t1.data, "task.id", "id") ?? "";
  check(flow, "Booking created from quotation (task CREATED)", t1.status === 201 && !!taskId, `jobNo=${dig(t1.data, "task.jobNo", "jobNo")}`);
  const t1dup = await req(hh, "POST", "/api/tasks", {
    householdId: C.householdId,
    category: "CLEANING",
    amountCents: quoteTotal,
    quotationId,
    jobTypeId: regular.id,
    idempotencyKey: idemKey,
  });
  eq(flow, "Idempotent re-submit returns SAME task (no duplicate booking)", dig(t1dup.data, "task.id", "id"), taskId);
  const dbt = await dbTask(taskId);
  eq(flow, "DB: task CREATED + quotation ACCEPTED", `${dbt?.status}/${dbt?.quotation?.status ?? "n/a"}`, "CREATED/ACCEPTED");

  // 5. dispatch to vendor
  const { r: disp, bookingId } = await dispatchTask(taskId);
  const afterDispatch = await dbTask(taskId);
  eq(flow, "Dispatch → task MATCHING", afterDispatch?.status, "MATCHING");
  check(flow, "Dispatch → booking assigned to vendor", !!bookingId && afterDispatch?.bookings[0]?.vendorId === C.vendorId, `booking=${bookingId.slice(-6)}`);
  const vNotifs = await db.notification.findMany({ where: { vendorId: C.vendorId, eventType: "TASK_DISPATCHED" }, select: { id: true } });
  check(flow, "Vendor notified of new booking (TASK_DISPATCHED)", vNotifs.length >= 1);

  // 6. payment → escrow materialises at vendor acceptance
  const acc = await vendorAccept(bookingId);
  check(flow, "Vendor accepts job (payment held in escrow)", acc.status === 200, `status=${acc.status}`);
  const afterAccept = await dbTask(taskId);
  const escrow = afterAccept?.escrowEntries[0];
  eq(flow, "DB: task accepted/scheduled after vendor acceptance", ["ACCEPTED", "SCHEDULED"].includes(afterAccept?.status ?? ""), true, `status=${afterAccept?.status}`);
  check(flow, "Escrow HELD created on acceptance (the payment seam)", escrow?.state === "HELD", `${escrow?.amountCents}c`);
  eq(flow, "Escrow holds full job value 8800c", escrow?.amountCents, 8800);
  eq(flow, "Commission 10% = 880c", escrow?.commissionCents, commissionOf(8800));
  eq(flow, "Vendor payout = 7920c", escrow?.vendorPayoutCents, 8800 - commissionOf(8800));
  const escrowId = escrow?.id ?? "";
  await truthCheck({ flow, label: "escrow held", hh, vendor, ops, hhEmail: C.hhEmail, hhName: C.hhName, vendorId: C.vendorId, taskId });

  // 7. job execution — F-1 (Item 8): accepted→in_progress is now a LEGAL
  // household-side transition (previously ALWAYS 409 — "in_progress" was
  // reachable only through staff share-links, leaving the portal flow with
  // an unreachable start state: photos and complete could never fire from
  // the portal). The household drives the start here, then the vendor
  // completes.
  const hhStart = await req(hh, "PATCH", `/api/bookings/${bookingId}`, { status: "in_progress" });
  eq(flow, "Household drives accepted→in_progress → 200 (F-1 unblocked)", hhStart.status, 200);
  const inprog = await dbTask(taskId);
  check(flow, "Task IN_PROGRESS after the household start", inprog?.status === "IN_PROGRESS", `status=${inprog?.status}`);
  await truthCheck({ flow, label: "execution start", hh, vendor, ops, hhEmail: C.hhEmail, hhName: C.hhName, vendorId: C.vendorId, taskId });

  // 8. completion (vendor)
  const comp = await vendorComplete(bookingId);
  const completed = await dbTask(taskId);
  eq(flow, "Vendor completes job → task COMPLETED", completed?.status, "COMPLETED");
  check(flow, "Completion notes recorded", !!completed?.bookings[0]?.completionNotes);

  // 9. verification (household owner)
  const ver = await householdVerify(taskId, bookingId);
  const verified = await dbTask(taskId);
  eq(flow, "Household verifies work → task VERIFIED", verified?.status, "VERIFIED");

  // 10. payout (escrow release)
  const rel = await householdRelease(taskId);
  const released = await dbTask(taskId);
  const escRow = released?.escrowEntries[0];
  eq(flow, "Escrow released → task ESCROW_RELEASED", released?.status, "ESCROW_RELEASED");
  eq(flow, "Escrow state RELEASED with payout", `${escRow?.state}/${escRow?.vendorPayoutCents}`, "RELEASED/7920");
  const earnDb = await vendorEarningsDb(C.vendorId);
  eq(flow, "Vendor payout credited (earnings = 7920c)", earnDb.earned, 7920);
  const earnApi = await req(vendor, "GET", `/api/vendors/${C.vendorId}/earnings`);
  eq(flow, "VENDOR environment earnings.totalEarned = 7920c", earnApi.data?.totalEarned, 7920);
  await truthCheck({ flow, label: "payout released", hh, vendor, ops, hhEmail: C.hhEmail, hhName: C.hhName, vendorId: C.vendorId, taskId });

  // ops records: audit trail
  const audits = await db.auditLog.findMany({ where: { action: "ESCROW_RELEASE" }, select: { entityId: true } });
  check(flow, "OPS record: ESCROW_RELEASE audit log entry exists (household release now audited)", audits.some((a) => a.entityId === escrowId));

  return { taskId, bookingId, escrowId };
}

// ────────────────────────────────────────────────────────────
// FLOW 2 — Add-on
// ────────────────────────────────────────────────────────────
async function flow2() {
  const flow = "FLOW 2 · Add-on";
  section(flow);
  const BASE_AMOUNT = 6000;
  const ADDON = 1500;

  // original order
  const { taskId } = await createTask("f2", BASE_AMOUNT);
  const { bookingId } = await dispatchTask(taskId);
  await vendorAccept(bookingId);
  const t0 = await dbTask(taskId);
  eq(flow, "Original order escrow HELD 6000c", t0?.escrowEntries[0]?.amountCents, BASE_AMOUNT);

  // vendor proposes add-on
  const addReq = await req(vendor, "POST", `/api/vendors/${C.vendorId}/bookings/${bookingId}/addons`, {
    description: "Extra balcony deep clean",
    amountCents: ADDON,
  });
  const addonId = dig(addReq.data, "addon.id", "id") ?? "";
  check(flow, "Vendor proposes add-on ($15)", (addReq.status === 201 || addReq.status === 200) && !!addonId, `status=${addReq.status}`);
  const hhAddonNotif = await db.notification.count({ where: { householdId: C.householdId, eventType: "ADDON_REQUESTED" } });
  check(flow, "User notified of add-on request (ADDON_REQUESTED)", hhAddonNotif >= 1);

  // household sees pending add-on
  const list = await req(hh, "GET", `/api/bookings/${bookingId}/addons`);
  const pending: any[] = (dig(list.data, "addons") ?? []).filter((a: any) => a.status === "pending");
  eq(flow, "USER sees pending add-on", pending.length, 1);

  // approve → revised total + new escrow
  const appr = await req(hh, "PATCH", `/api/bookings/${bookingId}/addons/${addonId}`, { action: "approve" });
  check(flow, "Household approves add-on", appr.status === 200, `status=${appr.status}`);
  const t1 = await dbTask(taskId);
  const esc1 = t1?.escrowEntries.find((e) => e.amountCents === ADDON);
  check(flow, "New HELD escrow entry created for add-on", esc1?.state === "HELD" && esc1?.amountCents === ADDON);
  eq(flow, "Add-on escrow commission 150c", esc1?.commissionCents, commissionOf(ADDON));
  eq(flow, "Add-on escrow payout 1350c", esc1?.vendorPayoutCents, ADDON - commissionOf(ADDON));
  const heldTotal = (t1?.escrowEntries ?? []).filter((e) => e.state === "HELD").reduce((s, e) => s + e.amountCents, 0);
  eq(flow, "Revised total held in escrow = 7500c", heldTotal, BASE_AMOUNT + ADDON);
  const userView = await req(hh, "GET", `/api/tasks/${taskId}`);
  const userAddons: any[] = dig(userView.data, "task.bookings.0.addons") ?? [];
  eq(flow, "USER task view shows approved add-on", userAddons.filter((a: any) => a.status === "approved").length, 1);
  await truthCheck({ flow, label: "addon approved (revised total)", hh, vendor, ops, hhEmail: C.hhEmail, hhName: C.hhName, vendorId: C.vendorId, taskId });

  // completion → payout includes add-on
  await vendorComplete(bookingId, "Flow-2 completion with add-on");
  await householdVerify(taskId, bookingId);
  const rel = await householdRelease(taskId);
  const t2 = await dbTask(taskId);
  eq(flow, "All escrows released (base + add-on)", (t2?.escrowEntries ?? []).every((e) => e.state === "RELEASED") && t2?.escrowEntries.length === 2, true);
  const earnDb = await vendorEarningsDb(C.vendorId);
  const expectedEarn = 7920 + 5400 + 1350; // flow1 + flow2 base + flow2 addon
  eq(flow, "Vendor payout includes add-on (cumulative earned = 14670c)", earnDb.earned, expectedEarn);
  await truthCheck({ flow, label: "payout incl. add-on", hh, vendor, ops, hhEmail: C.hhEmail, hhName: C.hhName, vendorId: C.vendorId, taskId });
  return { taskId, bookingId };
}

// ────────────────────────────────────────────────────────────
// FLOW 3 — Refund (partial)
// ────────────────────────────────────────────────────────────
async function flow3() {
  const flow = "FLOW 3 · Refund";
  section(flow);
  const AMOUNT = 8000;
  const REFUND = 3000;

  const { taskId } = await createTask("f3", AMOUNT);
  const { bookingId } = await dispatchTask(taskId);
  await vendorAccept(bookingId);
  const t0 = await dbTask(taskId);
  const escrowId = t0?.escrowEntries[0]?.id ?? "";
  eq(flow, "Order paid into escrow (HELD 8000c)", `${t0?.escrowEntries[0]?.state}/${t0?.escrowEntries[0]?.amountCents}`, `HELD/${AMOUNT}`);

  // raise dispute (gateway to refund processing)
  const dis = await req(hh, "PATCH", `/api/tasks/${taskId}/escrow`, { action: "dispute", reason: "Partial work only — requesting partial refund" });
  const t1 = await dbTask(taskId);
  eq(flow, "Dispute raised → task DISPUTED, escrow DISPUTED", `${t1?.status}/${t1?.escrowEntries[0]?.state}`, "DISPUTED/DISPUTED");
  const autonomy = await db.householdCategoryAutonomy.findFirst({ where: { householdId: C.householdId, category: "CLEANING" } });
  check(flow, "User-side effect: autonomy promotion paused during dispute", autonomy?.promotionPaused === true);

  // ops partial refund — maker-checker gate first
  const unconfirmed = await req(ops, "PATCH", `/api/ops/escrow/${escrowId}`, {
    action: "partial_refund",
    refundAmountCents: REFUND,
    resolution: "Ops reviewed: partial refund for unperformed scope",
    idempotencyKey: `e2e-pr-${TS}`,
  });
  eq(flow, "Maker-checker: unconfirmed refund blocked (409)", unconfirmed.status, 409);

  const confirmed = await req(ops, "PATCH", `/api/ops/escrow/${escrowId}`, {
    action: "partial_refund",
    refundAmountCents: REFUND,
    resolution: "Ops reviewed: partial refund for unperformed scope",
    idempotencyKey: `e2e-pr-${TS}`,
    refundConfirmed: true,
  });
  check(flow, "Ops issues partial refund $30", confirmed.status === 200, `status=${confirmed.status}`);

  // provider refund record (Stripe seam → NoOp in dev)
  const refundRow = await db.refund.findFirst({ where: { escrowLedgerId: escrowId } });
  check(flow, "Provider refund recorded (Stripe seam: NoOp dev provider)", !!refundRow && refundRow.amountCents === REFUND, `stripeId=${refundRow?.stripeRefundId} status=${refundRow?.stripeStatus}`);
  check(flow, "Refund has succeeded provider status", refundRow?.stripeStatus === "succeeded");

  // escrow adjustment
  const t2 = await dbTask(taskId);
  const e2 = t2?.escrowEntries[0];
  eq(flow, "Escrow refundCents cumulative = 3000c", e2?.refundCents, REFUND);
  eq(flow, "Escrow recomputed payout on remainder = 4500c", e2?.vendorPayoutCents, (AMOUNT - REFUND) - commissionOf(AMOUNT - REFUND));
  eq(flow, "Escrow recomputed commission = 500c", e2?.commissionCents, commissionOf(AMOUNT - REFUND));

  // user balance effect: refund-as-credit policy (F22/R3) — the refunded cash
  // becomes a REFUND_CREDIT voucher in the user's wallet
  eq(flow, "User balance: escrow refundCreditCents = 3000c (refund-as-credit)", e2?.refundCreditCents, REFUND);
  const creditVoucher = e2?.refundCreditVoucherId ? await db.voucher.findUnique({ where: { id: e2.refundCreditVoucherId } }) : null;
  check(flow, "Refund-credit voucher issued to user wallet (origin REFUND_CREDIT)", !!creditVoucher && creditVoucher.origin === "REFUND_CREDIT");
  const walletF3 = await req(hh, "GET", "/api/household/vouchers");
  check(flow, "USER wallet shows the refund-credit voucher", (dig(walletF3.data, "vouchers") ?? []).some((v: any) => v.id === creditVoucher?.id));

  // idempotency: replay the same refund key → no double refund
  const replay = await req(ops, "PATCH", `/api/ops/escrow/${escrowId}`, {
    action: "partial_refund",
    refundAmountCents: REFUND,
    resolution: "duplicate replay attempt",
    idempotencyKey: `e2e-pr-${TS}`,
    refundConfirmed: true,
  });
  const refundCount = await db.refund.count({ where: { escrowLedgerId: escrowId } });
  eq(flow, "Refund idempotency: replay does not double-refund", refundCount, 1, `replayStatus=${replay.status}`);

  // ops resolution: dismiss dispute → work stands (reduced)
  const resolve = await req(ops, "PATCH", `/api/ops/escrow/${escrowId}`, {
    action: "resolve_dismiss",
    resolution: "Core work delivered; refund retained; release remainder to vendor",
  });
  check(flow, "Ops resolves dispute (dismiss, keep remainder)", resolve.status === 200, `status=${resolve.status}`);
  const anomalyF3 = await db.anomaly.findFirst({ where: { taskId, type: "ESCROW_DISPUTED" }, orderBy: { createdAt: "desc" } });
  check(flow, "Cross-env truth: dispute anomaly auto-closed on settlement (no stale alerts)", anomalyF3?.status === "RESOLVED", `status=${anomalyF3?.status}`);
  const t3 = await dbTask(taskId);
  eq(flow, "Escrow back to HELD after ops resolution", t3?.escrowEntries[0]?.state, "HELD");
  const autonomy2 = await db.householdCategoryAutonomy.findFirst({ where: { householdId: C.householdId, category: "CLEANING" } });
  check(flow, "Autonomy unpaused after resolution", autonomy2?.promotionPaused === false);

  // user completes verification → payout of adjusted amount
  await householdVerify(taskId, bookingId);
  await householdRelease(taskId);
  const t4 = await dbTask(taskId);
  eq(flow, "Terminal: task ESCROW_RELEASED with adjusted payout", `${t4?.status}/${t4?.escrowEntries[0]?.vendorPayoutCents}`, "ESCROW_RELEASED/4500");

  // vendor payout reflects refund deduction
  const earnDb = await vendorEarningsDb(C.vendorId);
  eq(flow, "Vendor payout net of refund (cumulative earned = 19170c)", earnDb.earned, 7920 + 6750 + 4500);
  eq(flow, "Vendor earnings totalRefunded shows 3000c", earnDb.refunded, REFUND);

  // user balance/total + ops records
  const hhRow = await db.household.findUnique({ where: { id: C.householdId }, select: { totalOrders: true, totalSpentCents: true } });
  log(`  ⓘ household cached totals: orders=${hhRow?.totalOrders} spent=${hhRow?.totalSpentCents}c (final amounts: 8800+7500+8000=24300c, refunded 3000c → net 21300c)`);
  const partAudits = await db.auditLog.findMany({ where: { action: "PARTIAL_REFUND" }, select: { entityId: true } });
  check(flow, "OPS record: PARTIAL_REFUND audit log entry exists", partAudits.some((a) => a.entityId === escrowId));
  await truthCheck({ flow, label: "post-refund payout", hh, vendor, ops, hhEmail: C.hhEmail, hhName: C.hhName, vendorId: C.vendorId, taskId });
  return { taskId, escrowId };
}

// ────────────────────────────────────────────────────────────
// FLOW 4 — Dispute
// ────────────────────────────────────────────────────────────
async function flow4() {
  const flow = "FLOW 4 · Dispute";
  section(flow);
  const AMOUNT = 9000;

  const { taskId } = await createTask("f4", AMOUNT);
  const { bookingId } = await dispatchTask(taskId);
  await vendorAccept(bookingId);
  await vendorComplete(bookingId, "Flow-4 work executed");
  const t0 = await dbTask(taskId);
  eq(flow, "Order executed → task COMPLETED before dispute", t0?.status, "COMPLETED");
  const escrowId = t0?.escrowEntries[0]?.id ?? "";

  // user raises dispute
  const dis = await req(hh, "PATCH", `/api/tasks/${taskId}/escrow`, { action: "dispute", reason: "Damaged floor during service" });
  const t1 = await dbTask(taskId);
  eq(flow, "User disputes → task DISPUTED, escrow DISPUTED (completed booking stays completed)", `${t1?.status}/${t1?.escrowEntries[0]?.state}/${t1?.bookings[0]?.status}`, "DISPUTED/DISPUTED/completed");

  // vendor sees the dispute
  const vNotif = await db.notification.count({ where: { vendorId: C.vendorId, eventType: "DISPUTE_RAISED" } });
  check(flow, "Vendor notified (DISPUTE_RAISED)", vNotif >= 1);

  // ops review: disputed escrow visible in ops ledger
  const opsDis = await req(ops, "GET", `/api/ops/escrow?state=DISPUTED&search=${encodeURIComponent(C.hhEmail)}&limit=100`);
  const disEntries: any[] = (dig(opsDis.data, "entries") ?? []).filter((e: any) => e.id === escrowId);
  eq(flow, "OPS review: disputed escrow surfaced in ledger (state=DISPUTED)", disEntries.length, 1);
  eq(flow, "OPS summary counts DISPUTED escrow", (dig(opsDis.data, "summary.DISPUTED.count") ?? 0) >= 1, true);

  // vendor environment truth: disputed payout is pending (not lost, not paid)
  const earnDuring = await req(vendor, "GET", `/api/vendors/${C.vendorId}/earnings`);
  check(flow, "Vendor earnings hold disputed payout as pending", (earnDuring.data?.pendingPayout ?? 0) >= 8100, `pending=${earnDuring.data?.pendingPayout}c`);

  // ops settlement — full refund (upheld)
  const settle = await req(ops, "PATCH", `/api/ops/escrow/${escrowId}`, {
    action: "resolve_refund",
    resolution: "Dispute upheld — vendor at fault; full refund to user",
    refundConfirmed: true,
    idempotencyKey: `e2e-fr-${TS}`,
  });
  check(flow, "Ops settles dispute with full refund", settle.status === 200, `status=${settle.status}`);

  const t2 = await dbTask(taskId);
  const e2 = t2?.escrowEntries[0];
  eq(flow, "Escrow resolution → REFUNDED (full)", e2?.state, "REFUNDED");
  eq(flow, "Terminal order status → DISPUTE_CLOSED", t2?.status, "DISPUTE_CLOSED");
  eq(flow, "Payout & commission zeroed after full refund", `${e2?.vendorPayoutCents}/${e2?.commissionCents}`, "0/0");
  const refundRows = await db.refund.findMany({ where: { escrowLedgerId: escrowId } });
  eq(flow, "Full refund event recorded ($90)", refundRows.reduce((s, r) => s + r.amountCents, 0), AMOUNT);

  // terminal state is really terminal
  const verifyBlocked = await householdVerify(taskId, bookingId);
  eq(flow, "Terminal status enforced: verify rejected on DISPUTE_CLOSED (409)", verifyBlocked.status, 409);
  const releaseBlocked = await householdRelease(taskId);
  eq(flow, "Terminal status enforced: release rejected (409)", releaseBlocked.status, 409);

  // autonomy unpaused
  const autonomy = await db.householdCategoryAutonomy.findFirst({ where: { householdId: C.householdId, category: "CLEANING" } });
  check(flow, "Autonomy unpaused after terminal resolution", autonomy?.promotionPaused === false);
  const anomalyF4 = await db.anomaly.findFirst({ where: { taskId, type: "ESCROW_DISPUTED" }, orderBy: { createdAt: "desc" } });
  check(flow, "Cross-env truth: dispute anomaly auto-closed on terminal settlement", anomalyF4?.status === "RESOLVED", `status=${anomalyF4?.status}`);

  // ops records
  const auditDis = await db.auditLog.findMany({ where: { action: "DISPUTE_REFUNDED" }, select: { entityId: true } });
  check(flow, "OPS record: DISPUTE_REFUNDED audit log entry exists", auditDis.some((a) => a.entityId === escrowId));
  await truthCheck({ flow, label: "dispute settled (terminal)", hh, vendor, ops, hhEmail: C.hhEmail, hhName: C.hhName, vendorId: C.vendorId, taskId });
  return { taskId, escrowId };
}

// ────────────────────────────────────────────────────────────
// FLOW 5 — Voucher / Promotion
// ────────────────────────────────────────────────────────────
async function flow5() {
  const flow = "FLOW 5 · Voucher/Promotion";
  section(flow);
  const AMOUNT = 10000; // $100
  const DISCOUNT = 2000; // 20%

  // 1. segment: targeted user
  const seg = await req(ops, "POST", "/api/ops/marketing/segments", {
    name: `E2E Segment ${TS}`,
    description: "Targets the E2E household by name",
    filters: { nameContains: C.hhName },
  });
  const segmentId = dig(seg.data, "segment.id", "id") ?? "";
  check(flow, "Campaign → targeted user: segment created", seg.status === 201 && !!segmentId, `members=${dig(seg.data, "segment.memberCount", "memberCount")}`);
  const segMembers = await db.segmentMember.count({ where: { segmentId } });
  eq(flow, "Segment computes exactly our household", segMembers, 1);

  // 2. campaign + voucher issuance job
  const camp = await req(ops, "POST", "/api/ops/campaigns", {
    name: `E2E Cross-Sell ${TS}`,
    description: "20% off next cleaning for the E2E household",
    type: "CROSS_SELL",
    appliesTo: "JOB_COMMISSION",
    discountType: "PERCENTAGE",
    discountValue: 20,
    segmentId,
    subjectLine: "20% off your next clean",
    bodyText: "Thanks for being with us — enjoy 20% off your next cleaning.",
  });
  const campaignId = dig(camp.data, "campaign.id", "campaignId", "id") ?? "";
  const jobId = dig(camp.data, "issuanceJobId", "job.id", "jobId") ?? "";
  check(flow, "Campaign created with segment targeting → issuance job queued", (camp.status === 202 || camp.status === 201) && !!campaignId && !!jobId, `status=${camp.status}`);
  const campDb = await db.campaign.findUnique({ where: { id: campaignId } });
  eq(flow, "Campaign auto-ACTIVATED by segment linkage (DB)", campDb?.status, "ACTIVE");

  // 3. process issuance
  let jobStatus = "";
  for (let i = 0; i < 4; i++) {
    const proc = await req(ops, "POST", "/api/ops/marketing/process-issuance-job", { jobId });
    jobStatus = dig(proc.data, "job.status", "status") ?? jobStatus;
    const jstat = await db.voucherIssuanceJob.findUnique({ where: { id: jobId } });
    jobStatus = jstat?.status ?? jobStatus;
    if (jobStatus === "COMPLETED") break;
    await sleep(600);
  }
  eq(flow, "Voucher issuance job completes", jobStatus, "COMPLETED");

  // 4. user wallet shows the voucher + notification
  const wallet = await req(hh, "GET", "/api/household/vouchers");
  const vouchers: any[] = dig(wallet.data, "vouchers") ?? [];
  const myVoucher = vouchers.find((v: any) => v.campaignName === `E2E Cross-Sell ${TS}` || dig(v, "campaign.id", "campaignId") === campaignId);
  check(flow, "Targeted user: voucher lands in wallet (CLAIMED)", !!myVoucher && (myVoucher.status ?? "CLAIMED") === "CLAIMED", `code=${myVoucher?.code}`);
  const voucherId = myVoucher?.id ?? "";
  const code: string = myVoucher?.code ?? (await db.voucher.findUnique({ where: { id: voucherId }, include: { discountCode: true } }))?.discountCode.code ?? "";
  check(flow, "Voucher code surfaced to user at checkout", typeof code === "string" && code.length >= 4, `code=${code}`);
  const vNotif = await db.notification.count({ where: { householdId: C.householdId, eventType: "VOUCHER_ISSUED" } });
  check(flow, "User notified (VOUCHER_ISSUED)", vNotif >= 1);

  // eligible preview
  const elig = await req(hh, "GET", `/api/household/vouchers/eligible?orderValueCents=${AMOUNT}&category=CLEANING`);
  const eligList: any[] = dig(elig.data, "vouchers") ?? [];
  check(flow, "Checkout shows voucher as eligible for order", eligList.some((v: any) => (v.voucherId ?? v.id) === voucherId), `eligible=${eligList.length}`);

  // 5. checkout with discount
  const val = await req(hh, "POST", "/api/marketing/validate", { code, orderValueCents: AMOUNT, orderType: "job", category: "CLEANING" });
  check(flow, "Discount validation preview before checkout", val.status === 200 && (dig(val.data, "discountCents", "valid") !== undefined), `preview=${JSON.stringify(val.data).slice(0, 120)}`);
  const { taskId } = await createTask("f5", AMOUNT, { discountCode: code });
  const t0 = await dbTask(taskId);
  eq(flow, "Discount applied: task discountCents = 2000c", t0?.discountCents, DISCOUNT);
  eq(flow, "Revised order total finalAmountCents = 8000c", t0?.finalAmountCents, AMOUNT - DISCOUNT);
  const voucherRow = await db.voucher.findUnique({ where: { id: voucherId } });
  eq(flow, "Voucher marked USED at checkout", voucherRow?.status, "USED");
  const redemption = await db.codeRedemption.findFirst({ where: { taskId } });
  check(flow, "CodeRedemption audit row bound to task", !!redemption && redemption.discountAppliedCents === DISCOUNT, `applied=${redemption?.discountAppliedCents}c`);
  const campRow = await db.campaign.findUnique({ where: { id: campaignId } });
  eq(flow, "Campaign redemption counter incremented", campRow?.redemptionsCount, 1);

  // 6. payment/escrow — accounting treatment (platform-funded discount)
  const { bookingId } = await dispatchTask(taskId);
  await vendorAccept(bookingId);
  const t1 = await dbTask(taskId);
  const esc = t1?.escrowEntries[0];
  eq(flow, "Escrow holds post-discount cash 8000c", esc?.amountCents, AMOUNT - DISCOUNT);
  eq(flow, "Escrow records original (pre-discount) 10000c", esc?.originalAmountCents, AMOUNT);
  eq(flow, "Escrow records discount 2000c funded by PLATFORM", `${esc?.discountCents}/${esc?.discountFundedBy}`, `${DISCOUNT}/PLATFORM`);
  eq(flow, "Commission on full job value (payout base) = 1000c", esc?.commissionCents, commissionOf(AMOUNT));
  eq(flow, "Vendor payout on full value = 9000c (platform absorbs subsidy)", esc?.vendorPayoutCents, AMOUNT - commissionOf(AMOUNT));
  await truthCheck({ flow, label: "discounted escrow held", hh, vendor, ops, hhEmail: C.hhEmail, hhName: C.hhName, vendorId: C.vendorId, taskId });

  // 7. refund behaviour — cancel pre-completion → full refund + voucher reissue + refund credit
  const cancel = await req(hh, "POST", `/api/tasks/${taskId}/cancel`, { reason: "E2E: user cancels discounted order" });
  check(flow, "User cancels discounted order pre-completion", cancel.status === 200, `status=${cancel.status}`);
  const t2 = await dbTask(taskId);
  const esc2 = t2?.escrowEntries[0];
  eq(flow, "Escrow → REFUNDED (user's money back)", `${t2?.status}/${esc2?.state}`, "CANCELLED/REFUNDED");
  eq(flow, "Payout/commission zeroed on cancellation", `${esc2?.vendorPayoutCents}/${esc2?.commissionCents}`, "0/0");
  eq(flow, "User balance: refund-credit = post-discount cash 8000c", esc2?.refundCreditCents, AMOUNT - DISCOUNT);
  check(flow, "Escrow linked to refund-credit voucher", !!esc2?.refundCreditVoucherId && (esc2.refundCreditCents ?? 0) > 0, `credit=${esc2?.refundCreditCents}c`);

  // voucher reissue where applicable
  const restored = await db.voucher.findFirst({ where: { householdId: C.householdId, campaignId }, orderBy: { claimedAt: "desc" } });
  const anyClaimed = await db.voucher.findFirst({ where: { householdId: C.householdId, campaignId, status: "CLAIMED" } });
  check(flow, "Promo voucher reissued/restored to wallet (CLAIMED again)", !!anyClaimed, `voucherStatus=${restored?.status}`);
  const creditVoucher = esc2?.refundCreditVoucherId ? await db.voucher.findUnique({ where: { id: esc2.refundCreditVoucherId } }) : null;
  check(flow, "Refund-credit voucher issued (user's cash as platform credit)", !!creditVoucher && creditVoucher.origin === "REFUND_CREDIT", `origin=${creditVoucher?.origin} amount=??`);
  const redemptionGone = await db.codeRedemption.findFirst({ where: { taskId } });
  check(flow, "Redemption reconciled (no stale redemption for cancelled order)", !redemptionGone);

  // wallet truth: both vouchers visible to user
  const wallet2 = await req(hh, "GET", "/api/household/vouchers");
  const vouchers2: any[] = dig(wallet2.data, "vouchers") ?? [];
  const creditInWallet = vouchers2.find((v: any) => v.id === creditVoucher?.id);
  check(flow, "USER wallet shows refund-credit voucher", !!creditInWallet);
  const campaignFinal = await db.campaign.findUnique({ where: { id: campaignId }, include: { vouchers: true } });
  check(flow, "OPS campaign view consistent: voucher status matches wallet", campaignFinal?.vouchers.every((v) => v.id === voucherId ? v.status === "CLAIMED" : true) ?? false);

  return { campaignId, code, voucherId, segmentId };
}

// ────────────────────────────────────────────────────────────
// FLOW 6 — Marketing (behaviour → insight → segment → campaign → conversion → ROI)
// ────────────────────────────────────────────────────────────
async function flow6() {
  const flow = "FLOW 6 · Marketing";
  section(flow);
  const AMOUNT = 5000;
  const DISCOUNT = 1000; // $10 fixed

  // 1. user behaviour aggregates
  const beh = await req(ops, "GET", "/api/ops/marketing/behaviour");
  check(flow, "Insight engine: behaviour aggregates available", beh.status === 200, `status=${beh.status}`);
  check(flow, "Insight engine sees the E2E household (behaviour row)", JSON.stringify(beh.data).includes(C.hhName.slice(0, 20)));
  const dbOrders = await db.task.count({ where: { householdId: C.householdId, status: "ESCROW_RELEASED" } });
  log(`  ⓘ DB: household has ${dbOrders} completed+released orders (behaviour basis)`);

  // 2. insight → segment (orders-based RFM-style filter)
  const seg = await req(ops, "POST", "/api/ops/marketing/segments", {
    name: `E2E Loyal ${TS}`,
    description: "Households with ≥1 completed order",
    filters: { minOrders: 1, nameContains: C.hhName },
  });
  const segmentId = dig(seg.data, "segment.id", "id") ?? "";
  check(flow, "Segment from insight (minOrders ≥ 1 + name)", seg.status === 201 && !!segmentId);
  const segMembers = await db.segmentMember.count({ where: { segmentId } });
  eq(flow, "Segment membership = our household", segMembers, 1);

  // 3. campaign → targeted users → voucher + notification
  const camp = await req(ops, "POST", "/api/ops/campaigns", {
    name: `E2E Winback ${TS}`,
    type: "UPGRADE",
    appliesTo: "JOB_COMMISSION",
    discountType: "FIXED_AMOUNT",
    discountValue: 10,
    segmentId,
    subjectLine: "$10 off your next job",
    bodyText: "A small thank-you — $10 off your next booking.",
  });
  const campaignId = dig(camp.data, "campaign.id", "campaignId", "id") ?? "";
  const jobId = dig(camp.data, "issuanceJobId", "job.id", "jobId") ?? "";
  check(flow, "Campaign (fixed $10) queued for segment", !!campaignId && !!jobId);
  for (let i = 0; i < 4; i++) {
    await req(ops, "POST", "/api/ops/marketing/process-issuance-job", { jobId });
    const jstat = await db.voucherIssuanceJob.findUnique({ where: { id: jobId } });
    if (jstat?.status === "COMPLETED") break;
    await sleep(600);
  }
  const voucher = await db.voucher.findFirst({ where: { householdId: C.householdId, campaignId, status: "CLAIMED" } });
  check(flow, "Voucher issued to targeted user", !!voucher);
  const code = voucher ? (await db.discountCode.findUnique({ where: { id: voucher.discountCodeId } }))?.code : "";
  const campEvent = await db.campaignEvent.findFirst({ where: { campaignId, eventType: "VOUCHER_ISSUED" } });
  check(flow, "Campaign event: VOUCHER_ISSUED logged", !!campEvent);

  // 4. conversion — user checks out with the voucher
  const wallet = await req(hh, "GET", "/api/household/vouchers");
  const walletHas: any[] = dig(wallet.data, "vouchers") ?? [];
  check(flow, "USER wallet shows conversion voucher", walletHas.some((v: any) => v.id === voucher?.id));
  const { taskId } = await createTask("f6", AMOUNT, { discountCode: code });
  const t0 = await dbTask(taskId);
  eq(flow, "Conversion: discount applied (1000c)", t0?.discountCents, DISCOUNT);
  eq(flow, "Conversion: final total 4000c", t0?.finalAmountCents, AMOUNT - DISCOUNT);

  // attribution
  const attribution = await db.campaignAttribution.findFirst({ where: { campaignId, taskId } });
  check(flow, "Attribution: order linked to campaign (multi-touch row)", !!attribution, `touchpoint=${attribution?.touchpoint}`);

  // revenue: complete the job & release escrow
  const { bookingId } = await dispatchTask(taskId);
  await vendorAccept(bookingId);
  await vendorComplete(bookingId, "Flow-6 conversion job");
  await householdVerify(taskId, bookingId);
  await householdRelease(taskId);
  const t1 = await dbTask(taskId);
  eq(flow, "Conversion order completed & paid out", `${t1?.status}/${t1?.escrowEntries[0]?.state}`, "ESCROW_RELEASED/RELEASED");
  // NOTE: ORDER_PLACED / REVENUE_GENERATED are not written as CampaignEvent
  // rows on this path — the performance funnel computes them from
  // CodeRedemption + escrow joins (verified below), so ROI stays correct.
  const redeemedEvent = await db.campaignEvent.findFirst({ where: { campaignId, eventType: "VOUCHER_REDEEMED" } });
  check(flow, "Campaign events: VOUCHER_REDEEMED logged", !!redeemedEvent);

  // 5. ROI tracking
  const perf = await req(ops, "GET", `/api/ops/marketing/${campaignId}/performance`);
  check(flow, "ROI tracking: campaign performance endpoint", perf.status === 200, `status=${perf.status}`);
  const p = perf.data?.performance ?? perf.data ?? {};
  log(`  ⓘ performance payload: ${JSON.stringify(p).slice(0, 400)}`);
  const funnel = dig(p, "funnel") ?? {};
  eq(flow, "Funnel: vouchers issued = 1 (targeted 1)", funnel.vouchersIssued, 1);
  eq(flow, "Funnel: vouchers redeemed = 1 (conversion)", funnel.vouchersRedeemed, 1);
  eq(flow, "Funnel: orders generated = 1", funnel.ordersGenerated, 1);
  eq(flow, "Funnel: orders completed = 1", funnel.ordersCompleted, 1);
  const dbRevenue = t1?.escrowEntries[0]?.amountCents ?? 0; // actual cash through escrow
  eq(flow, "ROI revenue = actual released escrow cash (4000c)", funnel.revenueGeneratedCents, dbRevenue, `reported=${funnel.revenueGeneratedCents}c`);
  eq(flow, "ROI discount cost = 1000c given", funnel.discountGivenCents, DISCOUNT);
  eq(flow, "ROI net revenue = 3000c", funnel.netRevenueCents, dbRevenue - DISCOUNT);
  // voucher used
  const usedVoucher = await db.voucher.findUnique({ where: { id: voucher?.id ?? "" } });
  eq(flow, "Voucher terminal state USED", usedVoucher?.status, "USED");
  await truthCheck({ flow, label: "marketing conversion order", hh, vendor, ops, hhEmail: C.hhEmail, hhName: C.hhName, vendorId: C.vendorId, taskId });
  return { campaignId };
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────
async function main() {
  log(`Anna.I OS E2E Business Workflow Tests — ${new Date().toISOString()}`);
  log(`BASE=${BASE}  run-id=${TS}\n`);
  await setup();

  const flows: Array<[string, () => Promise<unknown>]> = [
    ["FLOW 1", flow1],
    ["FLOW 2", flow2],
    ["FLOW 3", flow3],
    ["FLOW 4", flow4],
    ["FLOW 5", flow5],
    ["FLOW 6", flow6],
  ];
  for (const [name, fn] of flows) {
    try {
      await fn();
    } catch (e) {
      check(name, "flow completed without harness exception", false, String(e).slice(0, 400));
    }
  }

  // ── summary ──
  const byFlow = new Map<string, { pass: number; fail: number }>();
  for (const r of records) {
    const cur = byFlow.get(r.flow) ?? { pass: 0, fail: 0 };
    if (r.pass) cur.pass++;
    else cur.fail++;
    byFlow.set(r.flow, cur);
  }
  log("\n━━━━━━━━━ SUMMARY ━━━━━━━━━");
  let totalPass = 0, totalFail = 0;
  for (const [f, c] of byFlow) {
    log(`${f.padEnd(46)} pass=${c.pass}  fail=${c.fail}`);
    totalPass += c.pass;
    totalFail += c.fail;
  }
  log(`TOTAL: ${totalPass} passed, ${totalFail} failed`);
  await Bun.write("e2e/report.json", JSON.stringify({ runId: TS, base: BASE, totalPass, totalFail, records }, null, 2));
  await Bun.write("e2e/trace.log", trace.join("\n"));
  await db.$disconnect();
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("HARNESS CRASH:", e);
  await Bun.write("e2e/trace.log", trace.join("\n"));
  process.exit(2);
});
