/**
 * Anna.I OS — e2e/item8-fixes.ts
 * ============================================================
 * Item 8 (Phase 8A) — deterministic regression suite for F-1…F-10.
 *
 * Layer 1 only: HTTP against the running dev server + direct DB reads +
 * in-process tool/selector execution + source-text grounding checks.
 * ZERO LLM calls (the stub seam is not needed — the AI grounding proofs
 * exercise the seams, not the provider).
 *
 * Sections:
 *   R1   F-1  booking state flow: accepted → start(in_progress) → photos
 *            → complete; household in_progress no longer 409s; guards
 *   R2   F-2  rebook re-prices at CURRENT catalogue; original frozen
 *   R3   F-3  quotation linkage + PRICE_STALE 409 + authoritative
 *            fieldValues on the no-quotation catalogue path
 *   R4   F-4  /api/quote through quoteJobType: defaults + range
 *            validation (FIELD_OUT_OF_RANGE / UNITS_OUT_OF_RANGE)
 *   R6   F-6  AI grounding: literals gone (source), commission authority
 *            end-to-end into escrow + ledger-derived vendor payout
 *   R7   F-7  shared addon envelope (min/max/status) + v_bookings:addon
 *            RBAC gate (custom role denied, system role allowed)
 *   R8   F-8  escrow entry selection: booking-scoped live entry after a
 *            rematch (pure selector unit checks + schedule API)
 *   R9   F-9  config:configure actually gates config writes; demo admin
 *            unaffected
 *   R10  F-10 job-type category persists + validates (custom rejected,
 *            unknown id 404)
 *   R11  F-5  subscription pricing authority: HOME 800 / CARE 6800,
 *            module single declaration, ops-writer stamps (the 2000
 *            outlier), tier-change + notification copy, seeded rows
 *            never repriced, checkout fail-safe, alignment predicate
 *   R12  P2-2 explain route grounds narration in quoteJobType; custom-
 *            amount decoy removed (client source checks + route
 *            branches)
 *   R13  P2-3 Ops AI declares catalogue unavailability (prompt clause;
 *            no new tool — Item 9 scope guard)
 *
 * F-5 (subscription pricing) was an ARCHITECTURAL DECISION during 8A; the
 * owner has since confirmed the business prices (HOME S$8 / CARE S$68) and
 * the hybrid authority model was implemented in the final-review round —
 * R11 below regression-tests it (see docs/item8-f5-subscription-pricing.md).
 *
 * Run:  cd /home/z/my-project && bun e2e/item8-fixes.ts
 * ============================================================
 */

import { execSync } from "child_process";
import fs from "fs";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { executeVendorToolCall } from "@/lib/vendor-ai-tools";
import { liveEscrowEntries, pickPrimaryEscrowEntry } from "@/lib/escrow-display";
import {
  SUBSCRIPTION_TIER_PRICES,
  getTierPriceCents,
  stripePriceCentsForTier,
  isStripeTierPriceAligned,
} from "@/lib/subscription-pricing";
import { ROUTING_WEIGHTS } from "@/lib/routing";
import {
  VENDOR_PERFORMANCE_WINDOW,
} from "@/lib/vendor-ai-tools";
import { OPS_VENDOR_PERFORMANCE_WINDOW } from "@/lib/ops-ai-tools";

process.env.DATABASE_URL ??= "file:/home/z/my-project/db/custom.db";
const BASE = "http://localhost:3000";
const TS = Date.now();

interface Rec { suite: string; name: string; pass: boolean; detail: string }
const records: Rec[] = [];
const reportPath = new URL("./item8-fixes-report.json", import.meta.url).pathname;

