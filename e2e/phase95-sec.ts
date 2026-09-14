/**
 * ============================================================
 * Anna.I OS — PHASE 9.5: NLU Confirm-Pass Replay (CF#10 fix)
 * ============================================================
 * Against the running dev server (:3000) on the item8-report
 * worktree (/home/z/wt-item8). Phase 9 Section C classified
 * CF#10 (P2): "Double-confirming an AI card can create a second
 * task." Phase 9.5 implements the recommended fix — the card's
 * deterministic chainId is threaded as the task idempotencyKey —
 * and this suite proves the required properties LIVE:
 *
 *   N1  sequential double-confirm of ONE card → exactly 1 task
 *   N2  true-parallel double-confirm (Promise.all) → exactly 1 task
 *   N3  exactly ONE financial action/escrow for the surviving task
 *       (dispatch+accept forms escrow; a post-escrow replay changes
 *       nothing)
 *   N4  repeated confirmation RETURNS the existing result
 *       (same taskId/jobNo, idempotentReplay flag)
 *   N5  unrelated AI cards (new chainId) still create their OWN
 *       tasks
 *   N6  idempotency scope: cross-household reuse of a chainId does
 *       NOT block or leak another household's booking
 *   N7  regression guards: the tampered-card catalogue
 *       re-verification (ai-contract B4b semantics) still REFUSES
 *       with a chainId attached; the key grants no authority
 *
 * Provider-independent: every LLM response is served through the
 * deterministic stub seam (ANNA_LLM_STUB_DIR/ACTIVE); per-scenario
 * stub-attempt counts are asserted non-empty (N0 column) — zero
 * live-provider calls by construction.
 *
 * Run:  cd /home/z/wt-item8 && DATABASE_URL=file:/home/z/wt-item8/db/custom.db bun e2e/phase95-sec.ts
 */
process.env.DATABASE_URL = "file:/home/z/wt-item8/db/custom.db";
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import { execSync } from "child_process";

const BASE = "http://localhost:3000";
const TS = Date.now();
const db = new PrismaClient({ datasourceUrl: "file:/home/z/wt-item8/db/custom.db" });
const STUB_DIR = "/tmp/anna-llm-stub";
const GAS_PRICE = 4000; // $40/unit (seed fixture)

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

// ────────────────────────────────────────────────────────────
// LLM stub control (the server-side seam reads these files)
// ────────────────────────────────────────────────────────────
function stubEnable() {
  fs.mkdirSync(STUB_DIR, { recursive: true });
  fs.writeFileSync(`${STUB_DIR}/ACTIVE`, new Date().toISOString());
}
function stubDisable() { try { fs.rmSync(`${STUB_DIR}/ACTIVE`); } catch { /* gone */ } }
function stubBegin(steps: unknown[]) {
  fs.writeFileSync(`${STUB_DIR}/script.json`, JSON.stringify({ steps }, null, 2));
  fs.writeFileSync(`${STUB_DIR}/cursor.json`, JSON.stringify({ n: 0 }));
  try { fs.rmSync(`${STUB_DIR}/calls.jsonl`); } catch { /* first call */ }
}
function stubCalls(): { ts: string; fn: string; attempt: number; outcome: string; latencyMs: number }[] {
  try {
    return fs.readFileSync(`${STUB_DIR}/calls.jsonl`, "utf8")
      .split("\n").filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
  } catch { return []; }
}
function expectStubbed(flow: string, name: string, minCalls = 1) {
  const calls = stubCalls();
  check(flow, name, calls.length >= minCalls,
    `stub attempts=${calls.length} [${calls.map((c) => c.outcome).join(",")}]`);
}
function toolStep(name: string, args: unknown) {
  return {
    response: {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: `call_${name.replace(/[^a-z0-9]/gi, "")}`, type: "function", function: { name, arguments: JSON.stringify(args) } },
            ],
          },
        },
      ],
    },
  };
}
function textStep(text: string) { return { assistantText: text }; }

