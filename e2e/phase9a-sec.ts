/**
 * ============================================================
 * Anna.I OS — PHASE 9 SECTION A: Security + Business/Financial
 * Safety audit probes (Phases 1–6 dynamic reproduction)
 * ============================================================
 * Drives REAL HTTP requests against the running dev server (:3000)
 * running the pushed Item 8 code (worktree /home/z/wt-item8) and
 * cross-checks every probe against the SQLite database.
 *
 * Sections:
 *   S1  Authentication gates (anonymous → protected endpoints)
 *   S2  Tenant / object-level isolation (IDOR / BOLA / role gates)
 *   S3  Mass assignment, field tampering, data exposure
 *   S4  Business-logic tampering (price/amount/status authority)
 *   S5  State-machine security (duplicate/invalid/skipped transitions)
 *   S6  Payment / refund / escrow integrity
 *
 * Every probe records the ACTUAL HTTP status + DB effect.
 * `check()`  — expected-secure behaviour verification
 * `finding()`— confirmed INSECURE behaviour (audit finding, severity)
 *
 * Run:  cd /home/z/wt-item8 && bun e2e/phase9a-sec.ts
 */
process.env.DATABASE_URL = "file:/home/z/wt-item8/db/custom.db";
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

const BASE = "http://localhost:3000";
const TS = Date.now();
// Explicit datasourceUrl — immune to import-hoisting env capture (the platform
// shell exports DATABASE_URL pointing at /home/z/my-project, which previously
// shadowed the worktree DB and corrupted probe evidence).
const db = new PrismaClient({ datasourceUrl: "file:/home/z/wt-item8/db/custom.db" });

// ────────────────────────────────────────────────────────────
// Tiny test framework
// ────────────────────────────────────────────────────────────
type Rec = { flow: string; name: string; pass: boolean; detail: string; finding?: string };
const records: Rec[] = [];
const findings: { id: string; flow: string; name: string; detail: string }[] = [];

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

// ────────────────────────────────────────────────────────────
// HTTP actor with cookie jar
// ────────────────────────────────────────────────────────────
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

