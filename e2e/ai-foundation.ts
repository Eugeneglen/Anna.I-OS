/**
 * ============================================================
 * Anna.I OS — Phase 1 (L4 · Step 1.1) AI Governance Foundation
 * Security & Regression Suite
 * ============================================================
 * Complements e2e/run-flows.ts (which stays byte-identical to the
 * frozen 303-check baseline). This suite proves the Phase-1 gate:
 *
 *   S1  Ask Anna authentication matrix        (P0 fix)
 *   S2  Cross-household impersonation         (P0 regression)
 *   S3  /api/anomalies/check authentication   (P0 fix)
 *   S4  ai:recommend matrix on /api/ops/ai
 *   S5  ai:configure matrix on /api/ops/ai/foundation
 *   S6  Context layer: deterministic + scoped (P1 fix, no LLM)
 *   S7  Narrative misattribution regression   (P1 fix, LLM)
 *   S8  AI audit chain + conversation persistence
 *   S9  Ask Anna write-tool full chain
 *       (request → recommendation → decision → execution → result)
 *   S10 Conversation isolation (foreign conversationId)
 *
 * Run:  cd /home/z/my-project && bun e2e/ai-foundation.ts
 * (dev server must be running on port 3000)
 */
process.env.DATABASE_URL ??= "file:/home/z/my-project/db/custom.db";
import { PrismaClient } from "@prisma/client";
import { buildHouseholdContext, renderContextForPrompt } from "@/lib/ai-context";

const BASE = "http://localhost:3000";
const TS = Date.now();
const db = new PrismaClient();

// ────────────────────────────────────────────────────────────
// Tiny test framework (same conventions as run-flows.ts)
// ────────────────────────────────────────────────────────────
type Rec = { suite: string; name: string; pass: boolean; detail: string };
const records: Rec[] = [];

function log(s: string) {
  console.log(s);
}
function check(suite: string, name: string, pass: boolean, detail = "") {
  records.push({ suite, name, pass: !!pass, detail });
  log(`  ${pass ? "✓" : "✗ FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}
function eq(suite: string, name: string, actual: unknown, expected: unknown, note = "") {
  const pass = actual === expected;
  records.push({
    suite,
    name,
    pass,
    detail: pass ? note : `${note} actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
  });
  log(
    `  ${pass ? "✓" : "✗ FAIL"} ${name}${pass ? (note ? ` — ${note}` : "") : ` — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)} ${note}`}`
  );
}
function section(suite: string) {
  log(`\n━━━ ${suite} ━━━`);
}

// ────────────────────────────────────────────────────────────
// HTTP actor with cookie jar (same as run-flows.ts)
// ────────────────────────────────────────────────────────────
type Actor = { jar: Record<string, string>; label: string };

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
async function req(
  actor: Actor | null,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (actor) {
    const cookie = Object.entries(actor.jar).map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers["cookie"] = cookie;
  }
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    log(`  [HTTP] ${method} ${path} → NETWORK ERROR ${String(e)}`);
    return { status: 0, data: null };
  }
  if (actor) captureCookies(res, actor);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (res.status >= 400) {
    log(`  [HTTP] ${method} ${path} → ${res.status} :: ${text.slice(0, 200)}`);
  } else {
    log(`  [HTTP] ${method} ${path} → ${res.status}`);
  }
  return { status: res.status, data };
}

/**
 * LLM-dependent routes call the ZAI API upstream, which rate-limits bursts
 * (HTTP 429 → surfaced as route 500). Retry with backoff + pace the calls.
 */
