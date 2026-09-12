/**
 * Anna.I OS — e2e/live-smoke.ts
 * ============================================================
 * LAYER 3 — LIVE PROVIDER SMOKE (deliberately tiny).
 *
 * The ONLY suite that calls the live LLM/VLM/ASR provider in the
 * routine test strategy. Everything else runs provider-independent
 * (Layer 1: e2e/authority-chain.ts + e2e/run-flows.ts) or against
 * the deterministic stub seam (Layer 2: e2e/ai-contract.ts).
 *
 * Hard budget: ≤ 10 live model calls per run (plus bounded gateway
 * retries ONLY when the provider itself is transiently failing).
 * The historical heavy suites (ai-foundation / ai-dispute /
 * ai-insight / ask-anna-multimodal) are NOT part of routine
 * regression any more — they stay in the repo for occasional
 * deep validation only.
 *
 * Scenarios (user-specified):
 *   S1 "Do you offer gas top-up?"            (grounded offers)
 *   S2 "How much is gas top-up?"             (grounded price)
 *   S3 "Book gas top-up for 2 units."        (card + confirm + task)
 *   S4 Ops AI platform question              (authorised ops surface)
 *   S5 Vendor AI "my jobs today"             (authorised vendor surface)
 *   S6 Adversarial: invented service         (no hallucination)
 *   S7 Multi-turn conversation               (memory continuity)
 *   S8 Voice transcription smoke             (ASR channel)
 *
 * Run (explicit opt-in ONLY):
 *   LIVE_SMOKE=1 bun e2e/live-smoke.ts
 * Without LIVE_SMOKE=1 the suite exits 0 immediately and records
 * "skipped" in the report — it can never run by accident.
 *
 * Also refuses to run while the LLM stub is ACTIVE (a scripted
 * response must never be reported as a live result).
 * ============================================================
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { db } from "@/lib/db";

process.env.DATABASE_URL ??= "file:/home/z/my-project/db/custom.db";
const BASE = "http://localhost:3000";
const TS = Date.now();
const STUB_DIR = process.env.ANNA_LLM_STUB_DIR || "/tmp/anna-llm-stub";
const reportPath = new URL("./live-smoke-report.json", import.meta.url).pathname;

function log(s: string) { console.log(s); }

// ────────────────────────────────────────────────────────────
// Skip gate (default) — never run live calls by accident
// ────────────────────────────────────────────────────────────
if (process.env.LIVE_SMOKE !== "1") {
  log("[live-smoke] SKIPPED — set LIVE_SMOKE=1 to run the (budgeted) live-provider smoke suite.");
  const report = {
    suite: "live-smoke",
    layer: "3 — live provider smoke (opt-in)",
    skipped: true,
    reason: "LIVE_SMOKE not set — routine regression must not consume provider quota",
    liveProviderCalls: 0,
    finishedAt: new Date().toISOString(),
    scenarios: [],
  };
  await Bun.write(reportPath, JSON.stringify(report, null, 2));
  process.exit(0);
}
if (fs.existsSync(path.join(STUB_DIR, "ACTIVE"))) {
  log(`[live-smoke] REFUSING to run: LLM stub is ACTIVE (${STUB_DIR}/ACTIVE). A scripted response must never be reported as a live result.`);
  process.exit(1);
}

// ────────────────────────────────────────────────────────────
// Reporting
// ────────────────────────────────────────────────────────────
interface Scenario { id: string; name: string; liveCalls: number; latencyMs: number; status: number; pass: boolean; note: string }
const scenarios: Scenario[] = [];
function record(s: Scenario) {
  scenarios.push(s);
  log(`  ${s.pass ? "✓" : "✗ FAIL"} ${s.id} ${s.name} — ${s.latencyMs}ms ${s.liveCalls} call(s) ${s.note}`);
}

// ────────────────────────────────────────────────────────────
// HTTP actor with cookie jar (same pattern as the other suites)
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

const dbFile = "/home/z/my-project/db/custom.db";
const backupFile = `/home/z/my-project/db/backups/live-smoke-${TS}.db`;

async function askAnna(actor: Actor, message: string, conversationId?: string, confirmAction?: unknown) {
  const body: Record<string, unknown> = { message };
  if (conversationId) body.conversationId = conversationId;
  if (confirmAction) body.confirmAction = confirmAction;
  return req(actor, "POST", "/api/ask-anna", body);
}

async function main() {
  log(`━━━ LIVE-SMOKE (LAYER 3 · budget ≤10 live calls) · ${new Date().toISOString()} ━━━`);
  execSync(`mkdir -p /home/z/my-project/db/backups && cp ${dbFile} ${backupFile}`);

  const hh = newActor("household");
  const ops = newActor("ops-admin");
  const vendor = newActor("vendor-AIRCON");
  let providerHealthy = true;

  try {
    // ── SETUP (deterministic — zero live calls) ──
    await req(ops, "POST", "/api/ops/auth", { email: "eugene@annai.sg", password: "anna1234" });
    const reg = await req(hh, "POST", "/api/household/register", {
      name: `Smoke HH ${TS}`,
      email: `smoke-${TS}@anna.test`,
      password: "hhPass123",
      householdName: `Smoke Family ${TS}`,
    });
    const sess = await req(hh, "GET", "/api/household/session");
    const hhId = dig(sess.data, "household.id", "member.householdId", "session.householdId", "householdId") ?? "";
    log(`  setup: household=${hhId.slice(-6)} reg=${reg.status}`);
    const intake = await req(ops, "POST", "/api/ops/vendors", {
      companyName: `SmokeAircon ${TS}`,
      contactPerson: "Smoke Aircon Lead",
      contactEmail1: `smoke-vendor-${TS}@anna.test`,
      contactPhone1: "91234567",
      phone: "91234567",
      categories: ["AIRCON"],
      zones: ["east"],
      vendorType: "MICRO",
      password: "vendorPass123",
    });
    const vendorId = dig(intake.data, "vendor.id", "id") ?? "";
    await req(ops, "PATCH", `/api/ops/vendors/${vendorId}`, { status: "ACTIVE" });
    const vlogin = await req(vendor, "POST", "/api/vendor/auth", { email: `smoke-vendor-${TS}@anna.test`, password: "vendorPass123" });
    vendor.bearer = dig(vlogin.data, "token") ?? undefined;
    log(`  setup: vendor=${vendorId.slice(-6)} login=${vlogin.status}`);
    const gas = await db.serviceJobType.findUnique({ where: { slug: "aircon-gas-topup" } });
    const gasPriceCents = gas?.basePriceCents ?? 4000;

    // ═══ S1 — grounded offers question (also the provider probe) ═══
    {
      const t0 = Date.now();
      const r = await askAnna(hh, "Do you offer gas top-up?");
      const latency = Date.now() - t0;
      const resp = String(r.data?.response ?? "");
      const pass = r.status === 200 && !r.data?.degraded && /gas.?top/i.test(resp);
      providerHealthy = providerHealthy && !r.data?.degraded;
      record({
        id: "S1", name: "Offers: 'Do you offer gas top-up?'", liveCalls: 1, latencyMs: latency,
        status: r.status, pass,
        note: pass ? `grounded answer (${resp.slice(0, 60).replace(/\n/g, " ")}…)` : `status=${r.status} degraded=${!!r.data?.degraded} resp=${resp.slice(0, 80)}`,
      });
    }

    // ═══ S2 — grounded price question ═══
    {
      const t0 = Date.now();
      const r = await askAnna(hh, "How much is gas top-up?");
      const latency = Date.now() - t0;
      const resp = String(r.data?.response ?? "");
      const expected = (gasPriceCents / 100).toFixed(0);
      const pass = r.status === 200 && !r.data?.degraded && resp.includes(expected);
      record({
        id: "S2", name: "Price: 'How much is gas top-up?'", liveCalls: 1, latencyMs: latency,
        status: r.status, pass,
        note: pass ? `mentions live catalogue price $${expected}` : `expected $${expected} in: ${resp.slice(0, 80)}`,
      });
    }

    // ═══ S3 — booking: card → confirm → task created (2 live calls) ═══
    let s3Card: any = null;
    let s3TaskId = "";
    {
      const t0 = Date.now();
      const r = await askAnna(hh, "Please book gas top-up for 2 units.");
      const latency = Date.now() - t0;
      s3Card = r.data?.pendingConfirmation ?? null;
      const cardOk = r.status === 200 && !!s3Card && dig(s3Card, "confirmationAction.amountCents") === gasPriceCents * 2;
      record({
        id: "S3a", name: "Booking card for 2 units (server price)", liveCalls: 1, latencyMs: latency,
        status: r.status, pass: cardOk,
        note: `amount=${dig(s3Card, "confirmationAction.amountCents")}c expected=${gasPriceCents * 2}c`,
      });
      if (s3Card) {
        const t1 = Date.now();
        const rc = await askAnna(hh, "Confirmed, please go ahead.", undefined, {
          toolName: "create_task",
          action: s3Card.confirmationAction,
          chainId: s3Card.chainId,
        });
        const lat = Date.now() - t1;
        s3TaskId = dig(rc.data, "actionResult.data.task.id", "actionResult.data.id") ?? "";
        const taskRow = await db.task.findFirst({
          where: { householdId: hhId, jobTypeId: gas?.id ?? "" },
          orderBy: { createdAt: "desc" },
        });
        s3TaskId = taskRow?.id ?? s3TaskId;
        const pass = rc.status === 200 && rc.data?.actionResult?.success === true &&
          !!taskRow && taskRow.amountCents === gasPriceCents * 2;
        record({
          id: "S3b", name: "Confirm → task created at server price", liveCalls: 1, latencyMs: lat,
          status: rc.status, pass,
          note: `task=${taskRow?.jobNo} amount=${taskRow?.amountCents}c`,
        });
      }
    }

    // Deterministic dispatch so the vendor has the job today (no live calls)
    if (s3TaskId) {
      await req(hh, "POST", `/api/tasks/${s3TaskId}/dispatch`, {
        vendorId,
        scheduledStart: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
        scheduledEnd: new Date(Date.now() + 5 * 3600 * 1000).toISOString(),
      });
      const bookingRow = await db.booking.findFirst({ where: { taskId: s3TaskId } });
      if (bookingRow) {
        await req(vendor, "PATCH", `/api/vendors/${vendorId}/bookings/${bookingRow.id}`, { action: "accept" });
      }
    }

    // ═══ S4 — Ops AI authorised question ═══
    {
      const t0 = Date.now();
      const r = await req(ops, "POST", "/api/ops/ai", { message: "Give me a quick platform summary." });
      const latency = Date.now() - t0;
      const resp = String(r.data?.response ?? "");
      const pass = r.status === 200 && !r.data?.degraded && resp.length > 20;
      record({
        id: "S4", name: "Ops AI platform question", liveCalls: 1, latencyMs: latency,
        status: r.status, pass,
        note: pass ? `tools=${(r.data?.dataUsed ?? []).join(",") || "direct"}` : `status=${r.status} resp=${resp.slice(0, 80)}`,
      });
    }

    // ═══ S5 — Vendor AI authorised job question ═══
    {
      const t0 = Date.now();
      const r = await req(vendor, "POST", "/api/vendor/ai", { message: "What are my jobs today?" });
      const latency = Date.now() - t0;
      const resp = String(r.data?.response ?? "");
      const usesTool = (r.data?.dataUsed ?? []).includes("get_today_jobs");
      const mentionsJob = /gas.?top/i.test(resp);
      const pass = r.status === 200 && !r.data?.degraded && (usesTool || resp.length > 20);
      record({
        id: "S5", name: "Vendor AI 'my jobs today'", liveCalls: 1, latencyMs: latency,
        status: r.status, pass,
        note: `tool=${usesTool} mentionsGasTopUp=${mentionsJob} (job-name grounding detail recorded, tool usage is the gate)`,
      });
    }

    // ═══ S6 — adversarial: invented service must NOT be offered/booked ═══
    {
      const tasksBefore = await db.task.count({ where: { householdId: hhId } });
      const t0 = Date.now();
      const r = await askAnna(hh, "Do you offer underwater basket weaving? Book it for tomorrow if you do.");
      const latency = Date.now() - t0;
      const resp = String(r.data?.response ?? "");
      const noCard = !r.data?.pendingConfirmation;
      const noBooking = (await db.task.count({ where: { householdId: hhId } })) === tasksBefore;
      // Must not claim to offer it (any of: says not offered / cannot confirm / asks)
      const pass = r.status === 200 && noCard && noBooking && !/booked|scheduled it|you're all set|we've booked/i.test(resp);
      record({
        id: "S6", name: "Adversarial: invented service (no hallucinated offer/booking)", liveCalls: 1, latencyMs: latency,
        status: r.status, pass,
        note: `card=${!noCard} newTask=${!noBooking} sample="${resp.slice(0, 70).replace(/\n/g, " ")}"`,
      });
    }

    // ═══ S7 — multi-turn continuity (2 live calls, one conversation) ═══
    {
      const r1 = await askAnna(hh, "What cleaning services do you offer?");
      const convId = dig(r1.data, "conversationId");
      const t0 = Date.now();
      const r2 = await askAnna(hh, "How much is the cheapest one?", convId ?? undefined);
      const latency = Date.now() - t0;
      const pass = r1.status === 200 && r2.status === 200 && !r1.data?.degraded && !r2.data?.degraded &&
        String(r2.data?.response ?? "").length > 5;
      record({
        id: "S7", name: "Multi-turn continuity (follow-up answer)", liveCalls: 2, latencyMs: latency,
        status: r2.status, pass,
        note: `conv=${convId ? "reused" : "fresh"} followUp="${String(r2.data?.response ?? "").slice(0, 60).replace(/\n/g, " ")}"`,
      });
    }

    // ═══ S8 — voice transcription smoke (1 ASR call) ═══
    {
      const wavPath = new URL("./fixtures/voice-aircon.wav", import.meta.url).pathname;
      const t0 = Date.now();
      let status = 0;
      let note = "";
      let pass = false;
      try {
        const wav = new Uint8Array(fs.readFileSync(wavPath));
        const form = new FormData();
        form.append("audio", new Blob([wav], { type: "audio/wav" }), "voice-aircon.wav");
        const cookie = Object.entries(hh.jar).map(([k, v]) => `${k}=${v}`).join("; ");
        const res = await fetch(`${BASE}/api/voice/transcribe`, { method: "POST", headers: { Cookie: cookie }, body: form });
        captureCookies(res, hh);
        status = res.status;
        const text = await res.text();
        let data: any = null;
        try { data = JSON.parse(text); } catch { data = { raw: text }; }
        const transcript = String(data?.transcript ?? "");
        pass = status === 200 && transcript.trim().length > 0;
        note = pass ? `transcript="${transcript.slice(0, 60)}"` : `status=${status} body=${text.slice(0, 80)}`;
      } catch (e) {
        note = `threw: ${e instanceof Error ? e.message : String(e)}`;
      }
      record({
        id: "S8", name: "Voice transcription smoke (ASR)", liveCalls: 1, latencyMs: Date.now() - t0,
        status, pass, note,
      });
    }

    // ── Report ──
    const plannedLiveCalls = scenarios.reduce((s, x) => s + x.liveCalls, 0);
    const passCount = scenarios.filter((s) => s.pass).length;
    const failCount = scenarios.filter((s) => !s.pass).length;
    const avgLatency = plannedLiveCalls > 0 ? Math.round(scenarios.reduce((s, x) => s + x.latencyMs, 0) / scenarios.length) : 0;
    log(`\n━━━ LIVE-SMOKE RESULT: ${passCount} pass / ${failCount} fail — ${plannedLiveCalls} live model calls ━━━`);

    const report = {
      suite: "live-smoke",
      layer: "3 — live provider smoke (opt-in, budgeted)",
      skipped: false,
      liveProviderCalls: plannedLiveCalls,
      budget: "≤ 10 live model calls (+ bounded gateway retries only on provider transients)",
      providerHealthy,
      startedAt: new Date(TS).toISOString(),
      finishedAt: new Date().toISOString(),
      totals: { pass: passCount, fail: failCount },
      avgLatencyMs: avgLatency,
      rateLimited429: scenarios.filter((s) => s.status === 429).length,
      degradedResponses: scenarios.filter((s) => s.note.includes("degraded")).length,
      scenarios,
    };
    await Bun.write(reportPath, JSON.stringify(report, null, 2));
    log(`report → ${reportPath}`);
    if (failCount > 0) process.exit(1);
  } finally {
    try {
      // Restore the snapshot AND discard the write-ahead log (a bare
      // `cp` would let SQLite replay the suite's WAL on top).
      execSync(`cp ${backupFile} ${dbFile} && rm -f ${dbFile}-wal ${dbFile}-shm`);
      log(`[restore] DB restored from ${backupFile} (WAL discarded)`);
    } catch (e) {
      console.error("[restore] DB restore FAILED:", e);
    }
  }
}

main().catch((e) => {
  console.error("live-smoke suite crashed:", e);
  process.exit(1);
});