function log(s: string) { console.log(s); }
function check(suite: string, name: string, pass: boolean, note = "") {
  records.push({ suite, name, pass, detail: pass ? note : `${note} FAILED` });
  log(`  ${pass ? "✓" : "✗ FAIL"} ${name}${note ? ` — ${note}` : ""}`);
}
function eq(suite: string, name: string, actual: unknown, expected: unknown, note = "") {
  const pass = actual === expected;
  records.push({
    suite, name, pass,
    detail: pass ? note : `${note} actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
  });
  log(`  ${pass ? "✓" : "✗ FAIL"} ${name}${pass ? (note ? ` — ${note}` : "") : ` — actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)} ${note}`}`);
}
function section(suite: string) { log(`\n━━━ ${suite} ━━━`); }

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
async function req(actor: Actor | null, method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {};
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

async function uploadPhoto(actor: Actor, vendorId: string, bookingId: string, label = `item8-${TS}`): Promise<{ status: number; data: any }> {
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

const C = {
  householdId: "",
  vendor1Id: "",
  vendor2Id: "",
  vendor1Email: `item8-v1-${TS}@anna.test`,
  vendor2Email: `item8-v2-${TS}@anna.test`,
  vendorPassword: "vendorPass123",
  hhEmail: `item8-hh-${TS}@anna.test`,
  hhPassword: "hhPass123",
  gasJobTypeId: "",
  chemicalJobTypeId: "",
};

const GAS_PRICE_ORIGINAL = 4000; // $40/unit (seed)

const dbFile = "/home/z/my-project/db/custom.db";
const backupFile = `/home/z/my-project/db/backups/item8-${TS}.db`;

async function createCatalogueTask(hh: Actor, fieldValues: Record<string, number>, idem: string, instructions = "item8 task") {
  const r = await req(hh, "POST", "/api/tasks", {
    householdId: C.householdId,
    category: "AIRCON",
    jobTypeId: C.gasJobTypeId,
    amountCents: 100, // tampered — must be ignored (catalogue authority)
    units: undefined,
    fieldValues,
    instructions,
    scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString(),
    idempotencyKey: idem,
  });
  return r;
}

async function main() {
  log(`━━━ ITEM8-FIXES · ${new Date().toISOString()} ━━━`);
  execSync(`mkdir -p /home/z/my-project/db/backups && cp ${dbFile} ${backupFile}`);

  // F-5 (R11): snapshot of the seeded subscription rows, verified intact
  // again in the DEMO section after all suite mutations.
  let seededSubsBefore: { id: string; priceCents: number }[] = [];

  const hh = newActor("household");
  const ops = newActor("ops-admin");
  const v1 = newActor("vendor-1");
  const v2 = newActor("vendor-2");

  try {
    // ═══════════ SETUP ═══════════
    section("SETUP — actors + catalogue fixtures");
    {
      const r1 = await req(ops, "POST", "/api/ops/auth", { email: "eugene@annai.sg", password: "anna1234" });
      eq("SETUP", "Ops demo admin login (legacy credential)", r1.status, 200);

      const reg = await req(hh, "POST", "/api/household/register", {
        name: `Item8 HH ${TS}`,
        email: C.hhEmail,
        password: C.hhPassword,
        householdName: `Item8 Family ${TS}`,
      });
      const sess = await req(hh, "GET", "/api/household/session");
      C.householdId = dig(sess.data, "household.id", "member.householdId", "session.householdId", "householdId") ?? "";
      check("SETUP", "Household registered + session", reg.status <= 201 && !!C.householdId, `hh=${C.householdId.slice(-6)}`);

      for (const [actor, email] of [[v1, C.vendor1Email], [v2, C.vendor2Email]] as const) {
        const intake = await req(ops, "POST", "/api/ops/vendors", {
          companyName: `Item8Aircon ${email.slice(7, 16)} ${TS}`,
          contactPerson: "Item8 Lead",
          contactEmail1: email,
          contactPhone1: "91234567",
          phone: "91234567",
          categories: ["AIRCON"],
          zones: ["east"],
          vendorType: "MICRO",
          password: C.vendorPassword,
        });
        const vendorId = dig(intake.data, "vendor.id", "id") ?? "";
        await req(ops, "PATCH", `/api/ops/vendors/${vendorId}`, { status: "ACTIVE" });
        const vlogin = await req(actor, "POST", "/api/vendor/auth", { email, password: C.vendorPassword });
        actor.bearer = dig(vlogin.data, "token") ?? undefined;
        if (email === C.vendor1Email) C.vendor1Id = vendorId; else C.vendor2Id = vendorId;
        check("SETUP", `Vendor ${email === C.vendor1Email ? "1" : "2"} created + login`, !!vendorId && vlogin.status === 200, `vendor=${vendorId.slice(-6)}`);
      }

      const gas = await db.serviceJobType.findUnique({ where: { slug: "aircon-gas-topup" } });
      const chemical = await db.serviceJobType.findUnique({ where: { slug: "aircon-chemical-wash" } });
      C.gasJobTypeId = gas?.id ?? "";
      C.chemicalJobTypeId = chemical?.id ?? "";
      check("SETUP", "Catalogue fixtures (gas-topup, chemical-wash)", !!gas && gas.basePriceCents === GAS_PRICE_ORIGINAL && !!chemical, `gas=${gas?.basePriceCents}c/unit`);

      // Snapshot the SEEDED subscription rows (F-5/R11): the demo DB holds
      // only HOME/800 — R11 mutations must never reprice them, and the DEMO
      // section re-verifies each row kept its exact price.
      seededSubsBefore = (await db.subscription.findMany({
        select: { id: true, priceCents: true, tier: true, status: true },
      })).map((s) => ({ id: s.id, priceCents: s.priceCents }));
      check("SETUP", "Subscription baseline snapshot (demo rows, expect HOME/800 only)",
        seededSubsBefore.length > 0 && seededSubsBefore.every((s) => s.priceCents === 800),
        `rows=${seededSubsBefore.length}`);
    }

    // ═══════════ R6 (F-6) — runs FIRST: commission authority end-to-end ═══════════
    // This block must precede every booking accept in the suite: the
    // commission reader has a 60s in-process cache, and earlier accepts
    // would populate it with 10 — a same-process save_commission normally
    // invalidates it, but dev-server hot reloads can duplicate the module
    // graph and race the invalidation. Running FIRST gives a cold cache,
    // which is deterministic.
    section("R6 (F-6) — AI grounding: literals gone, authority wired end-to-end");
    {
      // Source-level grounding proofs (the prompts are per-request built
      // from authoritative sources — the stale literals must be gone).
      const askAnnaSrc = fs.readFileSync("src/app/api/ask-anna/route.ts", "utf8");
      check("R6", "Ask Anna prompt: no hard-coded '10% platform commission'", !askAnnaSrc.includes("10% platform commission"));
      check("R6", "Ask Anna prompt: commission placeholder + getCommissionRate wired",
        askAnnaSrc.includes("{COMMISSION_LINE}") && askAnnaSrc.includes("getCommissionRate"));

      const vendorAiSrc = fs.readFileSync("src/app/api/vendor/ai/route.ts", "utf8");
      check("R6", "Vendor AI prompt: no 'Platform takes 10%'", !vendorAiSrc.includes("Platform takes 10%"));
      check("R6", "Vendor AI prompt: invented '1-3 business days' SLA REMOVED", !vendorAiSrc.includes("1-3 business days"));
      check("R6", "Vendor AI prompt: timeout/attempts/commission/photo placeholders",
        vendorAiSrc.includes("{TIMEOUT_MINUTES}") && vendorAiSrc.includes("{MAX_ATTEMPTS}")
        && vendorAiSrc.includes("{COMMISSION_RATE}") && vendorAiSrc.includes("{PHOTO_VERIFICATION_BLOCK}"));
      check("R6", "Vendor AI prompt: getRequireVerificationPhotos wired", vendorAiSrc.includes("getRequireVerificationPhotos"));

      const opsAiSrc = fs.readFileSync("src/app/api/ops/ai/route.ts", "utf8");
      check("R6", "Ops AI prompt: no '11 TaskStatus states' (schema has 12)", !opsAiSrc.includes("11 TaskStatus states"));
      check("R6", "Ops AI prompt: no hard-coded 'Platform commission: 10%'", !opsAiSrc.includes("Platform commission: 10%"));
      check("R6", "Ops AI prompt: routing weights derived from ROUTING_WEIGHTS", opsAiSrc.includes("ROUTING_WEIGHTS"));
      check("R6", "Ops AI prompt: TaskStatus enum count derived", opsAiSrc.includes("TaskStatus"));

      const vatSrc = fs.readFileSync("src/lib/vendor-ai-tools.ts", "utf8");
      check("R6", "Vendor AI tools: hard-coded * 0.9 payout fallback REMOVED", !vatSrc.includes("* 0.9"));

      // Shared constants: prompt↔engine consistency seams
      eq("R6", "ROUTING_WEIGHTS exported (engine + prompt single source)", ROUTING_WEIGHTS.base, 100);
      eq("R6", "Vendor performance window exported (prompt matches tool)", VENDOR_PERFORMANCE_WINDOW, 10);
      eq("R6", "Ops vendor performance window exported (prompt matches tool)", OPS_VENDOR_PERFORMANCE_WINDOW, 10);

      // ── Commission authority END-TO-END into the escrow ledger ──
      // Ops sets 12% → a fresh accept must stamp 12% commission on the
      // ledger (the old hard-coded paths would still write 10%).
      await req(ops, "POST", "/api/ops/config", { action: "save_commission", commissionRate: 12 });
      const t = await createCatalogueTask(hh, { unitCount: 1 }, `item8-r6-${TS}`, "item8 commission probe");
      const taskId = dig(t.data, "task.id") ?? "";
      await req(hh, "POST", `/api/tasks/${taskId}/dispatch`, { vendorId: C.vendor2Id, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });
      const b = await db.booking.findFirst({ where: { taskId } });
      const acc = await req(v2, "PATCH", `/api/vendors/${C.vendor2Id}/bookings/${b?.id}`, { action: "accept" });
      eq("R6", "Accept under 12% commission → 200", acc.status, 200);
      const entry = await db.escrowLedger.findFirst({ where: { bookingId: b?.id, state: "HELD" } });
      const heldCents = entry?.amountCents ?? 0;
      eq("R6", "Ledger commissionCents = 12% of held amount (Ops-configured, not 10%)",
        entry?.commissionCents, Math.round(heldCents * 0.12));
      eq("R6", "Ledger commissionRate stamped 12", entry?.commissionRate, 12);

      // Vendor AI payout narrated from the LEDGER (in-process tool — zero
      // LLM calls). Expected: held − 12% commission. The old fallback would
      // have said amount × 0.9.
      const details = await executeVendorToolCall("get_job_details", { bookingId: b?.id }, C.vendor2Id);
      const payoutStr = String((details.data as any)?.yourPayout ?? "");
      const expectedPayout = heldCents - Math.round(heldCents * 0.12);
      const oldFallback = Math.round(heldCents * 0.9);
      check("R6", "Vendor AI yourPayout = LEDGER-derived (SGD format)",
        payoutStr.includes(`$${(expectedPayout / 100).toFixed(2)}`) && !payoutStr.includes(`$${(oldFallback / 100).toFixed(2)}`),
        `payout="${payoutStr}" expected=SGD $${(expectedPayout / 100).toFixed(2)} (old-fallback would say $${(oldFallback / 100).toFixed(2)})`);

      // Restore commission to 10 (demo state preserved)
      await req(ops, "POST", "/api/ops/config", { action: "save_commission", commissionRate: 10 });
    }

    // ═══════════ R1 (F-1) ═══════════
    section("R1 (F-1) — accepted → start → in_progress → photos → complete");
    let r1TaskId = "";
    let r1BookingId = "";
    {
      const t = await createCatalogueTask(hh, { unitCount: 1 }, `item8-r1-${TS}`);
      r1TaskId = dig(t.data, "task.id") ?? "";
      check("R1", "Catalogue task created", t.status === 201 && !!r1TaskId, `task=${r1TaskId.slice(-6)}`);

      await req(hh, "POST", `/api/tasks/${r1TaskId}/dispatch`, {
        vendorId: C.vendor1Id,
        scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString(),
        scheduledEnd: new Date(Date.now() + 29 * 3600 * 1000).toISOString(),
      });
      const bookingRow = await db.booking.findFirst({ where: { taskId: r1TaskId } });
      r1BookingId = bookingRow?.id ?? "";
      const acc = await req(v1, "PATCH", `/api/vendors/${C.vendor1Id}/bookings/${r1BookingId}`, { action: "accept" });
      eq("R1", "Vendor accept → 200", acc.status, 200);

      // ── START: the previously-unreachable in_progress state ──
      const start = await req(v1, "PATCH", `/api/vendors/${C.vendor1Id}/bookings/${r1BookingId}`, { action: "start" });
      eq("R1", "Vendor 'start' action → 200 (was 400 unknown action)", start.status, 200);
      const started = await db.booking.findUnique({ where: { id: r1BookingId } });
      const startedTask = await db.task.findUnique({ where: { id: r1TaskId } });
      eq("R1", "Booking → in_progress with actualStart stamped", started?.status, "in_progress");
      check("R1", "Task → IN_PROGRESS with inProgressAt", startedTask?.status === "IN_PROGRESS" && !!startedTask?.inProgressAt, `task=${startedTask?.status}`);

      // Photo upload now reachable from in_progress (portal gate condition)
      const up = await uploadPhoto(v1, C.vendor1Id, r1BookingId, `item8-r1-${TS}`);
      eq("R1", "Verification photo upload from in_progress → 200 (portal flow unblocked)", up.status, 200);

      const complete = await req(v1, "PATCH", `/api/vendors/${C.vendor1Id}/bookings/${r1BookingId}`, { action: "complete", completionNotes: "item8 complete" });
      eq("R1", "Vendor complete from in_progress → 200 (photo gate satisfied)", complete.status, 200);
      const doneTask = await db.task.findUnique({ where: { id: r1TaskId } });
      eq("R1", "Task → COMPLETED", doneTask?.status, "COMPLETED");
      const verify = await req(hh, "POST", `/api/tasks/${r1TaskId}/verify`, { bookingId: r1BookingId });
      eq("R1", "Household verify → 200", verify.status, 200);

      // ── Household-side in_progress (previously always 409) ──
      const t2 = await createCatalogueTask(hh, { unitCount: 1 }, `item8-r1b-${TS}`);
      const t2Id = dig(t2.data, "task.id") ?? "";
      await req(hh, "POST", `/api/tasks/${t2Id}/dispatch`, { vendorId: C.vendor1Id, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });
      const b2 = await db.booking.findFirst({ where: { taskId: t2Id } });
      await req(v1, "PATCH", `/api/vendors/${C.vendor1Id}/bookings/${b2?.id}`, { action: "accept" });
      const hhStart = await req(hh, "PATCH", `/api/bookings/${b2?.id}`, { status: "in_progress" });
      eq("R1", "Household 'in_progress' PATCH → 200 (was always 409)", hhStart.status, 200);

      // ── Guards: dead-end states refuse transitions ──
      const startAgain = await req(v1, "PATCH", `/api/vendors/${C.vendor1Id}/bookings/${r1BookingId}`, { action: "start" });
      eq("R1", "start on completed booking → 409", startAgain.status, 409);
      const cancelB2 = await req(hh, "PATCH", `/api/bookings/${b2?.id}`, { status: "cancelled" });
      eq("R1", "Household cancels the in_progress booking → 200", cancelB2.status, 200);
      const zombie = await req(hh, "PATCH", `/api/bookings/${b2?.id}`, { status: "in_progress" });
      eq("R1", "in_progress on cancelled booking → 409 (state machine holds)", zombie.status, 409);
    }

    // ═══════════ R2 (F-2) ═══════════
    section("R2 (F-2) — rebook re-prices at the CURRENT catalogue; original frozen");
    {
      // Quotation-path booking (field values carried by the quotation)
      const q = await req(hh, "POST", "/api/quote", {
        householdId: C.householdId,
        jobTypeId: C.gasJobTypeId,
        fieldValues: { unitCount: 2 },
        selectedAddOns: [],
      });
      const quotationId = dig(q.data, "quotation.id") ?? "";
      eq("R2", "Quote 2 units at $40 = $80", dig(q.data, "quotation.totalCents"), 8000);

      const t = await req(hh, "POST", "/api/tasks", {
        householdId: C.householdId,
        category: "AIRCON",
        jobTypeId: C.gasJobTypeId,
        quotationId,
        amountCents: 100,
        instructions: "item8 R2 original",
        scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString(),
        idempotencyKey: `item8-r2-${TS}`,
      });
      const r2TaskId = dig(t.data, "task.id") ?? "";
      eq("R2", "Original task created at quoted $80 (quotation path)", t.data?.task?.amountCents, 8000);

      // Drive to a REBOOKABLE status
      await req(hh, "POST", `/api/tasks/${r2TaskId}/dispatch`, { vendorId: C.vendor1Id, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });
      const rb = await db.booking.findFirst({ where: { taskId: r2TaskId } });
      await req(v1, "PATCH", `/api/vendors/${C.vendor1Id}/bookings/${rb?.id}`, { action: "accept" });
      await uploadPhoto(v1, C.vendor1Id, rb?.id ?? "", `item8-r2-${TS}`);
      await req(v1, "PATCH", `/api/vendors/${C.vendor1Id}/bookings/${rb?.id}`, { action: "complete" });
      await req(hh, "POST", `/api/tasks/${r2TaskId}/verify`, { bookingId: rb?.id });

      // ── Change the Ops catalogue price: $40 → $45 ──
      await req(ops, "POST", "/api/ops/config", { action: "update_job_type_price", id: C.gasJobTypeId, priceCents: 4500 });

      // ── Rebook: NEW booking must use Price B ($45 × 2 = $90) ──
      const rebook = await req(hh, "POST", `/api/tasks/${r2TaskId}/rebook`);
      const newTaskId = dig(rebook.data, "task.id") ?? "";
      eq("R2", "Rebook → 201", rebook.status, 201);
      eq("R2", "NEW rebook priced at CURRENT catalogue ($45 × 2 = $90)", rebook.data?.task?.amountCents, 9000);
      eq("R2", "NEW rebook carries the jobTypeId + catalogue pricingSource", rebook.data?.task?.jobTypeId, C.gasJobTypeId);
      eq("R2", "Rebook pricingSource stamp", dig(rebook.data, "task.metadata.pricingSource") ?? (rebook.data?.task?.metadata as any)?.pricingSource, "catalogue");

      // ── ORIGINAL booking stays frozen at Price A ($80) ──
      const original = await db.task.findUnique({ where: { id: r2TaskId } });
      eq("R2", "ORIGINAL task still at $80 (snapshot rule)", original?.amountCents, 8000);

      // Restore the price for later sections
      await req(ops, "POST", "/api/ops/config", { action: "update_job_type_price", id: C.gasJobTypeId, priceCents: GAS_PRICE_ORIGINAL });
    }

    // ═══════════ R3 (F-3) ═══════════
    section("R3 (F-3) — quote linkage, PRICE_STALE, authoritative fieldValues");
    {
      // Quotation for gas; booking targets chemical → linkage rejected
      const q = await req(hh, "POST", "/api/quote", {
        householdId: C.householdId,
        jobTypeId: C.gasJobTypeId,
        fieldValues: { unitCount: 1 },
        selectedAddOns: [],
      });
      const quotationId = dig(q.data, "quotation.id") ?? "";
      const mismatch = await req(hh, "POST", "/api/tasks", {
        householdId: C.householdId,
        category: "AIRCON",
        jobTypeId: C.chemicalJobTypeId,
        quotationId,
        amountCents: 5000,
      });
      eq("R3", "Quotation↔jobType mismatch → 400 QUOTATION_JOB_TYPE_MISMATCH", mismatch.status, 400);
      eq("R3", "Mismatch error code", mismatch.data?.code, "QUOTATION_JOB_TYPE_MISMATCH");

      // Price changes between quote and booking → 409 PRICE_STALE
      await req(ops, "POST", "/api/ops/config", { action: "update_job_type_price", id: C.gasJobTypeId, priceCents: 5200 });
      const stale = await req(hh, "POST", "/api/tasks", {
        householdId: C.householdId,
        category: "AIRCON",
        jobTypeId: C.gasJobTypeId,
        quotationId,
        amountCents: 4000,
        idempotencyKey: `item8-r3-stale-${TS}`,
      });
      eq("R3", "Stale quotation (price changed since display) → 409", stale.status, 409);
      eq("R3", "Stale error code = PRICE_STALE", stale.data?.code, "PRICE_STALE");
      const tasksForStaleQuote = await db.task.count({ where: { quotationId } });
      eq("R3", "No task created from the stale quotation", tasksForStaleQuote, 0);

      // No-quotation catalogue path: server prices from the AUTHORITATIVE
      // field values the client passes (not silent defaults)
      const t3 = await req(hh, "POST", "/api/tasks", {
        householdId: C.householdId,
        category: "AIRCON",
        jobTypeId: C.gasJobTypeId,
        amountCents: 100,
        fieldValues: { unitCount: 3 },
        instructions: "item8 R3 fieldValues",
        scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString(),
        idempotencyKey: `item8-r3-fv-${TS}`,
      });
      eq("R3", "fieldValues path: 3 units × $52 = $156 (NOT defaults)", t3.data?.task?.amountCents, 15600);

      await req(ops, "POST", "/api/ops/config", { action: "update_job_type_price", id: C.gasJobTypeId, priceCents: GAS_PRICE_ORIGINAL });
    }

    // ═══════════ R4 (F-4) ═══════════
    section("R4 (F-4) — /api/quote through the authoritative pipeline");
    {
      const over = await req(hh, "POST", "/api/quote", {
        householdId: C.householdId, jobTypeId: C.gasJobTypeId,
        fieldValues: { unitCount: 99 }, selectedAddOns: [],
      });
      eq("R4", "unitCount 99 (max 5) → 400 (was accepted, uncapped)", over.status, 400);

      const negative = await req(hh, "POST", "/api/quote", {
        householdId: C.householdId, jobTypeId: C.gasJobTypeId,
        fieldValues: { unitCount: -3 }, selectedAddOns: [],
      });
      eq("R4", "Negative unitCount → 400", negative.status, 400);

      const zero = await req(hh, "POST", "/api/quote", {
        householdId: C.householdId, jobTypeId: C.gasJobTypeId,
        fieldValues: { unitCount: 0 }, selectedAddOns: [],
      });
      eq("R4", "Zero unitCount → 400", zero.status, 400);

      const defaults = await req(hh, "POST", "/api/quote", {
        householdId: C.householdId, jobTypeId: C.gasJobTypeId,
        fieldValues: {}, selectedAddOns: [],
      });
      eq("R4", "Empty fieldValues → defaults seeded (1 unit × $40 = $40)", dig(defaults.data, "quotation.totalCents"), 4000);

      const unknown = await req(hh, "POST", "/api/quote", {
        householdId: C.householdId, jobTypeId: "nonexistent-jobtype",
        fieldValues: {}, selectedAddOns: [],
      });
      eq("R4", "Unknown jobTypeId → 404", unknown.status, 404);
    }

    // ═══════════ R7 (F-7) ═══════════
    section("R7 (F-7) — shared addon envelope + v_bookings:addon RBAC");
    let r7BookingId = "";
    {
      const t = await createCatalogueTask(hh, { unitCount: 1 }, `item8-r7-${TS}`, "item8 addon envelope");
      const taskId = dig(t.data, "task.id") ?? "";
      await req(hh, "POST", `/api/tasks/${taskId}/dispatch`, { vendorId: C.vendor1Id, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });
      const b = await db.booking.findFirst({ where: { taskId } });
      r7BookingId = b?.id ?? "";
      await req(v1, "PATCH", `/api/vendors/${C.vendor1Id}/bookings/${r7BookingId}`, { action: "accept" });

      const tooSmall = await req(v1, "POST", `/api/vendors/${C.vendor1Id}/bookings/${r7BookingId}/addons`, {
        description: "desc", amountCents: 25,
      });
      eq("R7", "Vendor addon below $0.50 min → 400 (was accepted, no minimum)", tooSmall.status, 400);

      const tooBig = await req(v1, "POST", `/api/vendors/${C.vendor1Id}/bookings/${r7BookingId}/addons`, {
        description: "desc", amountCents: 1_000_001,
      });
      eq("R7", "Vendor addon above $10k cap → 400 (was $100k)", tooBig.status, 400);

      const badDesc = await req(v1, "POST", `/api/vendors/${C.vendor1Id}/bookings/${r7BookingId}/addons`, {
        description: "x", amountCents: 500,
      });
      eq("R7", "Vendor addon 1-char description → 400 (shared envelope)", badDesc.status, 400);

      // ── RBAC: a custom role WITHOUT v_bookings:addon is denied ──
      const viewPerm = await db.permission.findUnique({ where: { module_action: { module: "v_bookings", action: "view" } } });
      const deniedRole = await db.role.create({
        data: { name: `Item8 NoAddon ${TS}`, slug: `item8-noaddon-${TS}`, description: "item8 test role", level: 1 },
      });
      await db.rolePermission.create({
        data: { roleId: deniedRole.id, permissionId: viewPerm!.id },
      });
      const originalRoleId = (await db.vendor.findUnique({ where: { id: C.vendor1Id }, select: { roleId: true } }))?.roleId;
      await db.vendor.update({ where: { id: C.vendor1Id }, data: { roleId: deniedRole.id } });
      const denied = await req(v1, "POST", `/api/vendors/${C.vendor1Id}/bookings/${r7BookingId}/addons`, {
        description: "valid description", amountCents: 500,
      });
      eq("R7", "Custom role without v_bookings:addon → 403 (gate is real)", denied.status, 403);
      await db.vendor.update({ where: { id: C.vendor1Id }, data: { roleId: originalRoleId } });
      await db.role.delete({ where: { id: deniedRole.id } });

      // ── System role (grandfathered) can propose; the money flow starts
      // as a PENDING proposal the household must approve ──
      const allowed = await req(v1, "POST", `/api/vendors/${C.vendor1Id}/bookings/${r7BookingId}/addons`, {
        description: "Extra filter replacement", amountCents: 500,
      });
      eq("R7", "System-role vendor addon proposal → 201 (demo access preserved)", allowed.status, 201);
      eq("R7", "Proposal stored as PENDING (household approval required)", allowed.data?.addon?.status, "pending");

      // ── Share-link surface uses the SAME envelope ──
      const share = await req(v1, "POST", `/api/vendors/${C.vendor1Id}/bookings/${r7BookingId}/share`, {});
      const token = share.data?.token ?? "";
      const shareTooSmall = await req(null, "POST", `/api/j/share/${token}/addons`, { description: "desc", amountCents: 25 });
      eq("R7", "Share-link addon below min → 400 (identical envelope)", shareTooSmall.status, 400);
      const shareOk = await req(null, "POST", `/api/j/share/${token}/addons`, { description: "Share surface charge", amountCents: 750 });
      eq("R7", "Share-link addon valid → 201", shareOk.status, 201);

      // Status allowlist: completed booking refuses proposals
      await uploadPhoto(v1, C.vendor1Id, r7BookingId, `item8-r7c-${TS}`);
      await req(v1, "PATCH", `/api/vendors/${C.vendor1Id}/bookings/${r7BookingId}`, { action: "complete" });
      const onCompleted = await req(v1, "POST", `/api/vendors/${C.vendor1Id}/bookings/${r7BookingId}/addons`, {
        description: "late charge", amountCents: 500,
      });
      eq("R7", "Addon on completed booking → 409 (status allowlist)", onCompleted.status, 409);
    }

    // ═══════════ R8 (F-8) ═══════════
    section("R8 (F-8) — live escrow entry selection (relationship + status)");
    {
      // Pure-selector unit checks
      const e1 = { id: "e1", bookingId: "b1", state: "VOIDED", heldAt: "2026-01-01T00:00:00Z" };
      const e2 = { id: "e2", bookingId: "b2", state: "HELD", heldAt: "2026-02-01T00:00:00Z" };
      const e3 = { id: "e3", bookingId: "b2", state: "RELEASED", heldAt: "2026-03-01T00:00:00Z" };
      eq("R8", "Selector: VOIDED-first array → picks the live HELD entry (not [0])", pickPrimaryEscrowEntry([e1, e2, e3])?.id, "e2");
      eq("R8", "Selector: booking-scoped → that booking's own entry", pickPrimaryEscrowEntry([e1, e2, e3], { bookingId: "b1" })?.id, "e1");
      eq("R8", "Selector: unknown booking → null (never another booking's entry)", pickPrimaryEscrowEntry([e1, e2], { bookingId: "bX" }), null);
      eq("R8", "Selector: HELD outranks a more-recent RELEASED", pickPrimaryEscrowEntry([e3, e2])?.id, "e2");
      eq("R8", "Selector: all-VOIDED → honest VOIDED (last resort)", pickPrimaryEscrowEntry([e1])?.id, "e1");
      eq("R8", "Selector: empty → null", pickPrimaryEscrowEntry([]), null);

      // ── Live rematch flow through the schedule API ──
      const t = await createCatalogueTask(hh, { unitCount: 1 }, `item8-r8-${TS}`, "item8 rematch escrow");
      const taskId = dig(t.data, "task.id") ?? "";
      await req(hh, "POST", `/api/tasks/${taskId}/dispatch`, { vendorId: C.vendor1Id, scheduledStart: new Date(Date.now() + 26 * 3600 * 1000).toISOString() });
      const b1 = await db.booking.findFirst({ where: { taskId, vendorId: C.vendor1Id } });
      await req(v1, "PATCH", `/api/vendors/${C.vendor1Id}/bookings/${b1?.id}`, { action: "accept" });
      const entry1 = await db.escrowLedger.findFirst({ where: { bookingId: b1?.id, state: "HELD" } });
      check("R8", "Rematch setup: vendor1 hold exists", !!entry1, `entry=${entry1?.id.slice(-6)}`);

      // Household cancels booking1 → task back to MATCHING → dispatch v2 →
      // v2 accepts → entry1 VOIDED + new entry2 HELD (F19/E4 semantics)
      await req(hh, "PATCH", `/api/bookings/${b1?.id}`, { status: "cancelled" });
      await req(hh, "POST", `/api/tasks/${taskId}/dispatch`, { vendorId: C.vendor2Id, scheduledStart: new Date(Date.now() + 27 * 3600 * 1000).toISOString() });
      const b2 = await db.booking.findFirst({ where: { taskId, vendorId: C.vendor2Id } });
      await req(v2, "PATCH", `/api/vendors/${C.vendor2Id}/bookings/${b2?.id}`, { action: "accept" });
      const entry1After = await db.escrowLedger.findUnique({ where: { id: entry1!.id } });
      const entry2 = await db.escrowLedger.findFirst({ where: { bookingId: b2?.id, state: "HELD" } });
      eq("R8", "Rematch: original hold VOIDED", entry1After?.state, "VOIDED");
      check("R8", "Rematch: new live hold for booking2", !!entry2, `entry=${entry2?.id.slice(-6)}`);

      // Vendor2's schedule shows ITS OWN live HELD entry — the array is
      // [VOIDED-entry1, HELD-entry2] ordered by heldAt, so the old [0]
      // pick would have displayed the dead entry.
      const s2 = await req(v2, "GET", `/api/vendors/${C.vendor2Id}/schedule`);
      const item2 = (s2.data?.schedule ?? []).find((i: any) => i.id === b2?.id);
      eq("R8", "Vendor2 schedule: escrow = the LIVE entry (was [0]=VOIDED)", item2?.escrow?.id, entry2?.id);
      eq("R8", "Vendor2 schedule: escrow state HELD", item2?.escrow?.state, "HELD");

      // Vendor1's schedule shows its OWN (voided) entry — never booking2's
      const s1 = await req(v1, "GET", `/api/vendors/${C.vendor1Id}/schedule`);
      const item1 = (s1.data?.schedule ?? []).find((i: any) => i.id === b1?.id);
      eq("R8", "Vendor1 schedule: escrow = its OWN entry (booking-scoped, not [0]=new-entry)", item1?.escrow?.id, entry1?.id);

      // ── P2-1 (Item 8 final review): display aggregates sum LIVE entries ──
      // The VOIDED hold keeps its original figures (voiding never zeroes
      // them) — every surface that reduced the raw list overstated the
      // money. liveEscrowEntries is the shared aggregation filter.
      eq("R8", "liveEscrowEntries: drops the VOIDED entry (task-level)", liveEscrowEntries([e1, e2, e3]).map((x: any) => x.id).join(","), "e2,e3");
      eq("R8", "liveEscrowEntries: booking-scoped keeps base + addon entries of THAT booking", liveEscrowEntries([e1, e2, e3], { bookingId: "b2" }).map((x: any) => x.id).join(","), "e2,e3");
      eq("R8", "liveEscrowEntries: booking scope drops other bookings' entries (incl. live)", liveEscrowEntries([e1, e2, e3], { bookingId: "b1" }).length, 0);
      const eR = { id: "eR", bookingId: "b2", state: "REFUNDED", heldAt: "2026-04-01T00:00:00Z" };
      eq("R8", "liveEscrowEntries: REFUNDED entries KEPT (real money history)", liveEscrowEntries([e1, eR, e2]).map((x: any) => x.id).join(","), "eR,e2");
      eq("R8", "liveEscrowEntries: null/empty → []", liveEscrowEntries(null).length + liveEscrowEntries([]).length, 0);

      // The vendor2 schedule card's payout banner data: the API returns the
      // TASK-LEVEL entries (incl. booking1's VOIDED hold). The banner now
      // computes liveEscrowEntries(entries, { bookingId: item.id }) — prove
      // the exact computation the component performs excludes the dead
      // entry's payout (the raw-list reduce would sum BOTH).
      const liveItem2Entries = item2?.escrowEntries ?? [];
      const voidedPayout = entry1After?.vendorPayoutCents ?? 0;
      const livePayoutSum = liveEscrowEntries(liveItem2Entries, { bookingId: b2?.id })
        .reduce((s: number, e: any) => s + (e.vendorPayoutCents || 0), 0);
      const rawPayoutSum = (liveItem2Entries as any[]).reduce(
        (s: number, e: any) => s + (e.vendorPayoutCents || 0), 0);
      eq("R8", "P2-1: vendor payout sum over LIVE booking-scoped entries excludes the VOIDED payout", livePayoutSum, rawPayoutSum - voidedPayout);
      check("R8", "P2-1: the raw-list sum would overstate (defect is real on this data)", rawPayoutSum === livePayoutSum + voidedPayout && voidedPayout > 0, `live=${livePayoutSum}c raw=${rawPayoutSum}c voided=${voidedPayout}c`);
    }

    // ═══════════ R9 (F-9) ═══════════
    section("R9 (F-9) — config:configure permission actually gates writes");
    {
      // Coordinator (config:view, NO configure) → 403
      const coordinatorRole = await db.role.findUnique({ where: { slug: "coordinator" } });
      const coordEmail = `item8-coord-${TS}@anna.test`;
      const hash = bcrypt.hashSync("coordPass123", 10);
      await db.opsUser.create({
        data: {
          name: `Item8 Coordinator ${TS}`,
          email: coordEmail,
          passwordHash: hash,
          role: "COORDINATOR",
          roleId: coordinatorRole!.id,
          isActive: true,
        },
      });
      const coord = newActor("ops-coordinator");
      const clogin = await req(coord, "POST", "/api/ops/auth", { email: coordEmail, password: "coordPass123" });
      eq("R9", "Coordinator login → 200", clogin.status, 200);
      const denied = await req(coord, "POST", "/api/ops/config", { action: "save_commission", commissionRate: 10 });
      eq("R9", "Coordinator (no config:configure) → 403 (was 'Admin only', now the real permission)", denied.status, 403);

      // Custom role WITH config:configure → allowed
      const configurePerm = await db.permission.findUnique({ where: { module_action: { module: "config", action: "configure" } } });
      const allowedRole = await db.role.create({
        data: { name: `Item8 Configurer ${TS}`, slug: `item8-configurer-${TS}`, description: "item8 test role", level: 2 },
      });
      await db.rolePermission.create({ data: { roleId: allowedRole.id, permissionId: configurePerm!.id } });
      const cfgEmail = `item8-cfg-${TS}@anna.test`;
      await db.opsUser.create({
        data: {
          name: `Item8 Configurer ${TS}`,
          email: cfgEmail,
          passwordHash: bcrypt.hashSync("cfgPass123", 10),
          role: "COORDINATOR",
          roleId: allowedRole.id,
          isActive: true,
        },
      });
      const cfgUser = newActor("ops-configurer");
      await req(cfgUser, "POST", "/api/ops/auth", { email: cfgEmail, password: "cfgPass123" });
      const noopSave = await req(cfgUser, "POST", "/api/ops/config", { action: "save_commission", commissionRate: 10 });
      eq("R9", "Custom role WITH config:configure → 200 (permission is the real gate)", noopSave.status, 200);

      // Demo admin (super_admin = all permissions) still allowed
      const adminSave = await req(ops, "POST", "/api/ops/config", { action: "save_commission", commissionRate: 10 });
      eq("R9", "Demo admin (super_admin) config write → 200 (compat preserved)", adminSave.status, 200);
    }

    // ═══════════ R10 (F-10) ═══════════
    section("R10 (F-10) — job-type category persists + validates");
    {
      const slug = `item8-jt-${TS}`;
      const created = await req(ops, "POST", "/api/ops/config", {
        action: "create_job_type",
        name: `Item8 Fixture ${TS}`,
        category: "AIRCON",
        slug,
        description: "item8 fixture",
        basePriceCents: 5000,
        unitLabel: "unit",
        pricingRules: { type: "flat" },
        requiredFields: [],
        addOns: [],
      });
      const jtId = dig(created.data, "jobType.id") ?? "";
      eq("R10", "create_job_type (valid category) → 200", created.status, 200);

      // Category edit persists (was silently dropped)
      const upd = await req(ops, "POST", "/api/ops/config", {
        action: "update_job_type",
        id: jtId,
        category: "CLEANING",
      });
      eq("R10", "update_job_type category → 200", upd.status, 200);
      const reloaded = await db.serviceJobType.findUnique({ where: { id: jtId } });
      eq("R10", "Category PERSISTED after save+reload (was silently reverted)", reloaded?.category, "CLEANING");

      // Custom categories rejected with a clear 400
      const badCategory = await req(ops, "POST", "/api/ops/config", {
        action: "update_job_type", id: jtId, category: "SOME_CUSTOM_CATEGORY",
      });
      eq("R10", "update_job_type custom category → 400 (was silent revert)", badCategory.status, 400);
      const badCreate = await req(ops, "POST", "/api/ops/config", {
        action: "create_job_type",
        name: `Bad Cat ${TS}`, category: "SOME_CUSTOM_CATEGORY", slug: `item8-bad-${TS}`,
        description: "x", basePriceCents: 5000, unitLabel: "unit",
        pricingRules: { type: "flat" }, requiredFields: [], addOns: [],
      });
      eq("R10", "create_job_type custom category → 400 (was a 500)", badCreate.status, 400);

      // Unknown id → 404 (not a silent no-op)
      const ghost = await req(ops, "POST", "/api/ops/config", {
        action: "update_job_type", id: "nonexistent-jt", category: "AIRCON",
      });
      eq("R10", "update_job_type unknown id → 404", ghost.status, 404);

      // Cleanup the fixture (delete guarded — it has no tasks/quotations)
      await req(ops, "POST", "/api/ops/config", { action: "delete_job_type", id: jtId });
    }

    // ═══════════ R11 (F-5) ═══════════
    section("R11 (F-5) — subscription pricing authority (HOME S$8 / CARE S$68)");
    {
      // ── (1)(2) Business prices + module is the single declaration ──
      eq("R11", "Module authority: HOME = 800 (S$8/mo)", getTierPriceCents("HOME"), 800);
      eq("R11", "Module authority: CARE = 6800 (S$68/mo)", getTierPriceCents("CARE"), 6800);
      eq("R11", "Single declaration object", SUBSCRIPTION_TIER_PRICES.HOME === 800 && SUBSCRIPTION_TIER_PRICES.CARE === 6800, true);

      // Display sites read the module — no active literals (source-level,
      // same L1 pattern the R6 prompt checks use for client components)
      const billingSectionSrc = fs.readFileSync("src/components/anna/billing-section.tsx", "utf8");
      check("R11", "Household billing-section: upgrade copy from the module (no $68 literal)",
        billingSectionSrc.includes('getTierPriceCents("CARE")') && !billingSectionSrc.includes("SGD $68/mo"));
      const overviewSrc = fs.readFileSync("src/components/ops/subscriptions/subscription-overview.tsx", "utf8");
      check("R11", "Ops overview: tier MRR lines from the module (no *800/*6800 literals)",
        overviewSrc.includes('getTierPriceCents("CARE")') && !overviewSrc.includes("* 6800") && !overviewSrc.includes("* 800"));
      const createDialogSrc = fs.readFileSync("src/components/ops/households/create-household-dialog.tsx", "utf8");
      check("R11", "Ops create-household dialog: tiers from the module (no $20 literal)",
        createDialogSrc.includes('getTierPriceCents("CARE")') && !createDialogSrc.includes("$20/mo"));
      const detailSheetSrc = fs.readFileSync("src/components/ops/subscriptions/subscription-detail-sheet.tsx", "utf8");
      check("R11", "Ops detail-sheet: upgrade/downgrade CTAs from the module",
        detailSheetSrc.includes('getTierPriceCents("CARE")') && !detailSheetSrc.includes("formatSgd(6800)"));

      // ── (3) No active code path uses CARE 2000 ──
      const opsHouseholdsSrc = fs.readFileSync("src/app/api/ops/households/route.ts", "utf8");
      check("R11", "Ops household creation (the 2000 outlier writer): module-driven, literal gone",
        opsHouseholdsSrc.includes('getTierPriceCents(') && !opsHouseholdsSrc.includes("? 800 : 2000"));
      // The whole subscription writer family stamps from the module
      const registerSrc = fs.readFileSync("src/app/api/household/register/route.ts", "utf8");
      const bridgeSrc = fs.readFileSync("src/app/api/auth/google-bridge/route.ts", "utf8");
      check("R11", "register + google-bridge stamp from the module",
        registerSrc.includes('getTierPriceCents("HOME")') && bridgeSrc.includes('getTierPriceCents("HOME")'));

      // ── (4)(9) Checkout resolves the tier Price ID and VALIDATES alignment ──
      const checkoutSrc = fs.readFileSync("src/app/api/billing/checkout/route.ts", "utf8");
      check("R11", "Checkout maps tier → Stripe Price ID (HOME/CARE env ids)",
        checkoutSrc.includes('tier === "HOME" ? getHomePriceId() : getCarePriceId()'));
      check("R11", "Checkout fail-closed alignment check present (STRIPE_PRICE_MISMATCH)",
        checkoutSrc.includes("isStripeTierPriceAligned") && checkoutSrc.includes("STRIPE_PRICE_MISMATCH"));
      eq("R11", "Alignment predicate: (6800, CARE) aligned", isStripeTierPriceAligned(6800, "CARE"), true);
      eq("R11", "Alignment predicate: (2000, CARE) MISALIGNED — wrong Stripe price is detected", isStripeTierPriceAligned(2000, "CARE"), false);
      eq("R11", "Alignment predicate: (800, CARE) MISALIGNED", isStripeTierPriceAligned(800, "CARE"), false);
      eq("R11", "Alignment predicate: (800, HOME) aligned", isStripeTierPriceAligned(800, "HOME"), true);
      eq("R11", "Alignment predicate: unreadable amount → NOT aligned (fail-closed)", isStripeTierPriceAligned(null, "CARE"), false);

      // ── (5) Displayed price and charge authority agree (webhook derivation) ──
      eq("R11", "Webhook derivation: aligned charge → recorded as-is", stripePriceCentsForTier(6800, "CARE"), 6800);
      eq("R11", "Webhook derivation: divergent charge → charge truth wins (row mirrors the real charge, never papered over)", stripePriceCentsForTier(2000, "CARE"), 2000);
      eq("R11", "Webhook derivation: amount unavailable → module fallback", stripePriceCentsForTier(null, "CARE"), 6800);
      const webhookSrc = fs.readFileSync("src/app/api/billing/webhook/route.ts", "utf8");
      check("R11", "Webhook derives priceCents via the shared helper (no 6800/800 literals)",
        webhookSrc.includes("stripePriceCentsForTier") && !webhookSrc.includes("? 6800 : 800"));

      // ── (6) Webhook preserves subscription identity (source-level: the
      // route is Stripe-signature-gated — untestable over HTTP without
      // provider credentials; the identity/idempotency structure is) ──
      check("R11", "Webhook identity: idempotent lookup by householdId+stripeSubscriptionId",
        webhookSrc.includes("stripeSubscriptionId,") && webhookSrc.includes("Already processed"));
      check("R11", "Webhook identity: updates locate the row by stripeSubscriptionId (never by tier/price)",
        webhookSrc.includes("where: { stripeSubscriptionId }") || webhookSrc.includes("where: { stripeSubscriptionId },"));

      // ── (7)(10) Route-level: writes stamp the module price; existing subs untouched ──
      // (a) ops-created CARE household — THE outlier fix (was 2000)
      const careEmail = `item8-care-hh-${TS}@anna.test`;
      const careCreate = await req(ops, "POST", "/api/ops/households", {
        name: `Item8 Care ${TS}`,
        ownerName: `Care Owner ${TS}`,
        ownerEmail: `item8-care-owner-${TS}@anna.test`,
        email: careEmail,
        password: "carePass123",
        address: "Item8 Street 1",
        tier: "CARE",
      });
      const careHhId = dig(careCreate.data, "household.id") ?? "";
      check("R11", "Ops-created CARE household → 200", careCreate.status === 200 && !!careHhId, `hh=${careHhId.slice(-6)}`);
      const careSub = await db.subscription.findFirst({ where: { householdId: careHhId } });
      eq("R11", "Ops-created CARE subscription stamps 6800 (WAS 2000 — the outlier)", careSub?.priceCents, 6800);
      eq("R11", "Ops-created CARE row is tier CARE", careSub?.tier, "CARE");

      // (b) ops-created HOME household stamps 800
      const homeEmail = `item8-f5-home-${TS}@anna.test`;
      const homeCreate = await req(ops, "POST", "/api/ops/households", {
        name: `Item8 F5 Home ${TS}`,
        ownerName: `Home Owner ${TS}`,
        ownerEmail: `item8-f5-owner-${TS}@anna.test`,
        email: homeEmail,
        password: "homePass123",
        address: "Item8 Street 2",
        tier: "HOME",
      });
      const homeHhId = dig(homeCreate.data, "household.id") ?? "";
      const homeSub = await db.subscription.findFirst({ where: { householdId: homeHhId } });
      eq("R11", "Ops-created HOME subscription stamps 800", homeSub?.priceCents, 800);

      // (c) ops tier-change upgrades the HOME row at the module price + honest copy
      const upgrade = await req(ops, "PATCH", `/api/ops/subscriptions/${homeSub?.id}`, { action: "upgrade_tier" });
      eq("R11", "upgrade_tier → 200", upgrade.status, 200);
      const upgraded = await db.subscription.findUnique({ where: { id: homeSub!.id } });
      eq("R11", "Upgraded row: CARE at 6800 (module price)", `${upgraded?.tier}/${upgraded?.priceCents}`, "CARE/6800");
      const upgradeNotif = await db.notification.findFirst({
        where: { householdId: homeHhId, title: "Subscription Upgraded" },
        orderBy: { createdAt: "desc" },
      });
      check("R11", "Upgrade notification copy states S$68/mo (module-driven)",
        !!upgradeNotif?.body && upgradeNotif.body.includes("SGD $68/mo"), `body=${upgradeNotif?.body?.slice(0, 60)}…`);

      // (d) existing (seeded) subscriptions are NOT repriced by any of this
      const seededAfter = await db.subscription.findMany({
        where: { id: { in: seededSubsBefore.map((s) => s.id) } },
        select: { id: true, priceCents: true },
      });
      const allSeededIntact = seededSubsBefore.every((before) =>
        seededAfter.find((after) => after.id === before.id)?.priceCents === before.priceCents);
      check("R11", "Seeded subscriptions keep their exact prices (no accidental repricing)",
        allSeededIntact && seededAfter.length === seededSubsBefore.length,
        `rows=${seededAfter.length}/${seededSubsBefore.length}`);

      // ── (8) Missing Stripe configuration fails safely (REAL route) ──
      const checkoutDisabled = await req(hh, "POST", "/api/billing/checkout", { tier: "CARE" });
      eq("R11", "Checkout with billing disabled (demo env) → 503 fail-safe", checkoutDisabled.status, 503);
      // Availability gate precedes body validation (fail-safe ordering):
      // an unknown tier ALSO short-circuits at the same 503 while billing
      // is disabled in this environment — the tier 400 is only reachable
      // when billing is enabled, verified by the route source above.
      const checkoutBadTier = await req(hh, "POST", "/api/billing/checkout", { tier: "ELITE" });
      eq("R11", "Checkout with unknown tier (billing disabled) → 503 (gate precedes validation)", checkoutBadTier.status, 503);

      // ── (10) Demo subscription flows keep working (ops surface) ──
      const subsList = await req(ops, "GET", "/api/ops/subscriptions");
      const summary = subsList.data?.summary;
      check("R11", "Ops subscriptions listing + summary intact",
        subsList.status === 200 && !!summary && summary.totalActive >= seededSubsBefore.length,
        `totalActive=${summary?.totalActive} totalMrr=${summary?.totalMrrCents}c`);
    }

    // ═══════════ R12 (P2-2) ═══════════
    section("R12 (P2-2) — quote explanations are server-quoted; no custom-amount decoy");
    {
      // ── Explain route: ungrounded narration is refused (REAL route branches,
      // deterministic — they resolve BEFORE the LLM seam) ──
      const noAuthority = await req(hh, "POST", "/api/quote/explain", {
        jobTypeName: "Gas Top-Up", category: "AIRCON", totalCents: 100, breakdown: [],
      });
      eq("R12", "Explain with client figures only (no quotationId/jobTypeId) → 400 NO_AUTHORITY", noAuthority.status, 400);
      eq("R12", "  …and the refusal names the authority rule", noAuthority.data?.code, "NO_AUTHORITY");

      const ghostService = await req(hh, "POST", "/api/quote/explain", {
        jobTypeId: "nonexistent-job-type", fieldValues: { unitCount: 1 },
      });
      eq("R12", "Explain with unknown jobTypeId → 404 (never narrates a made-up price)", ghostService.status, 404);

      // A real catalogue service with tampered client totals: the route
      // re-quotes server-side BEFORE the LLM — tampering cannot reach the
      // narration. (Provider disabled in this environment → the grounded
      // branch ends at the LLM seam with 500/503; the grounding itself is
      // proven by source + the branches above.)
      const explainSrc = fs.readFileSync("src/app/api/quote/explain/route.ts", "utf8");
      check("R12", "Explain route re-quotes via quoteJobType (client totals ignored)",
        explainSrc.includes("quoteJobType(") && !explainSrc.includes("totalCents: body.totalCents"));
      check("R12", "Invented 'standard market rates' fallback removed",
        !explainSrc.includes("standard market rates"));

      // ── Custom-amount decoy removed (client source checks) ──
      const quoteBuilderSrc = fs.readFileSync("src/components/anna/quote-builder.tsx", "utf8");
      check("R12", "QuoteBuilder: 'Enter custom amount' toggle GONE",
        !quoteBuilderSrc.includes("Enter custom amount") && !quoteBuilderSrc.includes("useCustomAmount"));
      const bookingFormSrc = fs.readFileSync("src/components/anna/booking-form.tsx", "utf8");
      check("R12", "BookingForm: Amount input locked while a catalogue job type is selected",
        bookingFormSrc.includes("disabled={!!selectedJobType}") && !bookingFormSrc.includes("Edit to override"));
      const taskCreatorSrc = fs.readFileSync("src/components/anna/task-creator.tsx", "utf8");
      check("R12", "TaskCreator: Amount input locked likewise; custom-request budget path kept",
        taskCreatorSrc.includes("disabled={!!selectedJobType}") && !taskCreatorSrc.includes("Edit to override"));
      check("R12", "QuoteBuilder sends jobTypeId for the grounded explain",
        quoteBuilderSrc.includes("jobTypeId: jobType.id"));
    }

    // ═══════════ R13 (P2-3) ═══════════
    section("R13 (P2-3) — Ops AI declares catalogue unavailability");
    {
      const opsAiSrc = fs.readFileSync("src/app/api/ops/ai/route.ts", "utf8");
      check("R13", "Ops AI prompt: NO-catalogue-tool boundary clause present",
        opsAiSrc.includes("You have NO service-catalogue or pricing lookup tool"));
      check("R13", "Ops AI prompt: directs to the Ops catalogue authority",
        opsAiSrc.includes("Ops → Job Types catalogue"));
      check("R13", "Ops AI prompt: transaction figures ≠ catalogue prices",
        opsAiSrc.includes("not catalogue prices"));
      // the tool surface itself still has no catalogue tool (Item 9 decision)
      const opsToolsSrc = fs.readFileSync("src/lib/ops-ai-tools.ts", "utf8");
      check("R13", "(scope guard) No catalogue tool was added — that stays an Item 9 decision",
        !opsToolsSrc.includes("ServiceJobType"));
    }

    // ═══════════ DEMO-COMPAT SPOT CHECKS ═══════════
    section("DEMO — environment intact after the fixes");
    {
      const vendorCount = await db.vendor.count();
      const hhCount = await db.household.count();
      const jtCount = await db.serviceJobType.count();
      const demoVendors = await db.vendor.count({ where: { email: { in: ["ops@sparkclean.sg", "hello@freshwash.sg", "bookings@coolair.sg"] } } });
      check("DEMO", "Seeded vendors/households/job-types present",
        vendorCount > 5 && hhCount > 5 && jtCount >= 30 && demoVendors === 3,
        `vendors=${vendorCount} households=${hhCount} jobTypes=${jtCount} demoVendors=${demoVendors}`);
      const gas = await db.serviceJobType.findUnique({ where: { slug: "aircon-gas-topup" } });
      eq("DEMO", "Gas top-up price restored to seed ($40)", gas?.basePriceCents, GAS_PRICE_ORIGINAL);
      const commissionRow = await db.platformConfig.findUnique({ where: { key: "commission_rate" } });
      eq("DEMO", "Commission rate restored to 10", commissionRow?.value, "10");
      // F-5/R11: seeded subscription rows untouched (the suite's created
      // households are additional rows; the DB file restore reverts them).
      const seededFinal = await db.subscription.findMany({
        where: { id: { in: seededSubsBefore.map((s) => s.id) } },
        select: { id: true, priceCents: true, tier: true, status: true },
      });
      const demoSubsIntact = seededSubsBefore.every((b) => {
        const row = seededFinal.find((f) => f.id === b.id);
        return row && row.priceCents === b.priceCents && row.tier === "HOME" && row.status === "ACTIVE";
      });
      check("DEMO", "Seeded demo subscriptions intact (HOME/800/A ACTIVE)",
        demoSubsIntact && seededFinal.length === seededSubsBefore.length,
        `rows=${seededFinal.length}`);
    }
  } finally {
    log("\n━━━ RESTORE ━━━");
    try {
      execSync(`cp ${backupFile} ${dbFile} && rm -f ${dbFile}-wal ${dbFile}-shm && rm -f ${backupFile}`);
      log("DB restored to pre-suite state (baseline preserved, WAL discarded).");
    } catch {
      log(`⚠️  RESTORE FAILED — manual restore needed: ${backupFile}`);
    }
  }

  const bySuite = new Map<string, { pass: number; fail: number }>();
  for (const r of records) {
    const cur = bySuite.get(r.suite) ?? { pass: 0, fail: 0 };
    if (r.pass) cur.pass++; else cur.fail++;
    bySuite.set(r.suite, cur);
  }
  log("\n━━━━━━━━━ SUMMARY ━━━━━━━━━");
  for (const [suite, counts] of bySuite) {
    log(`  ${suite.padEnd(52)} pass=${counts.pass}  fail=${counts.fail}`);
  }
  const totalPass = records.filter((r) => r.pass).length;
  const totalFail = records.filter((r) => !r.pass).length;
  log(`TOTAL: ${totalPass} passed, ${totalFail} failed`);

  const failed = records.filter((r) => !r.pass);
  const report = {
    suite: "item8-fixes",
    layer: "1 — deterministic (zero provider calls)",
    startedAt: new Date(TS).toISOString(),
    finishedAt: new Date().toISOString(),
    liveProviderCalls: 0,
    totals: { pass: totalPass, fail: totalFail },
    sections: Object.fromEntries([...bySuite]),
    failures: failed,
    checks: records,
  };
  await Bun.write(reportPath, JSON.stringify(report, null, 2));
  log(`report → ${reportPath}`);

  if (totalFail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("item8-fixes suite crashed:", e);
  process.exit(1);
});