// ────────────────────────────────────────────────────────────
// Fixtures + state
// ────────────────────────────────────────────────────────────
const C = {
  hhAEmail: `p95-a-${TS}@anna.test`,
  hhBEmail: `p95-b-${TS}@anna.test`,
  hhPassword: "hhPass123",
  hhAId: "",
  hhBId: "",
  vendorId: "",
  vendorEmail: `p95-vendor-${TS}@anna.test`,
  vendorPassword: "vendorPass123",
  gasJobTypeId: "",
};

async function askAnna(actor: Actor, message: string, confirmAction?: unknown): Promise<{ status: number; data: any }> {
  return req(actor, "POST", "/api/ask-anna", { message, ...(confirmAction ? { confirmAction } : {}) });
}
async function tasksByMarker(marker: string) {
  return db.task.findMany({ where: { instructions: marker }, select: { id: true, jobNo: true, idempotencyKey: true, householdId: true, amountCents: true } });
}
async function escrowRowsForTask(taskId: string) {
  const booking = await db.booking.findFirst({ where: { taskId } });
  return db.escrowLedger.findMany({ where: booking ? { bookingId: booking.id } : { taskId } });
}

async function main() {
  log(`━━━ PHASE 9.5 — NLU CONFIRM-PASS REPLAY · ${new Date().toISOString()} ━━━`);
  log(`stub dir: ${STUB_DIR}`);

  const dbFile = "/home/z/wt-item8/db/custom.db";
  const backupFile = `/home/z/wt-item8/db/backups/p95-${TS}.db`;
  execSync(`mkdir -p /home/z/wt-item8/db/backups && cp ${dbFile} ${backupFile}`);
  log(`DB backed up → ${backupFile}`);
  stubEnable(); // from here until finally: every LLM call is scripted

  const ops = newActor("ops-admin");
  const hhA = newActor("household-A");
  const hhB = newActor("household-B");
  const vA = newActor("vendor-AIRCON");

  try {
    // ══════════════════════════ SETUP ══════════════════════════
    section("SETUP — actors, catalogue fixtures, stub active");
    {
      const r1 = await req(ops, "POST", "/api/ops/auth", { email: "eugene@annai.sg", password: "anna1234" });
      eq("SETUP", "Ops admin login", r1.status, 200);

      for (const [actor, email, name] of [
        [hhA, C.hhAEmail, "A"],
        [hhB, C.hhBEmail, "B"],
      ] as const) {
        const reg = await req(actor, "POST", "/api/household/register", {
          name: `P95 Member ${name} ${TS}`, email, password: C.hhPassword,
          householdName: `P95 Family ${name} ${TS}`,
        }, { "x-forwarded-for": `10.9.${(TS % 250) + 1}.${name === "A" ? 7 : 8}` }); // per-run unique source IP
        const sess = await req(actor, "GET", "/api/household/session");
        const hid = dig(sess.data, "household.id", "member.householdId", "householdId") ?? "";
        if (name === "A") C.hhAId = hid; else C.hhBId = hid;
        check("SETUP", `Household ${name} registered + session`, reg.status <= 201 && !!hid, `hh=${hid.slice(-6)}`);
      }

      const intake = await req(ops, "POST", "/api/ops/vendors", {
        companyName: `P95Aircon ${TS}`, contactPerson: "P95 Lead", contactEmail1: C.vendorEmail,
        contactPhone1: "91234567", phone: "91234567", categories: ["AIRCON"], zones: ["east"],
        vendorType: "MICRO", password: C.vendorPassword,
      });
      C.vendorId = dig(intake.data, "vendor.id", "id") ?? "";
      await req(ops, "PATCH", `/api/ops/vendors/${C.vendorId}`, { status: "ACTIVE" });
      const vlogin = await req(vA, "POST", "/api/vendor/auth", { email: C.vendorEmail, password: C.vendorPassword });
      vA.bearer = dig(vlogin.data, "token") ?? undefined;
      check("SETUP", "AIRCON vendor created + login", !!C.vendorId && vlogin.status === 200, `vendor=${C.vendorId.slice(-6)}`);

      const gas = await db.serviceJobType.findUnique({ where: { slug: "aircon-gas-topup" } });
      C.gasJobTypeId = gas?.id ?? "";
      check("SETUP", "Catalogue fixture (gas top-up $40/unit)", !!gas && gas.basePriceCents === GAS_PRICE, `id=${C.gasJobTypeId.slice(-6)}`);

      stubBegin([textStep("setup")]);
    }

    // ═══════════════════ N1 — sequential double-confirm ═══════════════════
    section("N1 — sequential double-confirm of ONE card → exactly 1 task");
    const N1 = `p95-n1-${TS}`;
    let card1: any = null;
    {
      stubBegin([toolStep("create_task", { category: "AIRCON", serviceSlug: "gas top-up", units: 1, instructions: N1 })]);
      const r1 = await askAnna(hhA, "Book a gas top-up for tomorrow");
      card1 = r1.data?.pendingConfirmation;
      eq("N1", "Draft pass: card returned (approval gate)", r1.status, 200, `chainId=${String(card1?.chainId).slice(-8)}`);
      check("N1", "Card carries the server-approved catalogue price ($40)", dig(card1, "confirmationAction.amountCents") === GAS_PRICE);

      stubBegin([textStep("Booked.")]);
      const c1 = await askAnna(hhA, "Confirm.", { toolName: "create_task", action: card1?.confirmationAction, chainId: card1?.chainId });
      const t1 = dig(c1.data, "actionResult.data.taskId");
      eq("N1", "Confirm #1: HTTP 200, task created", c1.status, 200, `taskId=${String(t1).slice(-8)}`);
      check("N1", "Confirm #1: no replay flag (fresh execution)", c1.data?.actionResult?.idempotentReplay === undefined);

      stubBegin([textStep("Booked — you already have this one.")]);
      const c2 = await askAnna(hhA, "Confirm again.", { toolName: "create_task", action: card1?.confirmationAction, chainId: card1?.chainId });
      const t2 = dig(c2.data, "actionResult.data.taskId");
      eq("N1", "Confirm #2: HTTP 200 (chat alive)", c2.status, 200);
      check("N1", "Confirm #2: SAME taskId returned", t2 === t1, `#1=${String(t1).slice(-8)} #2=${String(t2).slice(-8)}`);
      check("N1", "Confirm #2: marked idempotentReplay", c2.data?.actionResult?.idempotentReplay === true);

      const rows = await tasksByMarker(N1);
      eq("N1", "DB: exactly ONE task for the card", rows.length, 1, `jobNo=${rows[0]?.jobNo}`);
      check("N1", "Task row stores chainId as idempotencyKey", rows[0]?.idempotencyKey === card1?.chainId);
      eq("N1", "Task priced at the catalogue amount", rows[0]?.amountCents, GAS_PRICE);
      expectStubbed("N1", "N1 served by stub (0 live calls)", 1); // calls since the last arm (every scenario request is stub-served)
    }

    // ═══════════════════ N2 — true-parallel double-confirm ═══════════════════
    section("N2 — Promise.all concurrent double-confirm → exactly 1 task");
    const N2 = `p95-n2-${TS}`;
    {
      stubBegin([toolStep("create_task", { category: "AIRCON", serviceSlug: "gas top-up", units: 2, instructions: N2 })]);
      const r2 = await askAnna(hhA, "Book gas top-up for 2 units next week");
      const card2 = r2.data?.pendingConfirmation;
      eq("N2", "Draft pass: second card returned", r2.status, 200, `chainId=${String(card2?.chainId).slice(-8)}`);

      stubBegin([textStep("Booked."), textStep("Booked — you already have this one.")]); // one narration step consumed per racing confirm
      const [k1, k2] = await Promise.all([
        askAnna(hhA, "Confirm.", { toolName: "create_task", action: card2?.confirmationAction, chainId: card2?.chainId }),
        askAnna(hhA, "Confirm.", { toolName: "create_task", action: card2?.confirmationAction, chainId: card2?.chainId }),
      ]);
      const kt1 = dig(k1.data, "actionResult.data.taskId");
      const kt2 = dig(k2.data, "actionResult.data.taskId");
      check("N2", "Both racers respond 200 (fail-closed to neither)", k1.status === 200 && k2.status === 200, `statuses=${k1.status}/${k2.status}`);
      check("N2", "Both racers report the SAME taskId", kt1 === kt2 && !!kt1, `#1=${String(kt1).slice(-8)} #2=${String(kt2).slice(-8)}`);
      const replayFlags = [k1.data?.actionResult?.idempotentReplay, k2.data?.actionResult?.idempotentReplay];
      check("N2", "At least one racer reconciled as idempotentReplay", replayFlags.some((f) => f === true), `flags=${JSON.stringify(replayFlags)}`);

      const rows = await tasksByMarker(N2);
      eq("N2", "DB: exactly ONE task survived the race", rows.length, 1, `jobNo=${rows[0]?.jobNo}`);
      expectStubbed("N2", "N2 served by stub (0 live calls)", 2); // both racing narrations stub-served
    }

    // ═══════════════════ N3 — exactly one financial action/escrow ═══════════════════
    section("N3 — exactly ONE escrow for the surviving task; post-escrow replay is inert");
    {
      const rows = await tasksByMarker(N1);
      const taskId = rows[0]?.id;
      // Pre-escrow: no financial side effect beyond the single booking row
      eq("N3", "Pre-escrow: zero escrow rows (escrow forms at accept)", (await escrowRowsForTask(taskId)).length, 0);

      // Drive the ONE surviving task through dispatch + vendor accept → escrow
      const disp = await req(hhA, "POST", `/api/tasks/${taskId}/dispatch`, { vendorId: C.vendorId, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });
      check("N3", "Dispatch accepted", disp.status === 200 || disp.status === 201, `HTTP ${disp.status}`);
      const booking = await db.booking.findFirst({ where: { taskId } });
      const acc = await req(vA, "PATCH", `/api/vendors/${C.vendorId}/bookings/${booking?.id}`, { action: "accept" });
      eq("N3", "Vendor accept: HTTP 200", acc.status, 200);

      const esc = await escrowRowsForTask(taskId);
      eq("N3", "Exactly ONE escrow row for the double-confirmed card", esc.length, 1);
      eq("N3", "Escrow holds the catalogue amount (no double-charge)", esc[0]?.amountCents, GAS_PRICE);
      eq("N3", "Escrow state HELD", esc[0]?.state, "HELD");

      // Post-escrow replay: the same card confirmed a THIRD time — must be inert
      stubBegin([textStep("You already booked this — nothing new was created.")]);
      const c3 = await askAnna(hhA, "Confirm it again please.", { toolName: "create_task", action: card1?.confirmationAction, chainId: card1?.chainId });
      eq("N3", "Post-escrow replay: HTTP 200", c3.status, 200);
      check("N3", "Post-escrow replay returns the SAME task", dig(c3.data, "actionResult.data.taskId") === taskId);
      const rowsAfter = await tasksByMarker(N1);
      const escAfter = await escrowRowsForTask(taskId);
      eq("N3", "Replay changed nothing: still 1 task row", rowsAfter.length, 1);
      eq("N3", "Replay changed nothing: still exactly 1 escrow row, still HELD", escAfter.length === 1 && escAfter[0]?.state === "HELD", true);
      expectStubbed("N3", "N3 served by stub (0 live calls)", 1);
    }

    // ═══════════════════ N4 — replay returns the EXISTING result ═══════════════════
    section("N4 — repeated confirmation returns the existing result");
    {
      const rows = await tasksByMarker(N1);
      const expectedJobNo = rows[0]?.jobNo;
      stubBegin([textStep("Booked — you already have this one.")]);
      const c4 = await askAnna(hhA, "Confirm.", { toolName: "create_task", action: card1?.confirmationAction, chainId: card1?.chainId });
      const d = dig(c4.data, "actionResult.data");
      check("N4", "Replay result is a full success payload (not an error)", c4.data?.actionResult?.success === true);
      check("N4", "Replay result carries the ORIGINAL taskId", d?.taskId === rows[0]?.id);
      eq("N4", "Replay result carries the ORIGINAL jobNo", d?.jobNo, expectedJobNo);
      check("N4", "Replay result carries the booked amount", d?.amount === "SGD $40.00", `amount=${d?.amount}`);
      expectStubbed("N4", "N4 served by stub (0 live calls)", 1);
    }

    // ═══════════════════ N5 — unrelated cards still create their OWN tasks ═══════════════════
    section("N5 — a different card (new chainId) books normally");
    const N5 = `p95-n5-${TS}`;
    {
      stubBegin([toolStep("create_task", { category: "AIRCON", serviceSlug: "gas top-up", units: 1, instructions: N5 })]);
      const r5 = await askAnna(hhA, "Book another gas top-up for the weekend");
      const card5 = r5.data?.pendingConfirmation;
      check("N5", "New draft → new card with a DIFFERENT chainId", !!card5 && card5?.chainId !== card1?.chainId);
      stubBegin([textStep("Booked.")]);
      const c5 = await askAnna(hhA, "Confirm.", { toolName: "create_task", action: card5?.confirmationAction, chainId: card5?.chainId });
      const t5 = dig(c5.data, "actionResult.data.taskId");
      check("N5", "Unrelated card books its OWN task", c5.status === 200 && !!t5, `taskId=${String(t5).slice(-8)}`);
      const rows = await tasksByMarker(N5);
      eq("N5", "DB: exactly ONE task for the new card", rows.length, 1);
      const n1rows = await tasksByMarker(N1);
      check("N5", "Different task id from the N1 card's task", t5 !== n1rows[0]?.id, `N5=${String(t5).slice(-8)} vs N1=${String(n1rows[0]?.id).slice(-8)}`);
      expectStubbed("N5", "N5 served by stub (0 live calls)", 1);
    }

    // ═══════════════════ N6 — idempotency scope (household-scoped key) ═══════════════════
    section("N6 — chainId reuse across households does NOT block or leak bookings");
    {
      // Household B replays household A's N5 card (same chainId + action):
      // the key is scoped (householdId, key) — B gets its OWN booking,
      // A's task is untouched, and B's row carries the (household-unique)
      // key without interfering with A's.
      stubBegin([textStep("Booked.")]);
      const bConf = await askAnna(hhB, "Confirm.", { toolName: "create_task", action: card1?.confirmationAction, chainId: card1?.chainId });
      const bt = dig(bConf.data, "actionResult.data.taskId");
      check("N6", "Cross-household chainId reuse still books (no false replay hit)", bConf.status === 200 && !!bt, `B task=${String(bt).slice(-8)}`);
      const bRow = bt ? await db.task.findUnique({ where: { id: bt } }) : null;
      check("N6", "B's booking belongs to B's household (session authority)", bRow?.householdId === C.hhBId, `hh=${String(bRow?.householdId).slice(-6)}`);
      check("N6", "B's row is NOT A's task", bt !== (await tasksByMarker(N1))[0]?.id);
      const aRows = await db.task.findMany({ where: { instructions: N1, householdId: C.hhAId } });
      eq("N6", "A's original task untouched (A still has exactly 1 row for the marker)", aRows.length, 1);
      const sameKey = await db.task.findMany({ where: { idempotencyKey: card1?.chainId } });
      eq("N6", "Key scoping: the same chainId legitimately exists under TWO households", sameKey.length, 2, `households=${sameKey.map((t) => t.householdId.slice(-6)).join(",")}`);
      eq("N6", "...and each household holds exactly ONE of them",
        sameKey.filter((t) => t.householdId === C.hhAId).length === 1 && sameKey.filter((t) => t.householdId === C.hhBId).length === 1, true);
      expectStubbed("N6", "N6 served by stub (0 live calls)", 1);
    }

    // ═══════════════════ N7 — regression guards ═══════════════════
    section("N7 — tamper guard intact (catalogue re-verification with chainId attached)");
    {
      // ai-contract B4b semantics, now WITH a chainId: a tampered amount on
      // a card that has NOT yet been confirmed must still be REFUSED by the
      // live-catalogue re-verification — the chainId grants no authority.
      stubBegin([toolStep("create_task", { category: "AIRCON", serviceSlug: "gas top-up", units: 1, instructions: `p95-n7-${TS}` })]);
      const r7 = await askAnna(hhA, "Book one more gas top-up");
      const card7 = r7.data?.pendingConfirmation;
      const tampered = { ...(card7?.confirmationAction ?? {}), amountCents: 990 };
      const before = await db.task.count({ where: { householdId: C.hhAId } });
      stubBegin([textStep("ok")]);
      const c7 = await askAnna(hhA, "Confirm.", { toolName: "create_task", action: tampered, chainId: card7?.chainId });
      eq("N7", "Tampered card + chainId: HTTP 200 (chat alive)", c7.status, 200);
      check("N7", "Tampered amount REFUSED (catalogue re-verification)",
        c7.data?.actionResult?.success === false && /catalogue changed/i.test(String(c7.data?.actionResult?.error ?? "")),
        `error=${String(c7.data?.actionResult?.error ?? "").slice(0, 70)}`);
      eq("N7", "Tampered card: NO task created", await db.task.count({ where: { householdId: C.hhAId } }), before);
      expectStubbed("N7", "N7 served by stub (0 live calls)", 1);
    }

    // ═══════════════════ CODE-REVIEW NOTES ═══════════════════
    codeReview.push(
      "CF#10 fix (Phase 9.5): src/app/api/ask-anna/route.ts threads the AI card's deterministic chainId into the confirm-pass tool args as args.idempotencyKey (auth remains session-based — the key grants no authority);",
      "src/lib/nlu-tools.ts executeCreateTask: (1) pre-create replay lookup on (householdId, idempotencyKey) placed BEFORE the catalogue re-verification so an existing booking is reported even if the catalogue drifted; (2) the key is stored on Task.idempotencyKey at creation; (3) post-create reconciliation mirrors P9B-F01 (POST /api/tasks) — older task wins, racing duplicate self-deletes BEFORE dispatch/escrow/automation fire;",
      "No 60s window by design (unlike POST /api/tasks): the chainId names ONE card approval, so a same-key confirm is always a duplicate; a NEW booking always arrives through a NEW card with a NEW chainId (N5 proves separate cards → separate tasks);",
      "Scope: (householdId, idempotencyKey) — cross-household key reuse neither blocks nor leaks (N6); no DB unique constraint (multi-replica deployments would need one — same documented limitation as POST /api/tasks);",
      "Money-authority/maker-checker untouched: the card's approved jobTypeId+amountCents is still re-verified against the live catalogue on every FRESH execution (N7); the replay path only REPORTS the already-executed booking."
    );

    // ═══════════════════ REPORT ═══════════════════
    const totals = { pass: records.filter((r) => r.pass).length, fail: records.filter((r) => !r.pass).length };
    const report = {
      suite: "phase95-sec",
      layer: "Phase 9.5 — NLU confirm-pass replay (CF#10) dynamic proofs",
      startedAt: new Date(TS).toISOString(),
      dbBackup: backupFile,
      totals,
      findingsCount: findings.length,
      findings,
      codeReview,
      checks: records,
    };
    fs.writeFileSync("/home/z/wt-item8/e2e/phase95-report.json", JSON.stringify(report, null, 2));
    log(`\n━━━ PHASE 9.5 NLU REPLAY COMPLETE ━━━`);
    log(`checks: ${totals.pass}/${records.length}`);
    log(`findings: ${findings.length}`);
    log(`report → e2e/phase95-report.json`);
    if (totals.fail > 0) process.exit(1);
  } finally {
    stubDisable(); // NEVER leave the stub armed for live traffic
    try {
      // Restore the snapshot AND discard the write-ahead log — a bare
      // `cp` leaves the suite's transactions in custom.db-wal, which
      // SQLite replays on top of the restored file (resurrecting the
      // test data). Removing the WAL/shm files makes the restore real.
      execSync(`cp ${backupFile} ${dbFile} && rm -f ${dbFile}-wal ${dbFile}-shm`);
      log(`[restore] DB restored from ${backupFile} (WAL discarded)`);
    } catch (e) {
      console.error("[restore] DB restore FAILED:", e);
    }
    await db.$disconnect();
  }
}

main().catch((e) => { console.error("phase95 suite crashed:", e); stubDisable(); process.exit(1); });