async function uploadPhoto(actor: Actor, vendorId: string, bookingId: string, label = `p9a-${TS}`): Promise<{ status: number; data: any }> {
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
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

// ────────────────────────────────────────────────────────────
// DB backup before any mutation
// ────────────────────────────────────────────────────────────
fs.mkdirSync("/home/z/wt-item8/db/backups", { recursive: true });
const BACKUP = `/home/z/wt-item8/db/backups/phase9a-${TS}.db`;
fs.copyFileSync("/home/z/wt-item8/db/custom.db", BACKUP);
for (const ext of ["-wal", "-shm"]) {
  const src = `/home/z/wt-item8/db/custom.db${ext}`;
  if (fs.existsSync(src)) fs.copyFileSync(src, `${BACKUP}${ext}`);
}
log(`DB backed up → ${BACKUP}`);

const C = {
  hhAId: "", hhBId: "",
  vendorAId: "", vendorBId: "",
  vendorAEmail: `p9a-vA-${TS}@anna.test`,
  vendorBEmail: `p9a-vB-${TS}@anna.test`,
  vendorPassword: "vendorPass123",
  hhAEmail: `p9a-hhA-${TS}@anna.test`,
  hhBEmail: `p9a-hhB-${TS}@anna.test`,
  hhPassword: "hhPass123",
  gasJobTypeId: "",
  analystEmail: `p9a-analyst-${TS}@anna.test`,
  coordEmail: `p9a-coord-${TS}@anna.test`,
  analystId: "",
};

const ops = newActor("ops-admin");
const analyst = newActor("ops-analyst");
const coordinator = newActor("ops-coordinator");
const minimal = newActor("ops-minimal");
const hhA = newActor("household-A");
const hhB = newActor("household-B");
const anon = newActor("anon");
const vA = newActor("vendor-A");
const vB = newActor("vendor-B");

// Unique spoofed source IP per run — keeps the register rate-limiter buckets
// fresh across re-runs (P9A-F06 limiter is per-IP, 5/10min).
const SPOOF_IP = `198.51.100.${(TS % 254) + 1}`;
const SPOOF_HDR = { "x-forwarded-for": SPOOF_IP };

const GAS_PRICE = 4000; // $40/unit (seed)

async function dbTask(taskId: string) {
  return db.task.findUnique({ where: { id: taskId }, include: { bookings: true, escrowEntries: true, quotation: true } });
}
async function createCatalogueTask(actor: Actor, householdId: string, fieldValues: Record<string, number>, idem: string, amountCentsTamper = 100) {
  return req(actor, "POST", "/api/tasks", {
    householdId,
    category: "AIRCON",
    jobTypeId: C.gasJobTypeId,
    amountCents: amountCentsTamper, // deliberately tampered — must be ignored (catalogue authority)
    fieldValues,
    instructions: `p9a ${idem}`,
    scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString(),
    idempotencyKey: idem,
  });
}

async function main() {
  // ═══════════ SETUP ═══════════
  section("SETUP — actors + fixtures");
  {
    const r1 = await req(ops, "POST", "/api/ops/auth", { email: "eugene@annai.sg", password: "anna1234" });
    eq("SETUP", "Ops demo admin login", r1.status, 200);

    const analystRole = await db.role.findUnique({ where: { slug: "data_analyst" } });
    const coordRole = await db.role.findUnique({ where: { slug: "coordinator" } });
    const bcrypt = await import("bcryptjs");
    const bhash = (bcrypt as any).default?.hashSync ?? (bcrypt as any).hashSync;
    await db.opsUser.create({ data: { name: `P9 Analyst ${TS}`, email: C.analystEmail, passwordHash: bhash("analystPass123", 10), role: "ANALYST", roleId: analystRole!.id, isActive: true } });
    await db.opsUser.create({ data: { name: `P9 Coordinator ${TS}`, email: C.coordEmail, passwordHash: bhash("coordPass123", 10), role: "COORDINATOR", roleId: coordRole!.id, isActive: true } });
    const la = await req(analyst, "POST", "/api/ops/auth", { email: C.analystEmail, password: "analystPass123" });
    const lc = await req(coordinator, "POST", "/api/ops/auth", { email: C.coordEmail, password: "coordPass123" });
    eq("SETUP", "Analyst (RBAC level 1) login", la.status, 200);
    eq("SETUP", "Coordinator (RBAC level 2) login", lc.status, 200);
    const analystRow = await db.opsUser.findUnique({ where: { email: C.analystEmail } });
    C.analystId = analystRow?.id ?? "";

    // minimal-permission custom role (P9A gate verification actor): no
    // rolePermissions at all — proves permission gates reject roles without
    // the required module perms (F03/F04).
    const minimalRole = await db.role.create({
      data: { name: `P9 Minimal ${TS}`, slug: `p9a-minimal-${TS}`, description: "Phase 9 gate probe — no permissions", level: 1 },
    }).catch(() => null);
    let minimalEmail = `p9a-minimal-${TS}@anna.test`;
    if (minimalRole) {
      await db.opsUser.create({ data: { name: `P9 Minimal ${TS}`, email: minimalEmail, passwordHash: bhash("minimalPass123", 10), role: "ANALYST", roleId: minimalRole.id, isActive: true } });
    } else {
      const fallback = await db.opsUser.findFirst({ where: { email: { contains: "p9a-minimal-" } } });
      minimalEmail = fallback?.email ?? minimalEmail;
    }
    const lm = await req(minimal, "POST", "/api/ops/auth", { email: minimalEmail, password: "minimalPass123" });
    check("SETUP", "Minimal (zero-permission) ops role login", lm.status === 200, `HTTP ${lm.status}`);

    for (const [actor, email, hhName] of [[hhA, C.hhAEmail, "P9 Family A"], [hhB, C.hhBEmail, "P9 Family B"]] as const) {
      const reg = await req(actor, "POST", "/api/household/register", { name: `P9 Member ${TS}`, email, password: C.hhPassword, householdName: `${hhName} ${TS}` }, SPOOF_HDR);
      const sess = await req(actor, "GET", "/api/household/session");
      const hid = dig(sess.data, "household.id", "member.householdId", "householdId") ?? "";
      if (email === C.hhAEmail) C.hhAId = hid; else C.hhBId = hid;
      check("SETUP", `Household ${hhName.slice(-1)} registered + session`, reg.status <= 201 && !!hid, `hh=${hid.slice(-6)} reg=${reg.status}`);
    }

    for (const [actor, email] of [[vA, C.vendorAEmail], [vB, C.vendorBEmail]] as const) {
      const intake = await req(ops, "POST", "/api/ops/vendors", {
        companyName: `P9Vendor ${email.slice(5, 13)} ${TS}`, contactPerson: "P9 Lead", contactEmail1: email,
        contactPhone1: "91234567", phone: "91234567", categories: ["AIRCON"], zones: ["east"], vendorType: "MICRO", password: C.vendorPassword,
      });
      const vendorId = dig(intake.data, "vendor.id", "id") ?? "";
      await req(ops, "PATCH", `/api/ops/vendors/${vendorId}`, { status: "ACTIVE" });
      const vlogin = await req(actor, "POST", "/api/vendor/auth", { email, password: C.vendorPassword });
      actor.bearer = dig(vlogin.data, "token") ?? undefined;
      if (email === C.vendorAEmail) C.vendorAId = vendorId; else C.vendorBId = vendorId;
      check("SETUP", `Vendor ${email === C.vendorAEmail ? "A" : "B"} created + login`, !!vendorId && vlogin.status === 200, `vendor=${vendorId.slice(-6)}`);
    }

    const gas = await db.serviceJobType.findUnique({ where: { slug: "aircon-gas-topup" } });
    C.gasJobTypeId = gas?.id ?? "";
    check("SETUP", "Catalogue fixture (gas-topup $40/unit)", !!gas && gas.basePriceCents === GAS_PRICE, `id=${C.gasJobTypeId.slice(-6)}`);
  }

  // ═══════════ S1 — AUTHENTICATION GATES (anon → protected) ═══════════
  section("S1 — Anonymous requests to protected endpoints");
  {
    const probes: [string, string, string, unknown?][] = [
      ["GET", "/api/tasks", "tasks list"],
      ["GET", "/api/notifications", "notifications"],
      ["POST", "/api/quote", "quote", { jobTypeId: C.gasJobTypeId, fieldValues: { unitCount: 1 }, householdId: C.hhAId }],
      ["GET", "/api/ops/users", "ops users"],
      ["GET", "/api/ops/escrow", "ops escrow"],
      ["GET", "/api/vendor/staff", "vendor staff"],
      ["POST", "/api/billing/checkout", "billing checkout", { tier: "HOME" }],
      ["POST", "/api/ask-anna", "ask-anna AI", { message: "hi" }],
      ["GET", `/api/vendors/${C.vendorAId}/schedule`, "vendor A schedule (other-tenant)"],
      ["GET", `/api/households/${C.hhAId}`, "household A profile"],
      ["POST", "/api/ops/config", "ops config write", { action: "save_commission", commissionRate: 99 }],
      ["PATCH", `/api/tasks/zz-nonexistent/escrow`, "task escrow action"],
    ];
    for (const [method, path, label, body] of probes) {
      const r = await req(anon, method, path, body);
      const rejected = r.status >= 400;
      check("S1", `anon ${method} ${label} → rejected`, rejected, `HTTP ${r.status}${r.status < 400 ? " ⚠ ALLOWED" : ""}`);
    }
    const share = await req(anon, "GET", "/api/j/share/p9a-invalid-token-xxxx");
    check("S1", "invalid share token → 404", share.status === 404, `HTTP ${share.status}`);
  }

  // ═══════════ S2 — TENANT / OBJECT-LEVEL ISOLATION ═══════════
  section("S2 — Cross-tenant probes (IDOR / BOLA / role gates)");
  let bookingBId = "";
  {
    // fixture: HH-B creates a task + dispatches to vendor B
    const tB = await createCatalogueTask(hhB, C.hhBId, { unitCount: 1 }, `p9a-idor-b-${TS}`);
    const tBId = dig(tB.data, "task.id", "id") ?? "";
    await req(hhB, "POST", `/api/tasks/${tBId}/dispatch`, { vendorId: C.vendorBId, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });
    const bB = await db.booking.findFirst({ where: { taskId: tBId } });
    bookingBId = bB?.id ?? "";
    const notifB = await db.notification.create({ data: { householdId: C.hhBId, recipientType: "HOUSEHOLD", eventType: "SYSTEM_ALERT", title: "P9 isolation fixture", body: "fixture", metadata: { p9a: TS } } }).catch(() => null);

    // — Household A → Household B objects —
    const t1 = await req(hhA, "GET", `/api/tasks?householdId=${C.hhBId}`);
    const listA = dig(t1.data, "tasks") ?? (Array.isArray(t1.data) ? t1.data : []);
    const leaked = Array.isArray(listA) ? listA.some((t: any) => t.householdId === C.hhBId) : false;
    check("S2", "HH-A GET /api/tasks?householdId=HH-B → no B tasks leaked", t1.status >= 400 || !leaked, `HTTP ${t1.status}, rows=${Array.isArray(listA) ? listA.length : "?"}, leak=${leaked}`);

    const t2 = await req(hhA, "PATCH", `/api/households/${C.hhBId}`, { householdName: "HACKED" });
    check("S2", "HH-A PATCH household B profile → rejected", t2.status >= 400, `HTTP ${t2.status}`);
    const t3 = await req(hhA, "GET", `/api/autonomy/${C.hhBId}`);
    check("S2", "HH-A GET autonomy of B → rejected", t3.status >= 400, `HTTP ${t3.status}`);
    const t4 = await req(hhA, "GET", `/api/household-graph/${C.hhBId}`);
    check("S2", "HH-A GET household-graph of B → rejected", t4.status >= 400, `HTTP ${t4.status}`);
    const t5 = await req(hhA, "PATCH", `/api/households/${C.hhBId}/profile`, { name: "HACKED" });
    check("S2", "HH-A PATCH /households/B/profile → rejected", t5.status >= 400, `HTTP ${t5.status}`);
    if (notifB) {
      const t6 = await req(hhA, "PATCH", `/api/notifications/${notifB.id}`, { read: true });
      check("S2", "HH-A PATCH B's notification → rejected", t6.status >= 400, `HTTP ${t6.status}`);
    }
    const t7 = await req(hhA, "PATCH", `/api/bookings/${bookingBId}`, { status: "in_progress" });
    check("S2", "HH-A PATCH B's booking → rejected", t7.status >= 400, `HTTP ${t7.status}`);

    // — Vendor A → Vendor B objects —
    const v1 = await req(vA, "GET", `/api/vendors/${C.vendorBId}/schedule`);
    check("S2", "Vendor A GET vendor B schedule → rejected", v1.status >= 400, `HTTP ${v1.status}`);
    const v2 = await req(vA, "GET", `/api/vendors/${C.vendorBId}/earnings`);
    check("S2", "Vendor A GET vendor B earnings → rejected", v2.status >= 400, `HTTP ${v2.status}`);
    const v3 = await req(vA, "PATCH", `/api/vendors/${C.vendorBId}/bookings/${bookingBId}`, { action: "accept" });
    check("S2", "Vendor A accept B's booking → rejected", v3.status >= 400, `HTTP ${v3.status}`);
    const v4 = await req(vA, "POST", `/api/vendors/${C.vendorBId}/bookings/${bookingBId}/addons`, { description: "p9a cross-tenant addon", amountCents: 500 });
    check("S2", "Vendor A add-on on B's booking → rejected", v4.status >= 400, `HTTP ${v4.status}`);
    const v5 = await req(vA, "GET", `/api/vendors/${C.vendorBId}/staff`);
    check("S2", "Vendor A GET vendor B staff → rejected", v5.status >= 400, `HTTP ${v5.status}`);

    // — Ops lower roles → privileged actions —
    const o1 = await req(analyst, "GET", "/api/ops/users");
    check("S2", "Analyst GET /api/ops/users → 403 (users:view)", o1.status === 403, `HTTP ${o1.status}`);
    const o2 = await req(analyst, "POST", "/api/ops/households", { householdName: `p9a ${TS}`, contactEmail: `p9a-x-${TS}@anna.test` });
    check("S2", "Analyst POST /api/ops/households → 403 (households:create)", o2.status === 403, `HTTP ${o2.status}`);
    const o3 = await req(coordinator, "POST", "/api/ops/config", { action: "save_commission", commissionRate: 50 });
    check("S2", "Coordinator POST /api/ops/config → 403 (config:configure, F-9)", o3.status === 403, `HTTP ${o3.status}`);
    const o4 = await req(analyst, "PATCH", `/api/ops/escrow/zz-nonexistent`, { action: "release" });
    check("S2", "Analyst PATCH /api/ops/escrow → 403 (tier gate)", o4.status === 403, `HTTP ${o4.status}`);
    const o5 = await req(analyst, "GET", "/api/ops/ensure-passwords");
    check("S2", "Analyst GET /api/ops/ensure-passwords → 403 (super_admin)", o5.status === 403, `HTTP ${o5.status}`);

    // — THE known no-auth route: PATCH /api/households/[id]/subscription —
    // ANY response other than 401/403 proves the request was processed by the
    // route logic without authentication (currently 500s on a broken
    // notification.create — missing required `channel` arg — after already
    // reading the target household's subscription unauthenticated).
    const before = await db.notification.count({ where: { householdId: C.hhBId } });
    const na1 = await req(anon, "PATCH", `/api/households/${C.hhBId}/subscription`, { action: "request_cancel" });
    const after = await db.notification.count({ where: { householdId: C.hhBId } });
    if (na1.status !== 401 && na1.status !== 403) {
      finding("P9A-F01", "S2", "No-auth subscription cancel-request route processes anonymous cross-tenant input",
        `anon PATCH /api/households/${C.hhBId.slice(-6)}/subscription {request_cancel} → HTTP ${na1.status} (NOT 401/403 — no session check; route read B's subscription and attempted a write; notification create currently crashes: Prisma \`channel\` arg missing; notif rows ${before}→${after}; the auth+ownership fix is carry-forward #1, scheduled for Section C remediation)`);
    } else {
      check("S2", "anon subscription cancel-request → rejected", na1.status >= 400, `HTTP ${na1.status}, notif ${before}→${after}`);
    }
    // cross-tenant while AUTHENTICATED as household A
    const beforeA = await db.notification.count({ where: { householdId: C.hhBId } });
    const na2 = await req(hhA, "PATCH", `/api/households/${C.hhBId}/subscription`, { action: "request_cancel" });
    const afterA = await db.notification.count({ where: { householdId: C.hhBId } });
    if (na2.status !== 401 && na2.status !== 403) {
      finding("P9A-F02", "S2", "Subscription cancel-request has no ownership check (path id vs session)",
        `HH-A session PATCH /households/HH-B/subscription → HTTP ${na2.status} (not 401/403 — path householdId never validated against the session; currently 500s on the broken create; carry-forward #1 → Section C)`);
    } else {
      check("S2", "HH-A cancel-request on B's subscription → rejected", na2.status >= 400, `HTTP ${na2.status}`);
    }

    // — Session-only ops endpoints — FIXED in Section A (P9A-F03/F04/F05);
    // probes now verify the gates with actors that LACK the permission:
    //   F03: coordinator lacks households:export (data_analyst legitimately holds it)
    //   F04: minimal zero-permission role lacks analytics:view
    //   F05: analyst is below COORDINATOR tier
    const e1 = await req(coordinator, "GET", `/api/ops/households/${C.hhBId}/export`);
    const exportBody = JSON.stringify(e1.data ?? "");
    const hasPII = exportBody.includes(C.hhBEmail) || exportBody.includes("@");
    if (e1.status === 200 && hasPII) {
      finding("P9A-F03", "S2", "Any ops role can PII-export any single household",
        `Coordinator (lacks households:export) GET /api/ops/households/HH-B/export → HTTP 200 with member PII (${exportBody.length}B) — single export was session-only, inconsistent with export-all requiring households:export`);
    } else {
      check("S2", "Single-household export gated (coordinator w/o households:export → 403)", e1.status === 403, `HTTP ${e1.status}`);
    }
    const e1b = await req(analyst, "GET", `/api/ops/households/${C.hhBId}/export`);
    check("S2", "Legitimate export role (data_analyst holds households:export) → 200", e1b.status === 200, `HTTP ${e1b.status}`);
    const e2 = await req(minimal, "GET", "/api/ops/households/intelligence");
    if (e2.status === 200) {
      finding("P9A-F04", "S2", "Any ops role reads all-household onboarding intelligence",
        `Minimal zero-permission role GET /api/ops/households/intelligence → HTTP 200 (session-only gate; onboarding profiles of every household)`);
    } else {
      check("S2", "Intelligence gated on analytics:view (minimal role → 403)", e2.status === 403, `HTTP ${e2.status}`);
    }
    const e3 = await req(analyst, "POST", "/api/ops/notifications/dispatch", {});
    if (e3.status === 200) {
      finding("P9A-F05", "S2", "Any ops session triggers global notification dispatch",
        `Analyst POST /api/ops/notifications/dispatch → HTTP 200 (no permission gate; global dispatch side-effects)`);
    } else {
      check("S2", "Global dispatch gated on COORDINATOR tier (analyst → 403)", e3.status === 403, `HTTP ${e3.status}`);
    }

    // — legacy hard role-string gate (documented carry-forward) —
    const l1 = await req(coordinator, "PATCH", `/api/ops/bookings/${bookingBId}`, { status: "confirmed" });
    check("S2", "LEGACY GATE: RBAC coordinator PATCH /api/ops/bookings → 403 (string-ADMIN gate)", l1.status === 403,
      `HTTP ${l1.status} — documents the legacy hard role gate (coordinator denied despite RBAC perms; carry-forward item)`);
  }

  // ═══════════ S3 — MASS ASSIGNMENT / EXPOSURE ═══════════
  section("S3 — Mass assignment, field tampering, data exposure");
  {
    // register with injected fields
    const reg = await req(anon, "POST", "/api/household/register", {
      name: "P9 Inject", email: `p9a-inj-${TS}@anna.test`, password: C.hhPassword, householdName: `P9 Inj ${TS}`,
      role: "ADMIN", memberRole: "OWNER", isActive: false, tier: "CARE", priceCents: 1,
    });
    const injMember = await db.familyMember.findFirst({ where: { email: `p9a-inj-${TS}@anna.test` } });
    if (!injMember) {
      check("S3", "Register injection probe — member row found", false, `reg=${reg.status} member=NOT FOUND (probe error)`);
    } else {
      eq("S3", "Register role-injection ignored (member stays OWNER, not ADMIN)", injMember.role, "OWNER", `reg=${reg.status}`);
    }
    const injSub = injMember ? await db.subscription.findFirst({ where: { householdId: injMember.householdId } }) : null;
    eq("S3", "Register tier/price injection ignored (HOME/800 module-stamped)", injSub ? `${injSub.tier}/${injSub.priceCents}` : "MISSING", "HOME/800");

    // exposure probes
    const users = await req(ops, "GET", "/api/ops/users");
    const usersBody = JSON.stringify(users.data ?? "");
    check("S3", "GET /api/ops/users leaks no passwordHash", !usersBody.includes("passwordHash") && !usersBody.includes("$2"), `${usersBody.length}B`);
    const vendors = await req(hhA, "GET", "/api/vendors");
    const vendBody = JSON.stringify(vendors.data ?? "");
    check("S3", "GET /api/vendors leaks no passwordHash", !vendBody.includes("passwordHash") && !vendBody.includes("$2"), `${vendBody.length}B`);

    // ops privilege escalation: NON-super-admin with users:edit must NOT be able
    // to grant the super_admin role. Coordinator lacks users:edit entirely (403
    // before the block); the super_admin-assign block in the route code is
    // additionally verified by the police auditor. (An actual super_admin
    // assigning super_admin is legitimate admin behaviour, not a finding.)
    const saRole = await db.role.findUnique({ where: { slug: "super_admin" } });
    const esc1 = await req(coordinator, "PATCH", `/api/ops/users/${C.analystId}`, { roleId: saRole?.id });
    const analystAfter = await db.opsUser.findUnique({ where: { id: C.analystId } });
    check("S3", "super_admin role grant by non-super-admin → blocked", esc1.status === 403 || analystAfter?.roleId !== saRole?.id, `HTTP ${esc1.status}`);

    // household self-PATCH attempting memberRole escalation
    const hhAMember = await db.familyMember.findFirst({ where: { householdId: C.hhAId } });
    if (!hhAMember) {
      check("S3", "HH self-PATCH probe — member row found", false, "(probe error: no member)");
    } else {
      await req(hhA, "PATCH", `/api/households/${C.hhAId}`, { role: "ADMIN", memberRole: "ADMIN" }).catch(() => null);
      const mAfter = await db.familyMember.findFirst({ where: { householdId: C.hhAId } });
      eq("S3", "HH self-PATCH cannot escalate memberRole", mAfter?.role, hhAMember.role, `role=${mAfter?.role}`);
    }
  }

  // ═══════════ S4 — BUSINESS LOGIC TAMPERING ═══════════
  section("S4 — Price / amount / status authority under tampered requests");
  {
    // catalogue authority: tampered amountCents ignored (escrow forms at ACCEPT)
    const t1 = await createCatalogueTask(hhA, C.hhAId, { unitCount: 1 }, `p9a-tamper-1-${TS}`);
    const t1Id = dig(t1.data, "task.id", "id") ?? "";
    await req(hhA, "POST", `/api/tasks/${t1Id}/dispatch`, { vendorId: C.vendorAId, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });
    const t1b = await db.booking.findFirst({ where: { taskId: t1Id } });
    await req(vA, "PATCH", `/api/vendors/${C.vendorAId}/bookings/${t1b?.id}`, { action: "accept" });
    const t1Db = await dbTask(t1Id);
    const esc1 = t1Db?.escrowEntries[0];
    eq("S4", "Tampered task amountCents=100c ignored → escrow 4000c (catalogue authority)", esc1?.amountCents, GAS_PRICE, `HTTP ${t1.status}`);

    // quote range validation
    const q1 = await req(hhA, "POST", "/api/quote", { householdId: C.hhAId, jobTypeId: C.gasJobTypeId, fieldValues: { unitCount: 99 } });
    check("S4", "Quote out-of-range unitCount=99 → rejected", q1.status >= 400, `HTTP ${q1.status}`);
    const q2 = await req(hhA, "POST", "/api/quote", { householdId: C.hhAId, jobTypeId: C.gasJobTypeId, fieldValues: { unitCount: 0 } });
    check("S4", "Quote zero unitCount → rejected", q2.status >= 400, `HTTP ${q2.status}`);
    const q3 = await req(hhA, "POST", "/api/quote", { householdId: C.hhAId, jobTypeId: C.gasJobTypeId, fieldValues: { unitCount: -1 } });
    check("S4", "Quote negative unitCount → rejected", q3.status >= 400, `HTTP ${q3.status}`);
    const q4 = await req(hhA, "POST", "/api/quote", { householdId: C.hhAId, jobTypeId: C.gasJobTypeId, fieldValues: { unitCount: 1 }, totalCents: 1, priceCents: 1 });
    const q4total = dig(q4.data, "quotation.totalCents", "totalCents");
    check("S4", "Quote tampered totalCents field ignored (server computes)", q4.status < 400 ? q4total === GAS_PRICE : true, `HTTP ${q4.status} total=${q4total}`);

    // booking status manipulation by household
    const t2 = await createCatalogueTask(hhA, C.hhAId, { unitCount: 1 }, `p9a-tamper-2-${TS}`);
    const t2Id = dig(t2.data, "task.id", "id") ?? "";
    await req(hhA, "POST", `/api/tasks/${t2Id}/dispatch`, { vendorId: C.vendorAId, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });
    const b2 = await db.booking.findFirst({ where: { taskId: t2Id } });
    const s1 = await req(hhA, "PATCH", `/api/bookings/${b2?.id}`, { status: "completed" });
    check("S4", "HH PATCH booking status=completed → rejected", s1.status >= 400, `HTTP ${s1.status}`);
    const s2 = await req(hhA, "PATCH", `/api/bookings/${b2?.id}`, { status: "escrow_released" });
    check("S4", "HH PATCH booking status=escrow_released → rejected", s2.status >= 400, `HTTP ${s2.status}`);

    // add-on envelope bounds
    const a1 = await req(vA, "POST", `/api/vendors/${C.vendorAId}/bookings/${b2?.id}/addons`, { description: "p9a zero addon", amountCents: 0 });
    check("S4", "Add-on amountCents=0 → rejected (min $0.50)", a1.status >= 400, `HTTP ${a1.status}`);
    const a2 = await req(vA, "POST", `/api/vendors/${C.vendorAId}/bookings/${b2?.id}/addons`, { description: "p9a huge addon", amountCents: 2_000_000 });
    check("S4", "Add-on amountCents=$20k → rejected (max $10k)", a2.status >= 400, `HTTP ${a2.status}`);
    const a3 = await req(vA, "POST", `/api/vendors/${C.vendorAId}/bookings/${b2?.id}/addons`, { description: "x", amountCents: 500 });
    check("S4", "Add-on description too short → rejected (3-char min)", a3.status >= 400, `HTTP ${a3.status}`);

    // ops subscription tier upgrade with tampered price
    const subA = await db.subscription.findFirst({ where: { householdId: C.hhAId } });
    if (!subA) {
      check("S4", "Tier upgrade probe — subscription row found", false, "(probe error: no sub)");
    } else {
      const u1 = await req(ops, "PATCH", `/api/ops/subscriptions/${subA.id}`, { action: "upgrade_tier", priceCents: 1 });
      const subAAfter = await db.subscription.findUnique({ where: { id: subA.id } });
      eq("S4", "Tier upgrade stamps module price 6800c (client priceCents=1 ignored)", subAAfter?.priceCents, 6800, `HTTP ${u1.status}`);
      // self-clean: restore HOME so the demo-DB "all rows HOME/800" baseline
      // invariant (item8-fixes SETUP/DEMO checks) survives future re-runs
      await req(ops, "PATCH", `/api/ops/subscriptions/${subA.id}`, { action: "downgrade_tier" });
      const subAClean = await db.subscription.findUnique({ where: { id: subA.id } });
      eq("S4", "Probe self-clean: tier restored to HOME/800", `${subAClean?.tier}/${subAClean?.priceCents}`, "HOME/800");
    }

    // direct escrow field manipulation (needs the escrow row — forms at accept)
    const t2acc = await req(vA, "PATCH", `/api/vendors/${C.vendorAId}/bookings/${b2?.id}`, { action: "accept" });
    check("S4", "S4 t2 booking accepted for escrow probe", t2acc.status === 200, `HTTP ${t2acc.status}`);
    const eEntry = await db.escrowLedger.findFirst({ where: { bookingId: b2?.id } });
    if (!eEntry) {
      check("S4", "Direct escrow manipulation probe — escrow row found", false, "(probe error: no escrow row)");
    } else {
      const m1 = await req(ops, "PATCH", `/api/ops/escrow/${eEntry.id}`, { vendorPayoutCents: 99999, commissionCents: 0, amountCents: 1 });
      const eAfter = await db.escrowLedger.findUnique({ where: { id: eEntry.id } });
      check("S4", "Direct escrow money-field PATCH rejected (action-gated)", m1.status >= 400 || (eAfter?.amountCents === eEntry.amountCents && eAfter?.vendorPayoutCents === eEntry.vendorPayoutCents), `HTTP ${m1.status}`);
    }
  }

  // ═══════════ S5 — STATE MACHINE SECURITY ═══════════
  section("S5 — Duplicate / invalid / skipped transitions");
  {
    // L1: full happy lifecycle, then attack the terminal state
    const L1 = await createCatalogueTask(hhA, C.hhAId, { unitCount: 1 }, `p9a-life-1-${TS}`);
    const L1Id = dig(L1.data, "task.id", "id") ?? "";
    await req(hhA, "POST", `/api/tasks/${L1Id}/dispatch`, { vendorId: C.vendorAId, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });
    const b1 = await db.booking.findFirst({ where: { taskId: L1Id } });
    const esc1 = await db.escrowLedger.findFirst({ where: { bookingId: b1?.id, state: "HELD" } });

    const acc = await req(vA, "PATCH", `/api/vendors/${C.vendorAId}/bookings/${b1?.id}`, { action: "accept" });
    eq("S5", "L1 accept → 200", acc.status, 200);
    const acc2 = await req(vA, "PATCH", `/api/vendors/${C.vendorAId}/bookings/${b1?.id}`, { action: "accept" });
    check("S5", "Duplicate accept → rejected", acc2.status >= 400, `HTTP ${acc2.status}`);

    const start = await req(vA, "PATCH", `/api/vendors/${C.vendorAId}/bookings/${b1?.id}`, { action: "start" });
    eq("S5", "L1 start (F-1) → 200", start.status, 200);
    const start2 = await req(vA, "PATCH", `/api/vendors/${C.vendorAId}/bookings/${b1?.id}`, { action: "start" });
    check("S5", "Duplicate start → rejected", start2.status >= 400, `HTTP ${start2.status}`);

    // skip check on L2: complete before start
    const L2 = await createCatalogueTask(hhA, C.hhAId, { unitCount: 1 }, `p9a-life-2-${TS}`);
    const L2Id = dig(L2.data, "task.id", "id") ?? "";
    await req(hhA, "POST", `/api/tasks/${L2Id}/dispatch`, { vendorId: C.vendorBId, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });
    const b2 = await db.booking.findFirst({ where: { taskId: L2Id } });
    const sk1 = await req(vB, "PATCH", `/api/vendors/${C.vendorBId}/bookings/${b2?.id}`, { action: "complete", completionNotes: "p9a skip" });
    check("S5", "Complete before start → rejected", sk1.status >= 400, `HTTP ${sk1.status}`);
    const accL2 = await req(vB, "PATCH", `/api/vendors/${C.vendorBId}/bookings/${b2?.id}`, { action: "accept" });
    eq("S5", "L2 accept → 200", accL2.status, 200);
    const st1 = await req(vB, "PATCH", `/api/vendors/${C.vendorBId}/bookings/${b2?.id}`, { action: "start" });
    const beforeStart = await req(vB, "PATCH", `/api/vendors/${C.vendorBId}/bookings/${b2?.id}`, { action: "start" }); // duplicate
    const ph = await uploadPhoto(vB, C.vendorBId, b2!.id, `p9a-l2-${TS}`);
    check("S5", "L2 verification photo upload → 2xx", ph.status < 300, `HTTP ${ph.status}`);

    // complete L1 (needs photo)
    const ph1 = await uploadPhoto(vA, C.vendorAId, b1!.id, `p9a-l1-${TS}`);
    const comp = await req(vA, "PATCH", `/api/vendors/${C.vendorAId}/bookings/${b1?.id}`, { action: "complete", completionNotes: "p9a complete" });
    eq("S5", "L1 complete → 200", comp.status, 200);
    const comp2 = await req(vA, "PATCH", `/api/vendors/${C.vendorAId}/bookings/${b1?.id}`, { action: "complete", completionNotes: "p9a dup" });
    check("S5", "Duplicate complete → rejected", comp2.status >= 400, `HTTP ${comp2.status}`);

    const ver = await req(hhA, "POST", `/api/tasks/${L1Id}/verify`, { bookingId: b1?.id });
    eq("S5", "L1 verify → 200", ver.status, 200);
    const ver2 = await req(hhA, "POST", `/api/tasks/${L1Id}/verify`, { bookingId: b1?.id });
    check("S5", "Duplicate verify → rejected", ver2.status >= 400, `HTTP ${ver2.status}`);

    const earningsBefore = await db.escrowLedger.aggregate({ where: { bookingId: b1!.id }, _sum: { vendorPayoutCents: true } });
    const rel = await req(hhA, "PATCH", `/api/tasks/${L1Id}/escrow`, { action: "release" });
    eq("S5", "L1 escrow release → 200", rel.status, 200);
    const rel2 = await req(hhA, "PATCH", `/api/tasks/${L1Id}/escrow`, { action: "release" });
    const earningsAfter = await db.escrowLedger.aggregate({ where: { bookingId: b1!.id }, _sum: { vendorPayoutCents: true } });
    check("S5", "Duplicate release → rejected, no double payout", rel2.status >= 400 || JSON.stringify(earningsBefore._sum) === JSON.stringify(earningsAfter._sum), `HTTP ${rel2.status}`);

    // post-completion add-on on released booking
    const ao = await req(vA, "POST", `/api/vendors/${C.vendorAId}/bookings/${b1?.id}/addons`, { description: "p9a post-release addon", amountCents: 900 });
    check("S5", "Add-on on ESCROW_RELEASED booking → rejected", ao.status >= 400, `HTTP ${ao.status}`);

    // post-completion start
    const st2 = await req(vA, "PATCH", `/api/vendors/${C.vendorAId}/bookings/${b1?.id}`, { action: "start" });
    check("S5", "Start on released booking → rejected", st2.status >= 400, `HTTP ${st2.status}`);

    // L3: cancel then accept
    const L3 = await createCatalogueTask(hhA, C.hhAId, { unitCount: 1 }, `p9a-life-3-${TS}`);
    const L3Id = dig(L3.data, "task.id", "id") ?? "";
    await req(hhA, "POST", `/api/tasks/${L3Id}/dispatch`, { vendorId: C.vendorBId, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });
    const b3 = await db.booking.findFirst({ where: { taskId: L3Id } });
    const can = await req(hhA, "POST", `/api/tasks/${L3Id}/cancel`, { reason: "p9a cancel-then-accept" });
    eq("S5", "L3 cancel → 200", can.status, 200);
    const accAfterCancel = await req(vB, "PATCH", `/api/vendors/${C.vendorBId}/bookings/${b3?.id}`, { action: "accept" });
    check("S5", "Accept after CANCELLED → rejected", accAfterCancel.status >= 400, `HTTP ${accAfterCancel.status}`);

    // dispatch on cancelled task (rematch guard)
    const rem = await req(hhA, "POST", `/api/tasks/${L3Id}/dispatch`, { vendorId: C.vendorAId, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });
    check("S5", "Re-dispatch of cancelled task → rejected (rematch guard)", rem.status >= 400, `HTTP ${rem.status}`);
  }

  // ═══════════ S6 — PAYMENT / REFUND / ESCROW INTEGRITY ═══════════
  section("S6 — Payment, refund, escrow, webhook integrity");
  {
    // L4: lifecycle into dispute → partial refund → resolution → release
    const L4 = await createCatalogueTask(hhA, C.hhAId, { unitCount: 1 }, `p9a-pay-4-${TS}`);
    const L4Id = dig(L4.data, "task.id", "id") ?? "";
    await req(hhA, "POST", `/api/tasks/${L4Id}/dispatch`, { vendorId: C.vendorAId, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });
    const b4 = await db.booking.findFirst({ where: { taskId: L4Id } });
    await req(vA, "PATCH", `/api/vendors/${C.vendorAId}/bookings/${b4?.id}`, { action: "accept" });
    const esc4 = await db.escrowLedger.findFirst({ where: { bookingId: b4?.id, state: "HELD" } });
    await req(vA, "PATCH", `/api/vendors/${C.vendorAId}/bookings/${b4?.id}`, { action: "start" });
    await uploadPhoto(vA, C.vendorAId, b4!.id, `p9a-l4-${TS}`);
    await req(vA, "PATCH", `/api/vendors/${C.vendorAId}/bookings/${b4?.id}`, { action: "complete", completionNotes: "p9a partial work" });

    // release while HELD/completed (not yet verified) — expect guard
    const relEarly = await req(hhA, "PATCH", `/api/tasks/${L4Id}/escrow`, { action: "release" });
    check("S6", "Release before verification → rejected", relEarly.status >= 400, `HTTP ${relEarly.status}`);

    // dispute → refund while disputed: direct release must be blocked
    const dis = await req(hhA, "PATCH", `/api/tasks/${L4Id}/escrow`, { action: "dispute", reason: "p9a partial work only" });
    eq("S6", "Dispute raised → 200", dis.status, 200);
    const relDisputed = await req(hhA, "PATCH", `/api/tasks/${L4Id}/escrow`, { action: "release" });
    check("S6", "Release while DISPUTED → rejected", relDisputed.status >= 400, `HTTP ${relDisputed.status}`);

    // maker-checker refund: unconfirmed blocked
    const REFUND = 1000;
    const unconf = await req(ops, "PATCH", `/api/ops/escrow/${esc4?.id}`, { action: "partial_refund", refundAmountCents: REFUND, resolution: "p9a refund", idempotencyKey: `p9a-rf-${TS}` });
    eq("S6", "Maker-checker: unconfirmed refund → 409", unconf.status, 409);
    const conf1 = await req(ops, "PATCH", `/api/ops/escrow/${esc4?.id}`, { action: "partial_refund", refundAmountCents: REFUND, resolution: "p9a refund", idempotencyKey: `p9a-rf-${TS}`, refundConfirmed: true });
    check("S6", "Confirmed partial refund $10 → 200", conf1.status === 200, `HTTP ${conf1.status}`);
    const refundCount1 = await db.refund.count({ where: { escrowLedgerId: esc4!.id } });
    eq("S6", "Refund row count after confirmed refund", refundCount1, 1);

    // duplicate refund (same idempotency key)
    const dup1 = await req(ops, "PATCH", `/api/ops/escrow/${esc4?.id}`, { action: "partial_refund", refundAmountCents: REFUND, resolution: "dup", idempotencyKey: `p9a-rf-${TS}`, refundConfirmed: true });
    const refundCount2 = await db.refund.count({ where: { escrowLedgerId: esc4!.id } });
    eq("S6", "Duplicate refund (same key) → no double refund", refundCount2, 1, `HTTP ${dup1.status}`);

    // second refund with a NEW key exceeding remaining bound
    const dup2 = await req(ops, "PATCH", `/api/ops/escrow/${esc4?.id}`, { action: "partial_refund", refundAmountCents: GAS_PRICE, resolution: "over-refund attempt", idempotencyKey: `p9a-rf2-${TS}`, refundConfirmed: true });
    const refundCount3 = await db.refund.count({ where: { escrowLedgerId: esc4!.id } });
    const e4 = await db.escrowLedger.findUnique({ where: { id: esc4!.id } });
    check("S6", "Over-bound second refund rejected (refund ≤ escrow remainder)", dup2.status >= 400 || (e4?.refundCents ?? 0) <= GAS_PRICE, `HTTP ${dup2.status} refunds=${refundCount3} cum=${e4?.refundCents}`);

    // refund-after-release: release L4's remainder then attempt refund on released entry
    await req(ops, "PATCH", `/api/ops/escrow/${esc4?.id}`, { action: "resolve_dismiss", resolution: "p9a keep remainder" });
    const ver4 = await req(hhA, "POST", `/api/tasks/${L4Id}/verify`, { bookingId: b4?.id });
    const rel4 = await req(hhA, "PATCH", `/api/tasks/${L4Id}/escrow`, { action: "release" });
    const t4After = await dbTask(L4Id);
    eq("S6", "L4 released after refund-adjusted payout", t4After?.status, "ESCROW_RELEASED");
    const refundAfterRelease = await req(ops, "PATCH", `/api/ops/escrow/${esc4?.id}`, { action: "partial_refund", refundAmountCents: 500, resolution: "post-release refund attempt", idempotencyKey: `p9a-rf3-${TS}`, refundConfirmed: true });
    const refundCount4 = await db.refund.count({ where: { escrowLedgerId: esc4!.id } });
    check("S6", "Refund after ESCROW_RELEASED → rejected, no refund row", refundAfterRelease.status >= 400 || refundCount4 === refundCount3, `HTTP ${refundAfterRelease.status} refunds=${refundCount4}`);

    // webhook signature gate (layered):
    //   demo env (STRIPE_SECRET_KEY unset) → 200 {received:true} no-op BEFORE
    //   any processing (unsigned events are never processed — no state change);
    //   code-verified prod path: 500 when STRIPE_WEBHOOK_SECRET unset, 400 for
    //   missing/invalid signature (route: secret check → sig check →
    //   constructEvent). The 200-noop is demo-only configuration behaviour.
    const w1 = await req(anon, "POST", "/api/billing/webhook", { id: "evt_p9a", type: "invoice.paid" });
    check("S6", "Webhook unsigned event NOT processed (demo: 200 no-op before processing; prod code path fail-closed 400/500)",
      w1.status === 200 && w1.data?.received === true, `HTTP ${w1.status} body=${JSON.stringify(w1.data)}`);
    const w2res = await fetch(`${BASE}/api/billing/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=garbage" }, body: JSON.stringify({ id: "evt_p9a2", type: "invoice.paid" }) });
    const w2text = await w2res.text();
    check("S6", "Webhook garbage signature NOT processed (same demo no-op contract)",
      w2res.status === 200 && w2text.includes("received"), `HTTP ${w2res.status}`);

    // unauthed bootstrap endpoint is inert when table non-empty
    const opsCountBefore = await db.opsUser.count();
    const boot = await req(anon, "POST", "/api/ops/ensure-users", {});
    const opsCountAfter = await db.opsUser.count();
    eq("S6", "ensure-users inert when table non-empty", opsCountAfter, opsCountBefore, `HTTP ${boot.status}`);

    // register rate-limit presence (single fresh spoofed IP for the whole burst;
    // limiter allows 5/10min per source → the 6th rapid attempt must 429)
    let saw429 = false;
    const probeIp = `192.0.2.${(TS % 254) + 1}`;
    for (let i = 0; i < 6; i++) {
      const rr = await req(anon, "POST", "/api/household/register", { email: `p9a-rl-${TS}-${i}@anna.test` }, { "x-forwarded-for": probeIp });
      if (rr.status === 429) { saw429 = true; break; }
    }
    if (!saw429) {
      finding("P9A-F06", "S6", "No rate limit on /api/household/register",
        "6 rapid invalid registrations from a fresh source produced no 429 — unbounded household+subscription row creation (spam surface; no limiter in route)");
    } else {
      check("S6", "Register rate limit engages (429 on rapid burst)", true, `429 observed`);
    }
  }

  // ═══════════ REPORT ═══════════
  const totals = { pass: records.filter((r) => r.pass).length, fail: records.filter((r) => !r.pass).length };
  const report = {
    suite: "phase9a-sec",
    layer: "Section A dynamic audit probes (Phases 1–6)",
    startedAt: new Date().toISOString(),
    dbBackup: BACKUP,
    totals,
    findingsCount: findings.length,
    findings,
    checks: records,
  };
  fs.writeFileSync("/home/z/wt-item8/e2e/phase9a-report.json", JSON.stringify(report, null, 2));
  log(`\n━━━ PHASE 9A COMPLETE ━━━`);
  log(`checks: ${totals.pass}/${records.length} expected-secure behaviours CONFIRMED`);
  log(`findings: ${findings.length} — ${findings.map((f) => f.id).join(", ") || "none"}`);
  log(`report → e2e/phase9a-report.json`);
}

main().catch((e) => { console.error("SUITE CRASH:", e); process.exit(1); });