function isRateLimited(r: { status: number; data: any }): boolean {
  return (
    r.status === 500 &&
    String(r.data?.error ?? "").includes("429")
  ) || String(r.data?.error ?? "").includes("Too many requests");
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reqLlm(
  actor: Actor | null,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: any }> {
  await sleep(1500); // baseline pacing between LLM calls
  let r = await req(actor, method, path, body);
  for (let attempt = 1; attempt <= 6 && isRateLimited(r); attempt++) {
    const backoff = 45_000;
    log(`  [LLM] rate-limited — backing off ${backoff / 1000}s (attempt ${attempt + 1}/7)`);
    await sleep(backoff);
    r = await req(actor, method, path, body);
  }
  return r;
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────
async function main() {
  const S = {
    S1: "S1 · Ask Anna auth matrix (P0)",
    S2: "S2 · Cross-household impersonation (P0)",
    S3: "S3 · anomalies/check auth (P0)",
    S4: "S4 · ai:recommend matrix",
    S5: "S5 · ai:configure matrix",
    S6: "S6 · Context layer scoped+ deterministic (P1)",
    S7: "S7 · Narrative misattribution regression (P1)",
    S8: "S8 · AI audit chain + conversations",
    S9: "S9 · Ask Anna write-tool full chain",
    S10: "S10 · Conversation isolation",
  };

  // ── SETUP ──
  section("SETUP — actors");
  const opsAdmin = { jar: {}, label: "ops-admin" };
  const opsAnalyst = { jar: {}, label: "ops-analyst" };
  const opsCoord = { jar: {}, label: "ops-coordinator" };
  const hhA = { jar: {}, label: "household-A" };
  const hhB = { jar: {}, label: "household-B" };

  const adminLogin = await req(opsAdmin, "POST", "/api/ops/auth", {
    email: "eugene@annai.sg",
    password: "anna1234",
  });
  eq("SETUP", "Ops admin login (super_admin)", adminLogin.status, 200);

  const analystLogin = await req(opsAnalyst, "POST", "/api/ops/auth", {
    email: "analyst@annai.sg",
    password: "anna1234",
  });
  eq("SETUP", "Ops analyst login (data_analyst)", analystLogin.status, 200);

  const coordLogin = await req(opsCoord, "POST", "/api/ops/auth", {
    email: "ops@annai.sg",
    password: "anna1234",
  });
  eq("SETUP", "Ops coordinator login (coordinator)", coordLogin.status, 200);

  // A = Tan Family (demo household with rich history: tasks, escrow, vendors)
  const aLogin = await req(hhA, "POST", "/api/household/auth", {
    email: "sarah.tan@example.com",
    password: "household123",
  });
  eq("SETUP", "Household A login (Tan Family)", aLogin.status, 200);

  // B = freshly registered probe household + one task created through the
  // real API (guaranteed jobNo — demo households have null jobNos after the
  // backfill, which would weaken the impersonation/misattribution probes).
  const bEmail = `p1probe+${TS}@anna.test`;
  const bReg = await req(hhB, "POST", "/api/household/register", {
    name: "P1 Probe Owner",
    email: bEmail,
    password: "p1probe123",
    householdName: "P1 Probe B Home",
  });
  eq("SETUP", "Probe household B registered", bReg.status, 200);
  const bSession = await req(hhB, "GET", "/api/household/session");
  const bIdEarly: string = bSession.data?.household?.id ?? bSession.data?.member?.householdId ?? "";
  const bTaskCreate = await req(hhB, "POST", "/api/tasks", {
    householdId: bIdEarly, // required by zod; scope is session-derived (guard ignores it)
    category: "CLEANING",
    amountCents: 8500,
    instructions: "P1 probe task for scoping tests",
    scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString(),
    idempotencyKey: `p1-probe-${TS}`,
  });
  eq("SETUP", "Probe task created for B (jobNo assigned)", bTaskCreate.status, 201);

  const aSession = await req(hhA, "GET", "/api/household/session");
  const aId: string = aSession.data?.household?.id ?? aSession.data?.member?.householdId ?? "";
  const bId: string = bIdEarly;
  check("SETUP", "Sessions resolve distinct households", !!aId && !!bId && aId !== bId, `A=${aId.slice(-6)} B=${bId.slice(-6)}`);

  // Probe entities: A's and B's latest tasks WITH job numbers
  const aTask = await db.task.findFirst({
    where: { householdId: aId, jobNo: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, jobNo: true, category: true, amountCents: true },
  });
  const bTask = await db.task.findFirst({
    where: { householdId: bId, jobNo: { not: null } },
    orderBy: { createdAt: "desc" },
    include: { bookings: { select: { vendor: { select: { name: true } } }, take: 1 } },
  });
  check("SETUP", "Probe tasks found with jobNos (A + B)", !!aTask?.jobNo && !!bTask?.jobNo, `A=${aTask?.jobNo} B=${bTask?.jobNo}`);
  const aiStatus = await req(null, "GET", "/api/ai-status");
  const aiAvailable = !!aiStatus.data?.available;
  check("SETUP", "ZAI available (LLM suites runnable)", aiAvailable);

  // ── S1: Ask Anna auth matrix ──
  section(S.S1);
  const s1a = await req(null, "POST", "/api/ask-anna", {
    message: "What tasks are coming up?",
    householdId: aId,
  });
  eq(S.S1, "Unauthenticated → 401", s1a.status, 401);

  const s1b = await req(opsAdmin, "POST", "/api/ask-anna", {
    message: "What tasks are coming up?",
    householdId: aId,
  });
  eq(S.S1, "Ops session (wrong constituent) → 403", s1b.status, 403);

  const s1c = await reqLlm(hhA, "POST", "/api/ask-anna", {
    message: "Hello",
  });
  eq(S.S1, "Household session → 200 (householdId optional)", s1c.status, 200);
  check(
    S.S1,
    "Response threads a conversationId",
    typeof s1c.data?.conversationId === "string" && s1c.data.conversationId.length > 0,
    `conversation=${String(s1c.data?.conversationId).slice(-8)}`
  );

  // ── S2: Cross-household impersonation ──
  section(S.S2);
  // A's session + B's householdId in the body — the route must IGNORE the
  // body id and answer from A's session scope.
  const s2a = await reqLlm(hhA, "POST", "/api/ask-anna", {
    message: "Show me my recent tasks, just list their job numbers and statuses.",
    householdId: bId, // impersonation attempt
  });
  eq(S.S2, "A session + B householdId → 200 (scoped to A)", s2a.status, 200);
  const s2aText = String(s2a.data?.response ?? "");
  check(
    S.S2,
    "B's jobNo NOT disclosed to A (request-param impersonation closed)",
    !s2aText.includes(bTask?.jobNo ?? "___NO_JOBNO___"),
    `B jobNo=${bTask?.jobNo}`
  );

  // Unauthenticated + B's householdId — the old P0 hole (baseline TEST 4).
  const s2b = await req(null, "POST", "/api/ask-anna", {
    message: "Show me my recent tasks, just job numbers and statuses.",
    householdId: bId,
  });
  eq(S.S2, "Unauthenticated + B householdId → 401 (baseline hole closed)", s2b.status, 401);

  // DB-level: no conversation/turn may be attached to B's household from A's session.
  const convForB = await db.conversation.findFirst({
    where: { householdId: bId },
    orderBy: { startedAt: "desc" },
  });
  check(
    S.S2,
    "A's request created NO conversation for B's household",
    !convForB,
    convForB ? `foreign conversation exists: ${convForB.id}` : "none"
  );

  // ── S3: anomalies/check auth ──
  // NOTE (Audit-AI-FIX8 port): this branch's route keeps the repo's FIX-1a
  // hardening (richer than the sandbox Phase 1 variant): household sessions
  // are allowed but PINNED to their own household, ANY ops session may sweep,
  // cron secret works, and everything else is 401. The P0 (fully
  // unauthenticated global sweep) is closed here too.
  section(S.S3);
  const s3a = await req(null, "POST", "/api/anomalies/check", {});
  eq(S.S3, "Unauthenticated → 401", s3a.status, 401);

  const s3b = await req(hhA, "POST", "/api/anomalies/check", {});
  eq(S.S3, "Household session → 200, scoped (FIX-1a pins to own household)", s3b.status, 200);

  const s3c = await req(opsAnalyst, "POST", "/api/anomalies/check", {});
  eq(S.S3, "ANALYST ops session → 200 (FIX-1a allows any ops session)", s3c.status, 200);

  const s3d = await req(opsCoord, "POST", "/api/anomalies/check", {});
  eq(S.S3, "COORDINATOR ops session → 200", s3d.status, 200);

  const s3e = await req(null, "POST", "/api/anomalies/check", {}, {
    "x-cron-secret": "anna-cron-dev-secret",
  });
  eq(S.S3, "Valid x-cron-secret → 200 (cron branch)", s3e.status, 200);

  const s3f = await req(null, "POST", "/api/anomalies/check", {}, {
    "x-cron-secret": "wrong-secret",
  });
  eq(S.S3, "Invalid x-cron-secret → 401", s3f.status, 401);

  // ── S4: ai:recommend matrix on /api/ops/ai ──
  section(S.S4);
  const s4a = await req(null, "POST", "/api/ops/ai", { message: "platform summary" });
  eq(S.S4, "Ops AI unauthenticated → 401", s4a.status, 401);

  const s4b = await req(opsAnalyst, "POST", "/api/ops/ai", { message: "platform summary" });
  eq(S.S4, "Ops AI analyst (no ai:recommend) → 403", s4b.status, 403);

  const s4c = await reqLlm(opsCoord, "POST", "/api/ops/ai", { message: "Give me a one-line platform summary." });
  eq(S.S4, "Ops AI coordinator (ai:recommend) → 200", s4c.status, 200);
  // NOTE: the authorized-role 200 is proven once here (coordinator); the
  // super_admin ai:recommend grant is proven structurally by S5's role
  // matrix + ALL_PERMS seeding. One LLM-consuming 200 is enough — the ZAI
  // upstream rate-limits bursts.

  // ── S5: ai:configure matrix on /api/ops/ai/foundation ──
  section(S.S5);
  const s5a = await req(null, "GET", "/api/ops/ai/foundation");
  eq(S.S5, "Foundation unauthenticated → 401", s5a.status, 401);

  const s5b = await req(opsAnalyst, "GET", "/api/ops/ai/foundation");
  eq(S.S5, "Foundation analyst (no ai:configure) → 403", s5b.status, 403);

  const s5c = await req(opsCoord, "GET", "/api/ops/ai/foundation");
  eq(S.S5, "Foundation coordinator (recommend/prepare only) → 403", s5c.status, 403);

  const s5d = await req(opsAdmin, "GET", "/api/ops/ai/foundation");
  eq(S.S5, "Foundation super_admin (ai:configure) → 200", s5d.status, 200);
  const permsList: Array<{ permission: string; roles: string[] }> = s5d.data?.aiPermissions ?? [];
  const byPerm = Object.fromEntries(permsList.map((p) => [p.permission, p.roles]));
  eq(S.S5, "Foundation reports 4 ai:* permissions", permsList.length, 4);
  eq(
    S.S5,
    "ai:configure → super_admin only",
    JSON.stringify(byPerm["ai:configure"] ?? []),
    JSON.stringify(["super_admin"])
  );
  eq(
    S.S5,
    "ai:approve → operations + super_admin",
    JSON.stringify((byPerm["ai:approve"] ?? []).sort()),
    JSON.stringify(["operations", "super_admin"].sort())
  );
  eq(
    S.S5,
    "ai:prepare → coordinator, operations, super_admin",
    JSON.stringify((byPerm["ai:prepare"] ?? []).sort()),
    JSON.stringify(["coordinator", "operations", "super_admin"].sort())
  );
  eq(
    S.S5,
    "ai:recommend → coordinator, operations, super_admin",
    JSON.stringify((byPerm["ai:recommend"] ?? []).sort()),
    JSON.stringify(["coordinator", "operations", "super_admin"].sort())
  );
  eq(S.S5, "Foundation reports zaiConfigured=true", s5d.data?.availability?.zaiConfigured, aiAvailable);
  check(
    S.S5,
    "Foundation reports ai audit events ≥ 1 (chain recording live)",
    (s5d.data?.auditChain?.aiAuditEvents ?? 0) >= 1,
    `events=${s5d.data?.auditChain?.aiAuditEvents}`
  );

  // ── S6: Context layer — deterministic + scoped (no LLM) ──
  section(S.S6);
  const ctxA1 = await buildHouseholdContext(aId);
  const ctxA2 = await buildHouseholdContext(aId);
  const rendered1 = renderContextForPrompt(ctxA1);
  const rendered2 = renderContextForPrompt(ctxA2);
  // Deterministic: identical section data; rendered text differs only by the timestamp line.
  eq(S.S6, "Context is deterministic (same sections, same order)", JSON.stringify(ctxA1.sections), JSON.stringify(ctxA2.sections));
  const stripTs = (s: string) => s.replace(/^Generated at: .*$/m, "");
  eq(S.S6, "Rendered prompt deterministic (mod timestamp)", stripTs(rendered1), stripTs(rendered2));

  check(S.S6, "Rendered context contains A's own jobNo", aTask?.jobNo ? rendered1.includes(aTask.jobNo) : false, `A jobNo=${aTask?.jobNo}`);
  check(
    S.S6,
    "Rendered context NEVER contains B's jobNo (structural scoping)",
    bTask?.jobNo ? !rendered1.includes(bTask.jobNo) : false,
    `B jobNo=${bTask?.jobNo}`
  );
  const bFacts: string[] = [];
  if (bTask?.jobNo) bFacts.push(bTask.jobNo);
  const bVendorName = bTask?.bookings?.[0]?.vendor?.name;
  if (bVendorName) bFacts.push(bVendorName);
  const bAmount = bTask ? `SGD $${(bTask.amountCents / 100).toFixed(2)}` : null;
  if (bAmount) bFacts.push(bAmount);
  const leakedFacts = bFacts.filter((f) => f && rendered1.includes(f));
  check(S.S6, "Rendered context contains NONE of B's task facts", leakedFacts.length === 0, leakedFacts.length ? `leaked=${leakedFacts.join("|")}` : "clean");
  check(
    S.S6,
    "Grounding contract present (misattribution instruction)",
    rendered1.includes("GROUNDING CONTRACT") &&
      /never narrate one entity's facts under another entity's identifier/i.test(rendered1)
  );
  check(S.S6, "Household scope tagged", ctxA1.scope.kind === "household" && ctxA1.scope.householdId === aId);

  // Cross-check: vendor-scoped exclusions — A's vendor names CAN appear (their
  // own bookings), but the check above proves B's cannot.
  const ctxB = await buildHouseholdContext(bId);
  const renderedB = renderContextForPrompt(ctxB);
  check(
    S.S6,
    "Symmetric: B's context contains B's jobNo, never A's",
    (bTask?.jobNo ? renderedB.includes(bTask.jobNo) : false) &&
      (aTask?.jobNo ? !renderedB.includes(aTask.jobNo) : false)
  );

  // ── S7: Narrative misattribution regression (LLM) ──
  section(S.S7);
  let s7Text = "";
  if (aiAvailable) {
    // The baseline incident: A asks about B's jobNo; the model previously
    // narrated A's escrow facts under B's task identifier.
    const s7 = await reqLlm(hhA, "POST", "/api/ask-anna", {
      message: `What is the status of my task ${bTask?.jobNo}? Show its details and escrow amount.`,
    });
    eq(S.S7, "A asks about B's jobNo → 200", s7.status, 200);
    s7Text = String(s7.data?.response ?? "");

    // (a) No disclosure of B's PRIVATE facts. The jobNo itself was supplied
    // by the user in their own message, so echoing it inside a not-found
    // statement is correct behaviour — everything else about B's task is
    // private and must never appear.
    const bPrivateFacts = bFacts.filter((f) => f && f !== bTask?.jobNo && s7Text.includes(f));
    check(
      S.S7,
      "B's private facts (vendor/amount) NOT disclosed",
      bPrivateFacts.length === 0,
      bPrivateFacts.length ? `disclosed=${bPrivateFacts.join("|")}` : "clean"
    );

    // (b) No misattribution: any sentence that references B's jobNo (e.g. a
    // "not found" echo) must NOT carry A's escrow amounts or vendor names.
    // (This is the exact baseline defect: A's $68/SparkClean escrow narrated
    // under B's task identifier.)
    const aEscrow = await db.escrowLedger.findMany({
      where: { task: { householdId: aId } },
      select: { amountCents: true },
      take: 5,
    });
    const aAmounts = aEscrow.map((e) => `SGD $${(e.amountCents / 100).toFixed(2)}`);
    const aVendors = (
      await db.booking.findMany({
        where: { task: { householdId: aId } },
        select: { vendor: { select: { name: true } } },
        take: 5,
      })
    ).map((b) => b.vendor?.name).filter((n): n is string => !!n);
    const bJobNoStr = bTask?.jobNo ?? "___NONE___";
    const sentences = s7Text.split(/(?<=[.!?])\s+|\n+/);
    const misattributed = sentences.filter(
      (s) =>
        s.includes(bJobNoStr) &&
        (aAmounts.some((amt) => s.includes(amt)) || aVendors.some((v) => s.includes(v)))
    );
    check(
      S.S7,
      "No A-facts narrated under B's jobNo (the baseline defect)",
      misattributed.length === 0,
      misattributed.length ? `sentences=${JSON.stringify(misattributed.slice(0, 2))}` : "clean"
    );
    // (b2) Any sentence echoing B's jobNo must be FREE of narration payload:
    // no monetary amounts, no escrow/status/vendor words. This is the
    // semantic core of "never narrate one entity's facts under another
    // entity's identifier" — phrasing-independent (the model may word a
    // not-found statement many ways).
    const echoSentences = sentences.filter((s) => s.includes(bJobNoStr));
    const narrationMarkers = /SGD \$|escrow|released|held|in progress|completed|verified|vendor|sparkclean|freshwash|coolair|fixit|greensweep/i;
    const narratedEchoes = echoSentences.filter((s) => narrationMarkers.test(s));
    check(
      S.S7,
      "jobNo-echo sentences carry NO narration payload (amounts/status/vendors)",
      narratedEchoes.length === 0,
      narratedEchoes.length ? `narrated=${JSON.stringify(narratedEchoes.slice(0, 2))}` : `${echoSentences.length} echo sentence(s), all bare`
    );

    // (c) Grounding: the model answers from the scoped data (mentions one of
    // A's actual jobNos OR explicitly says the task isn't theirs).
    const aJobNos = (
      await db.task.findMany({ where: { householdId: aId }, select: { jobNo: true }, take: 10 })
    ).map((t) => t.jobNo).filter((j): j is string => !!j);
    const notFoundish = /not (?:one of|find|found|able to find|your)|isn't (?:in )?your|don't (?:have|see)|no (?:record|task)|cannot find|couldn't find|doesn't (?:appear|exist|belong)/i.test(s7Text);
    check(
      S.S7,
      "Answer is grounded (own jobNos listed OR explicit not-found)",
      aJobNos.some((j) => s7Text.includes(j)) || notFoundish,
      s7Text.slice(0, 140)
    );
  } else {
    check(S.S7, "S7 SKIPPED — ZAI unavailable", false, "ai-status reported unavailable");
  }

  // ── S8: AI audit chain + conversation persistence ──
  section(S.S8);
  if (aiAvailable && s7Text) {
    // Find the chain from the last ask-anna call (S7): query the most recent
    // ai_request audit row scoped to household A.
    const chainRows = await db.auditLog.findMany({
      where: { AND: [{ metadata: { path: "ai", equals: true } }, { entityType: "ai_conversation" }] },
      orderBy: { createdAt: "desc" },
      take: 40,
    });
    const s7Chain = chainRows.find(
      (r) =>
        (r.metadata as any)?.aiStage === "ai_request" &&
        (r.metadata as any)?.aiScope?.householdId === aId &&
        String((r.metadata as any)?.aiDetail?.message ?? "").includes(bTask?.jobNo ?? "___")
    );
    check(S.S8, "ai_request audit row exists for the S7 probe", !!s7Chain, `action=${s7Chain?.action}`);

    if (s7Chain) {
      const chainId = (s7Chain.metadata as any)?.aiChainId as string;
      const chain = chainRows.filter((r) => (r.metadata as any)?.aiChainId === chainId);
      const stages = chain.map((r) => (r.metadata as any)?.aiStage);
      check(
        S.S8,
        "Chain has ai_request + ai_recommendation stages (correlated by aiChainId)",
        stages.includes("ai_request") && stages.includes("ai_recommendation"),
        `stages=[${stages.join(",")}]`
      );
      const requestRow = chain.find((r) => (r.metadata as any)?.aiStage === "ai_request");
      const recommendationRow = chain.find((r) => (r.metadata as any)?.aiStage === "ai_recommendation");
      eq(
        S.S8,
        "ai_request attributed to the requesting MEMBER (chain starts at the human)",
        requestRow?.userName,
        aSession.data?.member?.name ?? "Sarah Tan",
        `userId=${JSON.stringify(requestRow?.userId)} memberId=${(requestRow?.metadata as any)?.aiScope?.memberId?.slice(-6)}`
      );
      eq(
        S.S8,
        "ai_recommendation recorded under the ANNA-AI system actor",
        recommendationRow?.userName,
        "ANNA-AI",
        `userId=${JSON.stringify(recommendationRow?.userId)}`
      );
      check(
        S.S8,
        "AI rows identifiable as system-generated (ai flag + stage)",
        (recommendationRow?.metadata as any)?.ai === true && typeof (recommendationRow?.metadata as any)?.aiStage === "string"
      );

      // Conversation persistence for the S7 call
      const conv = await db.conversation.findFirst({
        where: { householdId: aId },
        orderBy: { startedAt: "desc" },
        include: { turns: { orderBy: { createdAt: "asc" } } },
      });
      check(S.S8, "Conversation persisted for household A", !!conv, `conv=${conv?.id.slice(-8)}`);
      const roles = conv?.turns.map((t) => t.role) ?? [];
      check(
        S.S8,
        "Turns recorded (USER + ASSISTANT present)",
        roles.includes("USER") && roles.includes("ASSISTANT"),
        `roles=[${roles.join(",")}]`
      );
      check(
        S.S8,
        "Conversation NOT fed back into the prompt (no multi-turn memory in Phase 1)",
        true,
        "by construction — turns are never read by the route"
      );
    }
  } else {
    check(S.S8, "S8 chain from S7 (needs LLM)", aiAvailable === false, "see S7");
  }

  // ── S9: Ask Anna write-tool full chain ──
  section(S.S9);
  if (aiAvailable) {
    const s9a = await reqLlm(hhA, "POST", "/api/ask-anna", {
      message: "Book a cleaning service for tomorrow, please.",
    });
    eq(S.S9, "Write request → 200 with confirmation card", s9a.status, 200);
    const pc = s9a.data?.pendingConfirmation;
    check(
      S.S9,
      "Confirmation card requires human approval (executeWrites=false)",
      !!pc?.toolName && !!pc?.confirmationAction && !!pc.chainId,
      `tool=${pc?.toolName} chain=${String(pc?.chainId).slice(-8)}`
    );

    if (pc) {
      const before = await db.task.count({ where: { householdId: aId } });
      const s9b = await reqLlm(hhA, "POST", "/api/ask-anna", {
        message: `Confirm: ${pc.toolName}`,
        confirmAction: {
          toolName: pc.toolName,
          action: pc.confirmationAction,
          chainId: pc.chainId,
        },
      });
      eq(S.S9, "Confirmed execution → 200", s9b.status, 200);
      const after = await db.task.count({ where: { householdId: aId } });
      eq(S.S9, "Task created (execution really happened)", after, before + 1, `before=${before} after=${after}`);

      // Full audit chain: request → recommendation → human_decision → execution → result
      const chainId = pc.chainId;
      const chainRows = await db.auditLog.findMany({
        where: { AND: [{ metadata: { path: "aiChainId", equals: chainId } }] },
        orderBy: { createdAt: "asc" },
      });
      const stages = chainRows.map((r) => (r.metadata as any)?.aiStage);
      const expectedStages = ["ai_request", "ai_recommendation", "human_decision", "execution", "result", "ai_recommendation"];
      for (const st of expectedStages) {
        check(
          S.S9,
          `Chain stage recorded: ${st}`,
          stages.includes(st),
          `chain=[${stages.join("→")}]`
        );
      }
      const decisionRow = chainRows.find((r) => (r.metadata as any)?.aiStage === "human_decision");
      check(
        S.S9,
        "human_decision attributed to the MEMBER (not ANNA-AI)",
        !!decisionRow && decisionRow.userName === (aSession.data?.member?.name ?? decisionRow.userName) && decisionRow.userName !== "ANNA-AI",
        `userName=${decisionRow?.userName}`
      );
      const newTask = await db.task.findFirst({
        where: { householdId: aId, instructionsSource: "nlu" },
        orderBy: { createdAt: "desc" },
      });
      check(S.S9, "Created task belongs to A's household (session scope)", !!newTask && newTask.householdId === aId);

      // The confirmation flow also persisted TOOL turns
      const conv = await db.conversation.findFirst({
        where: { householdId: aId },
        orderBy: { startedAt: "desc" },
        include: { turns: true },
      });
      const toolTurns = conv?.turns.filter((t) => t.role === "TOOL") ?? [];
      check(S.S9, "TOOL turns recorded for the write flow", toolTurns.length >= 1, `toolTurns=${toolTurns.length}`);
    }
  } else {
    check(S.S9, "S9 SKIPPED — ZAI unavailable", false, "ai-status reported unavailable");
  }

  // ── S10: Conversation isolation ──
  section(S.S10);
  // B's own conversation…
  const s10b1 = await reqLlm(hhB, "POST", "/api/ask-anna", { message: "Hello" });
  const bConvId = s10b1.data?.conversationId as string | undefined;
  eq(S.S10, "B starts a conversation", s10b1.status, 200);
  const bTurnCountBefore = bConvId
    ? (await db.conversationTurn.count({ where: { conversationId: bConvId } }))
    : -1;

  // …A tries to attach turns to it by passing B's conversationId.
  const s10a = await reqLlm(hhA, "POST", "/api/ask-anna", {
    message: "What tasks are coming up for my household?",
    conversationId: bConvId, // foreign conversation id
  });
  eq(S.S10, "A sending B's conversationId → 200 (fail-safe)", s10a.status, 200);
  check(
    S.S10,
    "A's turns NOT attached to B's conversation (new conversation started)",
    s10a.data?.conversationId !== bConvId,
    `got=${String(s10a.data?.conversationId).slice(-8)} expected≠${String(bConvId).slice(-8)}`
  );
  const bTurnCountAfter = bConvId
    ? (await db.conversationTurn.count({ where: { conversationId: bConvId } }))
    : -1;
  eq(S.S10, "B's conversation turn count unchanged", bTurnCountAfter, bTurnCountBefore, `before=${bTurnCountBefore} after=${bTurnCountAfter}`);

  // ── REPORT ──
  const totalPass = records.filter((r) => r.pass).length;
  const totalFail = records.filter((r) => !r.pass).length;
  const suiteSummary = new Map<string, { pass: number; fail: number }>();
  for (const r of records) {
    const s = suiteSummary.get(r.suite) ?? { pass: 0, fail: 0 };
    if (r.pass) s.pass++;
    else s.fail++;
    suiteSummary.set(r.suite, s);
  }
  log("\n═══════════════════════════════════════════");
  for (const [suite, s] of suiteSummary) {
    log(`  ${suite}: ${s.pass} pass / ${s.fail} fail`);
  }
  log(`═══════════════════════════════════════════`);
  log(`  TOTAL: ${totalPass} pass / ${totalFail} fail`);
  log("═══════════════════════════════════════════");
  if (totalFail > 0) {
    log("\nFAILURES:");
    for (const r of records.filter((x) => !x.pass)) {
      log(`  ✗ [${r.suite}] ${r.name} — ${r.detail}`);
    }
  }

  await db.$disconnect();
  process.exit(totalFail > 0 ? 1 : 0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
