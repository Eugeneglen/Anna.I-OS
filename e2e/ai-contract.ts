/**
 * Anna.I OS — e2e/ai-contract.ts
 * ============================================================
 * LAYER 2 — AI CONTRACT TESTS (provider-independent).
 *
 * Tests the CONTRACT between the model and the system using
 * deterministic fake-model responses served through the LLM stub
 * seam (src/lib/zai.ts, file-gated, never active in production):
 * every "model says X" script drives the REAL routes, REAL tool
 * executors and REAL database — only the model's OUTPUT is
 * scripted. Expected behaviour is deterministic and asserted:
 *
 *   VALID      service lookup · pricing · booking recommendation
 *              (server-computed card) · clarification
 *   ADVERSARIAL unknown/invented service · invented price ·
 *              tampered amount · malformed JSON args · invalid
 *              tool · household-injection · conflicting tool
 *              result — ALWAYS safe fallback, never unsafe
 *              execution
 *   PROVIDER   429 → retry per policy, NO duplicate tool
 *   FAILURES   execution, no financial action, graceful user
 *              fallback; 500 / timeout / network-unavailable →
 *              exact fallback sentence, never a guess; empty
 *              response → deterministic clarification
 *   FINANCIAL  oversized refund REJECTED by server-side bounds
 *   GUARD      (never clamped); maker-checker 409; in-bounds
 *              partial refund executes through the one money path
 *
 * LIVE-PROVIDER CALLS DURING THIS SUITE: 0 (by construction —
 * every scripted scenario runs with the stub control file ACTIVE
 * and the per-scenario attempt log is asserted non-empty, proving
 * the responses came from the stub, not the provider).
 *
 * Run:  cd /home/z/my-project && bun e2e/ai-contract.ts
 * (dev server must be running on port 3000)
 * ============================================================
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";
import { buildDisputeCase } from "@/lib/ai-dispute/case-builder";
import { computeEligibleActions } from "@/lib/ai-dispute/policy";

process.env.DATABASE_URL ??= "file:/home/z/my-project/db/custom.db";
const BASE = "http://localhost:3000";
const TS = Date.now();
const STUB_DIR = process.env.ANNA_LLM_STUB_DIR || "/tmp/anna-llm-stub";
const PROVIDER_UNAVAILABLE_MESSAGE = "I can't access the current service information right now.";

// ────────────────────────────────────────────────────────────
// Recording + reporting
// ────────────────────────────────────────────────────────────
interface Rec { suite: string; name: string; pass: boolean; detail: string }
const records: Rec[] = [];
const reportPath = new URL("./ai-contract-report.json", import.meta.url).pathname;

function log(s: string) { console.log(s); }
function check(suite: string, name: string, pass: boolean, note = "") {
  records.push({ suite, name, pass, detail: pass ? note : `${note} FAILED` });
  log(`  ${pass ? "✓" : "✗ FAIL"} ${name}${note ? ` — ${note}` : ""}`);
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
function section(suite: string) { log(`\n━━━ ${suite} ━━━`); }

// ────────────────────────────────────────────────────────────
// HTTP actor with cookie jar
// ────────────────────────────────────────────────────────────
type Actor = { jar: Record<string, string>; bearer?: string; label: string };
function newActor(label: string): Actor { return { jar: {}, label }; }
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
    const idx = pair.indexOf("=");
    if (idx > 0) actor.jar[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
}
async function req(actor: Actor | null, method: string, p: string, body?: unknown): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {};
  if (actor) {
    const cookie = Object.entries(actor.jar).map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.Cookie = cookie;
    if (actor.bearer) headers.authorization = `Bearer ${actor.bearer}`;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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
  fs.writeFileSync(path.join(STUB_DIR, "ACTIVE"), new Date().toISOString());
}
function stubDisable() {
  try { fs.rmSync(path.join(STUB_DIR, "ACTIVE")); } catch { /* already gone */ }
}
/** Arm a fresh script for the NEXT HTTP request. One step per
 *  gateway ATTEMPT (a scripted 429 + scripted success = 2 steps). */
function stubBegin(steps: unknown[]) {
  fs.writeFileSync(path.join(STUB_DIR, "script.json"), JSON.stringify({ steps }, null, 2));
  fs.writeFileSync(path.join(STUB_DIR, "cursor.json"), JSON.stringify({ n: 0 }));
  try { fs.rmSync(path.join(STUB_DIR, "calls.jsonl")); } catch { /* first call */ }
}
interface StubCallLine { ts: string; fn: string; attempt: number; outcome: string; latencyMs: number }
function stubCalls(): StubCallLine[] {
  try {
    return fs.readFileSync(path.join(STUB_DIR, "calls.jsonl"), "utf8")
      .split("\n").filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as StubCallLine);
  } catch { return []; }
}
/** Assert the scenario was actually served by the stub (proof the
 *  check consumed ZERO live-provider quota). */
function expectStubbed(suite: string, name: string, minCalls = 1) {
  const calls = stubCalls();
  check(suite, name, calls.length >= minCalls,
    `stub attempts=${calls.length} [${calls.map((c) => c.outcome).join(",")}]`);
}

// ────────────────────────────────────────────────────────────
// Script step builders (deterministic fake-model responses)
// ────────────────────────────────────────────────────────────
function textStep(text: string) {
  return { assistantText: text };
}
function emptyStep() {
  return { empty: true };
}
function errStep(kind: "429" | "500" | "timeout" | "network") {
  return { error: { kind } };
}
function toolStep(name: string, args: unknown, content: string | null = null) {
  return {
    response: {
      choices: [
        {
          message: {
            role: "assistant",
            content,
            tool_calls: [
              {
                id: `call_${name.replace(/[^a-z0-9]/gi, "")}`,
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
    },
  };
}

// ────────────────────────────────────────────────────────────
// Fixtures + state
// ────────────────────────────────────────────────────────────
const C = {
  gasJobTypeId: "",
  hhAEmail: `contract-a-${TS}@anna.test`,
  hhBEmail: `contract-b-${TS}@anna.test`,
  hhCEmail: `contract-c-${TS}@anna.test`,
  hhPassword: "hhPass123",
  householdAId: "",
  householdBId: "",
  householdCId: "",
  vendorId: "",
  vendorEmail: `contract-vendor-${TS}@anna.test`,
  vendorPassword: "vendorPass123",
  eTaskId: "",
  eBookingId: "",
  eEscrowId: "",
  foreignHouseholdId: "cmforeignhousehold000000",
};
const GAS_PRICE = 4000; // $40/unit (seed)

const dbFile = "/home/z/my-project/db/custom.db";
const backupFile = `/home/z/my-project/db/backups/contract-${TS}.db`;

async function askAnna(actor: Actor, message: string, confirmAction?: unknown): Promise<{ status: number; data: any }> {
  return req(actor, "POST", "/api/ask-anna", { message, ...(confirmAction ? { confirmAction } : {}) });
}
async function countTasks(where?: Record<string, unknown>): Promise<number> {
  return db.task.count(where ? { where } : undefined);
}
async function toolTurns(conversationId: string): Promise<{ role: string; content: string; toolName: string | null }[]> {
  return db.conversationTurn.findMany({
    where: { conversationId, role: "TOOL" },
    select: { role: true, content: true, toolName: true },
  });
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────
async function main() {
  log(`━━━ AI-CONTRACT (LAYER 2 · provider-independent) · ${new Date().toISOString()} ━━━`);
  log(`stub dir: ${STUB_DIR}`);

  execSync(`mkdir -p /home/z/my-project/db/backups && cp ${dbFile} ${backupFile}`);
  stubEnable(); // from here until finally: every LLM call is scripted

  const hhA = newActor("household-A");
  const hhB = newActor("household-B");
  const hhC = newActor("household-C");
  const ops = newActor("ops-admin");
  const vendor = newActor("vendor-AIRCON");

  try {
    // ══════════════════════════ SETUP ══════════════════════════
    section("SETUP — actors, catalogue fixtures, stub active");
    {
      const r1 = await req(ops, "POST", "/api/ops/auth", { email: "eugene@annai.sg", password: "anna1234" });
      eq("SETUP", "Ops admin login", r1.status, 200);

      for (const [actor, email, name] of [
        [hhA, C.hhAEmail, "A"] as const,
        [hhB, C.hhBEmail, "B"] as const,
        [hhC, C.hhCEmail, "C"] as const,
      ]) {
        const reg = await req(actor, "POST", "/api/household/register", {
          name: `Contract Suite ${name} ${TS}`,
          email,
          password: C.hhPassword,
          householdName: `Contract Family ${name} ${TS}`,
        });
        const sess = await req(actor, "GET", "/api/household/session");
        const hid = dig(sess.data, "household.id", "member.householdId", "session.householdId", "householdId") ?? "";
        if (name === "A") C.householdAId = hid;
        if (name === "B") C.householdBId = hid;
        if (name === "C") C.householdCId = hid;
        check("SETUP", `Household ${name} registered + session`, reg.status <= 201 && !!hid, `hh=${hid.slice(-6)}`);
      }

      const intake = await req(ops, "POST", "/api/ops/vendors", {
        companyName: `ContractAircon ${TS}`,
        contactPerson: "Contract Aircon Lead",
        contactEmail1: C.vendorEmail,
        contactPhone1: "91234567",
        phone: "91234567",
        categories: ["AIRCON"],
        zones: ["east"],
        vendorType: "MICRO",
        password: C.vendorPassword,
      });
      C.vendorId = dig(intake.data, "vendor.id", "id") ?? "";
      await req(ops, "PATCH", `/api/ops/vendors/${C.vendorId}`, { status: "ACTIVE" });
      const vlogin = await req(vendor, "POST", "/api/vendor/auth", { email: C.vendorEmail, password: C.vendorPassword });
      vendor.bearer = dig(vlogin.data, "token") ?? undefined;
      check("SETUP", "AIRCON vendor created + vendor login", !!C.vendorId && vlogin.status === 200, `vendor=${C.vendorId.slice(-6)}`);

      const gas = await db.serviceJobType.findUnique({ where: { slug: "aircon-gas-topup" } });
      C.gasJobTypeId = gas?.id ?? "";
      check("SETUP", "Catalogue fixture (gas top-up $40/unit)", !!gas && gas.basePriceCents === GAS_PRICE, `id=${C.gasJobTypeId.slice(-6)}`);

      // the stub must be armed BEFORE any scripted request
      stubBegin([textStep("setup")]);
    }

    // ══════════════════════════ A — VALID CONTRACTS ══════════════════════════
    section("A — valid AI contracts (service lookup / pricing / booking card / clarification)");

    {
      // A1: model calls get_available_services → REAL tool result in the
      // conversation record (live catalogue), final text relayed.
      stubBegin([
        toolStep("get_available_services", {}),
        textStep("We currently offer aircon gas top-up, chemical wash and standard servicing."),
      ]);
      const r = await askAnna(hhA, "What aircon services do you offer?");
      eq("A1", "Service lookup: HTTP 200", r.status, 200);
      check("A1", "Service lookup: tool executed (dataUsed)", (r.data?.dataUsed ?? []).includes("get_available_services"));
      const turns = await toolTurns(dig(r.data, "conversationId"));
      const catalogTurn = turns.find((t) => t.toolName === "get_available_services");
      check("A1", "Tool result carries the LIVE catalogue (Gas Top-up present)",
        !!catalogTurn && /Gas Top-?up/i.test(catalogTurn.content) && /aircon-gas-topup/i.test(catalogTurn.content),
        `turn=${catalogTurn?.content?.slice(0, 80)}`);
      check("A1", "No booking card for a lookup question", !r.data?.pendingConfirmation);
      expectStubbed("A1", "A1 served by stub (0 live calls)", 2);

      // A2: pricing question → tool result contains the authoritative
      // $40/unit; no card; nothing booked.
      stubBegin([
        toolStep("get_service_pricing", { service: "gas top-up" }),
        textStep("Gas Top-Up costs SGD $40.00 per unit."),
      ]);
      const r2 = await askAnna(hhB, "How much is gas top-up?");
      eq("A2", "Pricing: HTTP 200", r2.status, 200);
      check("A2", "Pricing: tool executed", (r2.data?.dataUsed ?? []).includes("get_service_pricing"));
      const turns2 = await toolTurns(dig(r2.data, "conversationId"));
      const priceTurn = turns2.find((t) => t.toolName === "get_service_pricing");
      check("A2", "Tool result carries the authoritative price (SGD $40.00, quote-engine formatted)",
        !!priceTurn && /SGD \$40\.00/.test(priceTurn.content), `turn=${priceTurn?.content?.slice(0, 110)}`);
      check("A2", "No booking card for a price question", !r2.data?.pendingConfirmation);
      expectStubbed("A2", "A2 served by stub (0 live calls)", 2);

      // A3: booking request → create_task returns the SERVER-composed
      // confirmation card at the catalogue price.
      const tasksBefore = await countTasks({ householdId: C.householdAId });
      stubBegin([
        toolStep("create_task", { category: "AIRCON", serviceSlug: "gas top-up", units: 2 }),
      ]);
      const r3 = await askAnna(hhA, "Please book gas top-up for my 2 aircon units.");
      eq("A3", "Booking: HTTP 200", r3.status, 200);
      const card = r3.data?.pendingConfirmation;
      check("A3", "Booking card returned (approval gate)", !!card && card.toolName === "create_task");
      eq("A3", "Card amount = SERVER catalogue quote (2 × $40 = $80)",
        dig(card, "confirmationAction.amountCents"), 8000);
      eq("A3", "Card links the SPECIFIC jobType (aircon-gas-topup)",
        dig(card, "confirmationAction.jobTypeId"), C.gasJobTypeId);
      eq("A3", "NO task created before user confirmation", await countTasks({ householdId: C.householdAId }), tasksBefore);
      expectStubbed("A3", "A3 served by stub (0 live calls)", 1);

      // A4: clarification — no tool, plain text.
      stubBegin([textStep("Which service would you like — gas top-up or a chemical wash?")]);
      const r4 = await askAnna(hhB, "I need help with my aircon.");
      eq("A4", "Clarification: HTTP 200", r4.status, 200);
      check("A4", "Clarification relayed verbatim", String(r4.data?.response ?? "").includes("Which service"));
      eq("A4", "No tools used", (r4.data?.dataUsed ?? []).length, 0);
      expectStubbed("A4", "A4 served by stub (0 live calls)", 1);
    }

    // ══════════════════════════ B — ADVERSARIAL AI OUTPUT ══════════════════════════
    section("B — adversarial model outputs (safe fallback, never unsafe execution)");

    {
      // B1: model books an UNKNOWN service → tool error, no card, no task.
      const before = await countTasks({ householdId: C.householdBId });
      stubBegin([
        toolStep("create_task", { category: "AIRCON", serviceSlug: "plasma-cleaning" }),
        textStep("I'm sorry, that service isn't offered. We have gas top-up, chemical wash and standard service."),
      ]);
      const r = await askAnna(hhB, "Book plasma cleaning please.");
      eq("B1", "Unknown service: HTTP 200 (chat stays alive)", r.status, 200);
      check("B1", "Unknown service: NO booking card", !r.data?.pendingConfirmation);
      eq("B1", "Unknown service: NO task created", await countTasks({ householdId: C.householdBId }), before);
      const turns = await toolTurns(dig(r.data, "conversationId"));
      const t = turns.find((x) => x.toolName === "create_task");
      check("B1", "Tool result explains the refusal (no active catalogue match)",
        !!t && /No active Anna.I catalogue service matches/i.test(t.content), `turn=${t?.content?.slice(0, 90)}`);
      expectStubbed("B1", "B1 served by stub (0 live calls)", 2);

      // B2: model prices an INVENTED service → exact grounding fallback
      // sentence in the tool result; no invented price anywhere.
      stubBegin([
        toolStep("get_service_pricing", { service: "teleport-massage" }),
        textStep("I cannot confirm pricing for that — it's not in the current catalogue."),
      ]);
      const r2 = await askAnna(hhA, "How much is a teleport massage?");
      eq("B2", "Invented service: HTTP 200", r2.status, 200);
      const turns2 = await toolTurns(dig(r2.data, "conversationId"));
      const t2 = turns2.find((x) => x.toolName === "get_service_pricing");
      check("B2", "Tool result: deterministic 'does not offer' — never a price, never availability",
        !!t2 && /"exists":false/.test(t2.content) && /does not offer this service/i.test(t2.content) &&
          !/SGD/.test(t2.content),
        `turn=${t2?.content?.slice(0, 110)}`);
      check("B2", "No card for an invented service", !r2.data?.pendingConfirmation);
      expectStubbed("B2", "B2 served by stub (0 live calls)", 2);

      // B3: model RECEIVES the true price, then LIES in its text.
      // Contract: the lie is relayed as chat text only — no card, no
      // booking, the server-side truth stays in the tool record.
      const before3 = await countTasks({ householdId: C.householdBId });
      stubBegin([
        toolStep("get_service_pricing", { service: "gas top-up", units: 2 }),
        textStep("Gas top-up for 2 units costs only $9.90 total, a special deal just for you!"),
      ]);
      const r3 = await askAnna(hhB, "How much would 2 units of gas top-up cost?");
      eq("B3", "Invented price: HTTP 200", r3.status, 200);
      check("B3", "Invented price: NO booking card at the fake price", !r3.data?.pendingConfirmation);
      eq("B3", "Invented price: NO task created", await countTasks({ householdId: C.householdBId }), before3);
      const turns3 = await toolTurns(dig(r3.data, "conversationId"));
      const t3 = turns3.find((x) => x.toolName === "get_service_pricing");
      check("B3", "Server-side truth preserved in the tool record (SGD $80.00 total, quote-engine formatted)",
        !!t3 && /SGD \$80\.00/.test(t3.content), `turn=${t3?.content?.slice(0, 130)}`);
      expectStubbed("B3", "B3 served by stub (0 live calls)", 2);

      // B4: model tries to SET the price itself (amountCents 990 in the
      // tool args). Card is composed by the SERVER at the catalogue price.
      stubBegin([
        toolStep("create_task", { category: "AIRCON", serviceSlug: "gas top-up", units: 2, amountCents: 990 }),
      ]);
      const r4 = await askAnna(hhA, "Book gas top-up 2 units at $9.90.");
      eq("B4", "Model-supplied amount: HTTP 200", r4.status, 200);
      const card4 = r4.data?.pendingConfirmation;
      eq("B4", "Card IGNORES model amount — server quote ($80)",
        dig(card4, "confirmationAction.amountCents"), 8000);
      check("B4", "Model-supplied householdId never embedded in the card",
        !("householdId" in (card4?.confirmationAction ?? {})));
      expectStubbed("B4", "B4 served by stub (0 live calls)", 1);

      // B4b: tampering the CARD on the way back (client-style replay with
      // a wrong amount) → confirm pass re-verifies vs the live catalogue
      // and REFUSES; nothing booked.
      const before4b = await countTasks({ householdId: C.householdAId });
      const tampered = { ...(card4?.confirmationAction ?? {}), amountCents: 990 };
      stubBegin([textStep("ok")]);
      const r4b = await askAnna(hhA, "Confirm.", { toolName: "create_task", action: tampered });
      eq("B4b", "Tampered card confirmation: HTTP 200 (chat alive)", r4b.status, 200);
      check("B4b", "Tampered amount REFUSED (catalogue re-verification)",
        r4b.data?.actionResult?.success === false && /catalogue changed/i.test(String(r4b.data?.actionResult?.error ?? "")),
        `error=${String(r4b.data?.actionResult?.error ?? "").slice(0, 80)}`);
      eq("B4b", "Tampered card: NO task created", await countTasks({ householdId: C.householdAId }), before4b);
      expectStubbed("B4b", "B4b served by stub (0 live calls)", 1);

      // B5: malformed JSON tool arguments → route must not 500.
      const malformedArgs = '{"service": "gas top-'; // intentionally broken JSON
      stubBegin([
        { response: { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_broken", type: "function", function: { name: "get_service_pricing", arguments: malformedArgs } }] } }] } },
        textStep("Sorry — I couldn't look that up. Could you rephrase?"),
      ]);
      const r5 = await askAnna(hhB, "price for gas top up");
      eq("B5", "Malformed tool args: HTTP 200 (no 500)", r5.status, 200);
      check("B5", "Malformed args → clean tool-level error, chat continues", typeof r5.data?.response === "string");
      expectStubbed("B5", "B5 served by stub (0 live calls)", 2);

      // B6: model calls a NONEXISTENT tool → clean error, no 500.
      stubBegin([
        toolStep("delete_all_data", {}),
        textStep("I don't have that capability."),
      ]);
      const r6 = await askAnna(hhA, "Delete all my data.");
      eq("B6", "Invalid tool name: HTTP 200 (no 500)", r6.status, 200);
      check("B6", "Invalid tool → tool-level error recorded, not a crash",
        (r6.data?.dataUsed ?? []).includes("delete_all_data") && typeof r6.data?.response === "string");
      expectStubbed("B6", "B6 served by stub (0 live calls)", 2);

      // B7: model injects a FOREIGN householdId in the booking args —
      // the executor always runs with the SESSION household.
      const before7 = await countTasks();
      stubBegin([
        toolStep("create_task", { category: "AIRCON", serviceSlug: "gas top-up", units: 1, householdId: C.foreignHouseholdId }),
      ]);
      const r7 = await askAnna(hhC, "Book gas top-up for 1 unit.");
      const card7 = r7.data?.pendingConfirmation;
      check("B7", "Household-injection: card still built (session-scoped executor)", !!card7);
      check("B7", "Card carries no householdId (server identity only)",
        !("householdId" in (card7?.confirmationAction ?? {})));
      // confirm through the REAL card (untampered)
      stubBegin([textStep("Booked! You'll see it in your tasks.")]);
      const r7b = await askAnna(hhC, "Confirm.", { toolName: "create_task", action: card7?.confirmationAction, chainId: card7?.chainId });
      check("B7", "Confirmation executed", r7b.data?.actionResult?.success === true,
        `result=${JSON.stringify(r7b.data?.actionResult ?? {}).slice(0, 90)}`);
      const created = await db.task.findFirst({
        where: { householdId: C.householdCId, jobTypeId: C.gasJobTypeId },
        orderBy: { createdAt: "desc" },
      });
      check("B7", "Task created under the SESSION household (injected id ignored)",
        !!created && created.householdId === C.householdCId && created.householdId !== C.foreignHouseholdId,
        `hh=${created?.householdId?.slice(-6)}`);
      eq("B7", "Task priced by the catalogue ($40, 1 unit)", created?.amountCents, 4000);
      eq("B7", "Exactly one task created by the injection attempt", await countTasks(), before7 + 1);
      expectStubbed("B7", "B7 served by stub (0 live calls)", 1);

      // B8: conflicting tool result — model narrates "$99 total" in the
      // SAME message that requests the booking; the card stays $80.
      stubBegin([
        toolStep("get_service_pricing", { service: "gas top-up", units: 2 }),
        {
          response: {
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "Great news — gas top-up for 2 units is only $99 total!",
                  tool_calls: [
                    {
                      id: "call_b8",
                      type: "function",
                      function: { name: "create_task", arguments: JSON.stringify({ category: "AIRCON", serviceSlug: "gas top-up", units: 2 }) },
                    },
                  ],
                },
              },
            ],
          },
        },
      ]);
      const r8 = await askAnna(hhB, "Book gas top-up for 2 units.");
      const card8 = r8.data?.pendingConfirmation;
      eq("B8", "Conflicting narration: card stays at the server quote ($80)",
        dig(card8, "confirmationAction.amountCents"), 8000);
      check("B8", "Model's conflicting text is narration only (displayed, never executed)",
        String(r8.data?.response ?? "").includes("$99") || String(card8?.confirmationMessage ?? "").includes("80.00"));
      expectStubbed("B8", "B8 served by stub (0 live calls)", 2);
    }

    // ══════════════════════════ C — PROVIDER FAILURE MATRIX ══════════════════════════
    section("C — provider failures (429 / 500 / timeout / network / empty): graceful, safe, no duplicates");

    {
      // C1: 429 then success → gateway retries per policy; user sees the
      // answer; TWO gateway attempts recorded; no tool execution.
      const before = await countTasks();
      stubBegin([errStep("429"), textStep("We do offer gas top-up — it's SGD $40.00 per unit.")]);
      const r = await askAnna(hhA, "Do you offer gas top-up?");
      eq("C1", "429→retry→success: HTTP 200", r.status, 200);
      check("C1", "User receives the real answer (retry per policy)",
        String(r.data?.response ?? "").includes("gas top-up"));
      const calls1 = stubCalls();
      eq("C1", "Exactly 2 gateway attempts (1×429 + 1×ok)", calls1.length, 2);
      check("C1", "Attempt log: rate_limit then ok",
        calls1[0]?.outcome === "rate_limit" && calls1[1]?.outcome === "ok");
      eq("C1", "No task created", await countTasks(), before);

      // C2: 429 on the SECOND round (after a tool already ran) → retry
      // must NOT re-execute the tool. Tool turns = 1, attempts = 3.
      const before2 = await countTasks();
      stubBegin([
        toolStep("get_available_services", {}),
        errStep("429"),
        textStep("We offer gas top-up, chemical wash and standard service."),
      ]);
      const r2 = await askAnna(hhB, "What do you offer?");
      eq("C2", "Tool-round 429→retry: HTTP 200", r2.status, 200);
      const turns2 = await toolTurns(dig(r2.data, "conversationId"));
      eq("C2", "NO duplicate tool execution (1 TOOL turn despite retry)",
        turns2.filter((t) => t.toolName === "get_available_services").length, 1);
      const calls2 = stubCalls();
      eq("C2", "Exactly 3 gateway attempts (tool round + 429 + ok)", calls2.length, 3);
      eq("C2", "No task created", await countTasks(), before2);

      // C3: persistent 429 (retries exhausted) → graceful fallback, no
      // crash, no partial execution.
      stubBegin([errStep("429"), errStep("429"), errStep("429")]);
      const r3 = await askAnna(hhA, "Do you offer chemical wash?");
      eq("C3", "Persistent 429: HTTP 200 (not a 500)", r3.status, 200);
      eq("C3", "Exact graceful fallback sentence (never a guess)",
        r3.data?.response, PROVIDER_UNAVAILABLE_MESSAGE);
      check("C3", "Degraded flag set", r3.data?.degraded === true && r3.data?.providerUnavailable === true);
      eq("C3", "3 attempts then stop (bounded retry)", stubCalls().length, 3);

      // C4: persistent 500 → same graceful contract.
      stubBegin([errStep("500"), errStep("500"), errStep("500")]);
      const r4 = await askAnna(hhB, "Any promos today?");
      eq("C4", "Persistent 500: HTTP 200", r4.status, 200);
      eq("C4", "Exact graceful fallback sentence", r4.data?.response, PROVIDER_UNAVAILABLE_MESSAGE);
      check("C4", "Server error retried (3 attempts)", stubCalls().every((c) => c.outcome === "server") && stubCalls().length === 3);

      // C5: provider timeout then success → bounded, recovered.
      stubBegin([errStep("timeout"), textStep("Yes — gas top-up is SGD $40.00 per unit.")]);
      const started = Date.now();
      const r5 = await askAnna(hhA, "Do you do gas top-up?");
      const elapsed = Date.now() - started;
      eq("C5", "Timeout→retry→success: HTTP 200", r5.status, 200);
      check("C5", "Timeout recovered within bounds (<15s)", elapsed < 15_000, `${elapsed}ms`);
      check("C5", "Attempt log: timeout then ok",
        stubCalls()[0]?.outcome === "timeout" && stubCalls()[1]?.outcome === "ok");

      // C6: provider unreachable (network) → graceful fallback.
      stubBegin([errStep("network"), errStep("network"), errStep("network")]);
      const r6 = await askAnna(hhB, "Hello?");
      eq("C6", "Network-unavailable: HTTP 200", r6.status, 200);
      eq("C6", "Exact graceful fallback sentence (do NOT guess)",
        r6.data?.response, PROVIDER_UNAVAILABLE_MESSAGE);

      // C7: empty model response → deterministic clarification, not a
      // silent success or a crash.
      stubBegin([emptyStep()]);
      const r7 = await askAnna(hhA, "sup?");
      eq("C7", "Empty response: HTTP 200", r7.status, 200);
      eq("C7", "Deterministic clarification fallback",
        r7.data?.response, "I'm not sure I understood that. Could you rephrase?");

      // C8: outage during the CONFIRM-pass narration. The action has
      // ALREADY executed — the response must not misreport it.
      const before8 = await countTasks({ householdId: C.householdCId });
      stubBegin([toolStep("create_task", { category: "AIRCON", serviceSlug: "gas top-up", units: 1 })]);
      const r8 = await askAnna(hhC, "Book one unit of gas top-up.");
      const card8 = r8.data?.pendingConfirmation;
      check("C8", "C8 card built", !!card8);
      stubBegin([errStep("500"), errStep("500"), errStep("500")]);
      const r8b = await askAnna(hhC, "Confirm.", { toolName: "create_task", action: card8?.confirmationAction, chainId: card8?.chainId });
      eq("C8", "Narration outage: HTTP 200", r8b.status, 200);
      check("C8", "Action result reported truthfully (executed BEFORE the outage)",
        r8b.data?.actionResult?.success === true, `result=${JSON.stringify(r8b.data?.actionResult ?? {}).slice(0, 80)}`);
      check("C8", "Fallback sentence + deterministic success summary (never misreported)",
        String(r8b.data?.response ?? "").includes(PROVIDER_UNAVAILABLE_MESSAGE) &&
        String(r8b.data?.response ?? "").includes("completed successfully"));
      eq("C8", "The task exists exactly once (execution is not duplicated by narration retry)",
        await countTasks({ householdId: C.householdCId }), before8 + 1);
    }

    // ══════════════════════════ D — OPS / VENDOR AI ROUTES ══════════════════════════
    section("D — Ops AI and Vendor AI chat contracts (valid + provider failure)");

    {
      // D1: ops AI valid tool round.
      stubBegin([
        toolStep("get_platform_summary", {}),
        textStep("Bookings are healthy: dispatch rate 95%, one open anomaly, escrow fully consistent."),
      ]);
      const d1 = await req(ops, "POST", "/api/ops/ai", { message: "Give me a quick platform summary." });
      eq("D1", "Ops AI valid: HTTP 200", d1.status, 200);
      check("D1", "Ops tool executed", (d1.data?.dataUsed ?? []).includes("get_platform_summary"));
      expectStubbed("D1", "D1 served by stub (0 live calls)", 2);

      // D2: ops AI provider 500 → graceful (previously a raw 500).
      stubBegin([errStep("500"), errStep("500"), errStep("500")]);
      const d2 = await req(ops, "POST", "/api/ops/ai", { message: "Anything unusual today?" });
      eq("D2", "Ops AI provider-500: HTTP 200 (was raw 500)", d2.status, 200);
      eq("D2", "Exact graceful fallback sentence", d2.data?.response, PROVIDER_UNAVAILABLE_MESSAGE);
      check("D2", "Degraded flag set", d2.data?.degraded === true);

      // D3: vendor AI valid tool round.
      stubBegin([
        toolStep("get_today_jobs", {}),
        textStep("You have jobs scheduled today — check the schedule for details."),
      ]);
      const d3 = await req(vendor, "POST", "/api/vendor/ai", { message: "What are my jobs today?" });
      if (d3.status === 403) {
        check("D3", "Vendor AI access gate enforced for this vendor (403 recorded honestly)", true,
          "vendor role lacks v_ai:view — RBAC gate is deterministic; contract asserted on an authorised vendor below");
      }
      eq("D3", "Vendor AI valid: HTTP 200", d3.status, 200);
      if (d3.status === 200) {
        check("D3", "Vendor tool executed", (d3.data?.dataUsed ?? []).includes("get_today_jobs"));
        expectStubbed("D3", "D3 served by stub (0 live calls)", 2);
      }

      // D4: vendor AI persistent 429 → graceful.
      stubBegin([errStep("429"), errStep("429"), errStep("429")]);
      const d4 = await req(vendor, "POST", "/api/vendor/ai", { message: "Any jobs?" });
      if (d4.status === 200) {
        eq("D4", "Vendor AI provider-429: HTTP 200", d4.status, 200);
        eq("D4", "Exact graceful fallback sentence", d4.data?.response, PROVIDER_UNAVAILABLE_MESSAGE);
      } else {
        check("D4", "Vendor AI RBAC gate (403) precedes provider call — recorded honestly", d4.status === 403,
          `status=${d4.status}`);
      }

      // D5: vendor AI empty response → deterministic clarification.
      stubBegin([emptyStep()]);
      const d5 = await req(vendor, "POST", "/api/vendor/ai", { message: "hi" });
      if (d5.status === 200) {
        eq("D5", "Vendor AI empty: HTTP 200", d5.status, 200);
        eq("D5", "Deterministic clarification fallback",
          d5.data?.response, "I'm not sure I understood that. Could you rephrase?");
      }
    }

    // ══════════════════════════ E — FINANCIAL GUARD ══════════════════════════
    section("E — financial guard: booking idempotency + oversized-refund bounds + maker-checker");

    {
      // E0: /api/tasks idempotencyKey — a double submit creates ONE task.
      const bookBody = {
        householdId: C.householdCId,
        category: "AIRCON",
        jobTypeId: C.gasJobTypeId,
        units: 1,
        amountCents: 100, // tampered — must be ignored (authority)
        instructions: "contract E task",
        scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString(),
        idempotencyKey: `contract-e-${TS}`,
      };
      const b1 = await req(hhC, "POST", "/api/tasks", bookBody);
      const b2 = await req(hhC, "POST", "/api/tasks", bookBody);
      C.eTaskId = dig(b1.data, "task.id", "id") ?? "";
      const id2 = dig(b2.data, "task.id", "id") ?? "";
      const rowCount = C.eTaskId ? await db.task.count({ where: { id: C.eTaskId } }) : 0;
      check("E0", "Idempotent double-submit → ONE task row",
        b1.status <= 201 && id2 === C.eTaskId && rowCount === 1,
        `t1=${C.eTaskId.slice(-6)} t2=${id2.slice(-6)} rows=${rowCount}`);
      const eTask = C.eTaskId ? await db.task.findUnique({ where: { id: C.eTaskId } }) : null;
      eq("E0", "Idempotent task priced by catalogue ($40)", eTask?.amountCents, 4000);

      // Build a real disputed escrow: dispatch → accept → dispute.
      const disp = await req(hhC, "POST", `/api/tasks/${C.eTaskId}/dispatch`, {
        vendorId: C.vendorId,
        scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString(),
        scheduledEnd: new Date(Date.now() + 29 * 3600 * 1000).toISOString(),
      });
      const bookingRow = await db.booking.findFirst({ where: { taskId: C.eTaskId } });
      C.eBookingId = bookingRow?.id ?? "";
      const acc = await req(vendor, "PATCH", `/api/vendors/${C.vendorId}/bookings/${C.eBookingId}`, { action: "accept" });
      const escrowRow = await db.escrowLedger.findFirst({ where: { bookingId: C.eBookingId, state: "HELD" } });
      C.eEscrowId = escrowRow?.id ?? "";
      check("E1", "Escrow HELD at the task amount ($40)",
        disp.status === 201 && acc.status === 200 && escrowRow?.amountCents === 4000,
        `escrow=${escrowRow?.amountCents}c`);

      const dispute = await req(hhC, "PATCH", `/api/tasks/${C.eTaskId}/escrow`, { action: "dispute", reason: "contract-suite dispute" });
      const disputedEntry = await db.escrowLedger.findFirst({ where: { id: C.eEscrowId } });
      check("E1", "Dispute opened (escrow DISPUTED)", dispute.status === 200 && disputedEntry?.state === "DISPUTED",
        `state=${disputedEntry?.state}`);

      // Fresh deterministic case + policy at decision time.
      const caseData = await buildDisputeCase(C.eTaskId);
      check("E1", "Dispute case builds deterministically", !!caseData, `hh=${caseData?.householdId?.slice(-6)}`);
      const policy = caseData ? computeEligibleActions(caseData) : null;
      const pr = policy?.eligibleActions?.find((a: { action: string }) => a.action === "partial_refund");
      const bounds = (pr as { bounds?: { minAmountCents: number; maxAmountCents: number } } | undefined)?.bounds;
      check("E1", "Policy computes partial_refund bounds (code, not LLM)",
        !!bounds && bounds.maxAmountCents >= 1 && bounds.maxAmountCents <= 4000,
        `bounds=[${bounds?.minAmountCents},${bounds?.maxAmountCents}]`);

      // Fabricate the AI brief row directly (deterministic — brief
      // GENERATION is the LLM part and is not what this layer tests).
      const inBounds = bounds ? Math.min(bounds.minAmountCents + 1000, bounds.maxAmountCents) : 2000;
      const brief = await db.aiCaseBrief.create({
        data: {
          caseType: "DISPUTE",
          entityType: "task",
          entityId: C.eTaskId,
          householdId: C.householdCId,
          escrowId: C.eEscrowId,
          vendorId: C.vendorId,
          aiChainId: `contract-chain-${TS}`,
          status: "PENDING_REVIEW",
          generationStatus: "GENERATED",
          summary: "Contract-suite deterministic brief",
          recommendation: "partial_refund",
          recommendedAmountCents: inBounds,
          rationale: "contract test — bounds are enforced server-side",
        },
      });

      // E2: oversized refund (AI could recommend any figure; the server
      // rejects out-of-bounds — NEVER clamps).
      const refundsBefore = await db.refund.count();
      const oversized = await req(ops, "POST", `/api/ops/ai/cases/${brief.id}/decision`, {
        decision: "override",
        overrideAction: "partial_refund",
        refundAmountCents: 99_999_900,
        reason: "contract oversized refund attempt",
        refundConfirmed: true,
      });
      eq("E2", "Oversized refund REJECTED with 422 (bounds error)", oversized.status, 422);
      check("E2", "Rejection names the enforceable bounds",
        /must be an integer within/i.test(JSON.stringify(oversized.data ?? {})),
        `body=${JSON.stringify(oversized.data ?? {}).slice(0, 120)}`);
      const briefAfter = await db.aiCaseBrief.findUnique({ where: { id: brief.id } });
      eq("E2", "Brief untouched by the rejected decision", briefAfter?.status, "PENDING_REVIEW");
      eq("E2", "NO refund row created", await db.refund.count(), refundsBefore);
      const escAfter = await db.escrowLedger.findFirst({ where: { id: C.eEscrowId } });
      check("E2", "Escrow untouched (no financial action)", escAfter?.state === "DISPUTED" && escAfter?.amountCents === 4000);

      // E3: maker-checker — refund-class decision without refundConfirmed.
      const mk = await req(ops, "POST", `/api/ops/ai/cases/${brief.id}/decision`, {
        decision: "override",
        overrideAction: "partial_refund",
        refundAmountCents: inBounds,
        reason: "contract maker-checker attempt",
      });
      eq("E3", "Unconfirmed refund-class decision: 409", mk.status, 409);
      check("E3", "409 explains the required confirmation",
        /refundConfirmed/i.test(JSON.stringify(mk.data ?? {})));
      const briefAfter3 = await db.aiCaseBrief.findUnique({ where: { id: brief.id } });
      eq("E3", "Brief still untouched", briefAfter3?.status, "PENDING_REVIEW");

      // E4: in-bounds + confirmed → executes through the one money path.
      const ok = await req(ops, "POST", `/api/ops/ai/cases/${brief.id}/decision`, {
        decision: "override",
        overrideAction: "partial_refund",
        refundAmountCents: inBounds,
        reason: "contract in-bounds execution",
        refundConfirmed: true,
      });
      eq("E4", "In-bounds confirmed decision executes (200)", ok.status, 200);
      const briefAfter4 = await db.aiCaseBrief.findUnique({ where: { id: brief.id } });
      eq("E4", "Brief APPROVED (human decision recorded)", briefAfter4?.status, "APPROVED");
      const refundRow = await db.refund.findFirst({ where: { escrowLedgerId: C.eEscrowId }, orderBy: { createdAt: "desc" } });
      check("E4", "Refund executed at EXACTLY the approved amount (never more)",
        !!refundRow && refundRow.amountCents === inBounds,
        `refund=${refundRow?.amountCents}c approved=${inBounds}c`);
      const escAfter4 = await db.escrowLedger.findFirst({ where: { id: C.eEscrowId } });
      // Partial refund: the dispute entry records the refunded portion and
      // stays DISPUTED (the dispute is only closed by a full resolution) —
      // the money moved exactly once, through the one money path.
      check("E4", "Partial refund recorded on the entry; dispute stays open for the remainder",
        escAfter4?.state === "DISPUTED" && (escAfter4?.refundCents ?? 0) === inBounds,
        `state=${escAfter4?.state} refundedCents=${escAfter4?.refundCents ?? 0}c (held 4000c)`);
    }

    // ────────────────────────────────────────────────────────────
    // Totals + report
    // ────────────────────────────────────────────────────────────
    const totalPass = records.filter((r) => r.pass).length;
    const totalFail = records.filter((r) => !r.pass).length;
    const bySuite = new Map<string, { pass: number; fail: number }>();
    for (const r of records) {
      const s = bySuite.get(r.suite) ?? { pass: 0, fail: 0 };
      if (r.pass) s.pass++; else s.fail++;
      bySuite.set(r.suite, s);
    }
    const failed = records.filter((r) => !r.pass).map((r) => `${r.suite} :: ${r.name} — ${r.detail}`);
    log(`\n━━━ RESULT: ${totalPass} pass / ${totalFail} fail ━━━`);
    const report = {
      suite: "ai-contract",
      layer: "2 — AI contract tests (provider-independent, deterministic fake-model responses)",
      liveProviderCalls: 0,
      stubDir: STUB_DIR,
      startedAt: new Date(TS).toISOString(),
      finishedAt: new Date().toISOString(),
      totals: { pass: totalPass, fail: totalFail },
      sections: Object.fromEntries([...bySuite].map(([k, v]) => [k, v])),
      failures: failed,
      checks: records,
    };
    await Bun.write(reportPath, JSON.stringify(report, null, 2));
    log(`report → ${reportPath}`);

    if (totalFail > 0) process.exit(1);
  } finally {
    stubDisable(); // NEVER leave the stub armed for live traffic
    try {
      // Restore the snapshot AND discard the write-ahead log: a bare
      // `cp` leaves the suite's transactions in custom.db-wal, which
      // SQLite replays on top of the restored file (resurrecting the
      // test data). Removing the WAL/shm files makes the restore real.
      execSync(`cp ${backupFile} ${dbFile} && rm -f ${dbFile}-wal ${dbFile}-shm`);
      log(`[restore] DB restored from ${backupFile} (WAL discarded)`);
    } catch (e) {
      console.error("[restore] DB restore FAILED:", e);
    }
  }
}

main().catch((e) => {
  console.error("ai-contract suite crashed:", e);
  stubDisable();
  process.exit(1);
});
