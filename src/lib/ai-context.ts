import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────
// AI Context Foundation (L4 · Phase 1 · Step 1.1)
//
//   Scoped data → deterministic context → AI
//   (NEVER: AI guesses what the data might be)
//
// Properties (all mandatory, all testable):
//   server-side   — built only from the DB inside route handlers / libs;
//                   nothing here ever trusts client-supplied identifiers.
//   deterministic — same DB state renders the same context string; no
//                   randomness, no locale drift, fixed field order.
//   scoped        — every query bakes in its scope filter structurally
//                   (householdId / vendorId), so cross-scope rows cannot
//                   enter the context regardless of who asks.
//   minimal       — only what the assistant narrates; no long-term
//                   memory, no embeddings, no RAG (all out of Phase-1
//                   scope by design).
//
// Scope kinds mirror the platform's three constituencies. Phase 1
// implements the household builder (Ask Anna — the surface where the
// narrative-misattribution defect was found). Vendor and ops builders
// land with their Phase-2+ surfaces, which already enforce their own
// sessions (vendor-guard / ops-auth).
// ─────────────────────────────────────────────────────────────

export type AiScope =
  | { kind: "household"; householdId: string }
  | { kind: "vendor"; vendorId: string }
  | { kind: "ops" };

export interface ContextSection {
  key: string;
  data: unknown;
}

export interface ScopedContext {
  scope: AiScope;
  generatedAt: string;
  sections: ContextSection[];
}

// ─────────────────────────────────────────────────────────────
// Deterministic formatting helpers (fixed output — no locale drift)
// ─────────────────────────────────────────────────────────────

function fmtSgd(cents: number): string {
  return `SGD $${(cents / 100).toFixed(2)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// ─────────────────────────────────────────────────────────────
// Household context (Ask Anna)
// ─────────────────────────────────────────────────────────────

/**
 * Build the deterministic, household-scoped context. Every query below
 * filters by householdId — B's rows structurally cannot appear in A's
 * context, so the LLM never receives data it could misattribute.
 */
export async function buildHouseholdContext(
  householdId: string
): Promise<ScopedContext> {
  const [household, subscription, tasks, escrowEntries, autonomy] = await Promise.all([
    db.household.findUnique({
      where: { id: householdId },
      select: { id: true, name: true },
    }),
    db.subscription.findFirst({
      where: { householdId },
      orderBy: { createdAt: "desc" },
      select: { tier: true, status: true },
    }),
    db.task.findMany({
      where: { householdId, cancelledAt: null },
      select: {
        id: true,
        jobNo: true,
        category: true,
        status: true,
        amountCents: true,
        scheduledStart: true,
        bookings: { select: { vendor: { select: { name: true } } }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.escrowLedger.findMany({
      where: { task: { householdId } },
      select: {
        id: true,
        state: true,
        amountCents: true,
        createdAt: true,
        task: { select: { jobNo: true, category: true } },
        booking: { select: { vendor: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.householdCategoryAutonomy.findMany({
      where: { householdId },
      select: { category: true, currentLevel: true, promotionPaused: true },
      orderBy: { category: "asc" },
    }),
  ]);

  const totalHeld = escrowEntries
    .filter((e) => e.state === "HELD")
    .reduce((s, e) => s + e.amountCents, 0);
  const totalReleased = escrowEntries
    .filter((e) => e.state === "RELEASED")
    .reduce((s, e) => s + e.amountCents, 0);

  const sections: ContextSection[] = [
    {
      key: "household_profile",
      data: household
        ? {
            name: household.name,
            subscriptionTier: subscription?.tier ?? null,
            subscriptionStatus: subscription?.status ?? null,
          }
        : null,
    },
    {
      key: "tasks",
      data: tasks.map((t) => ({
        jobNo: t.jobNo,
        taskId: t.id,
        category: t.category,
        status: t.status,
        amount: fmtSgd(t.amountCents),
        scheduledDate: t.scheduledStart ? fmtDate(new Date(t.scheduledStart)) : null,
        vendor: t.bookings[0]?.vendor?.name ?? null,
      })),
    },
    {
      key: "escrow",
      data: {
        totalHeld: fmtSgd(totalHeld),
        totalReleased: fmtSgd(totalReleased),
        entries: escrowEntries.slice(0, 5).map((e) => ({
          taskJobNo: e.task.jobNo, // every escrow fact is pinned to its owning task
          category: e.task.category,
          vendor: e.booking?.vendor?.name ?? null,
          amount: fmtSgd(e.amountCents),
          state: e.state,
          date: fmtDate(e.createdAt),
        })),
      },
    },
    {
      key: "autonomy",
      data: autonomy.map((a) => ({
        category: a.category,
        level: a.currentLevel,
        promotionPaused: a.promotionPaused,
      })),
    },
  ];

  return {
    scope: { kind: "household", householdId },
    generatedAt: new Date().toISOString(),
    sections,
  };
}

// ─────────────────────────────────────────────────────────────
// Prompt rendering
// ─────────────────────────────────────────────────────────────

/**
 * Render a scoped context into a deterministic text block for the system
 * prompt, including the grounding contract that closes the
 * narrative-misattribution defect: the model is told the listing is
 * complete and authoritative, that anything absent is not this
 * household's, and that it must never narrate one entity's facts under
 * another entity's identifier.
 */
export function renderContextForPrompt(ctx: ScopedContext): string {
  const scopeLabel =
    ctx.scope.kind === "household"
      ? `household ${JSON.stringify(ctx.scope.householdId)}`
      : ctx.scope.kind === "vendor"
        ? `vendor ${JSON.stringify(ctx.scope.vendorId)}`
        : "the ops console (cross-household visibility)";

  const blocks = ctx.sections.map((s) => {
    const json = JSON.stringify(s.data, null, 1);
    return `[${s.key}]\n${json}`;
  });

  return [
    "── AUTHORITATIVE SCOPED DATA (server-generated, deterministic) ──",
    `Scope: ${scopeLabel}`,
    `Generated at: ${ctx.generatedAt}`,
    "",
    "GROUNDING CONTRACT (non-negotiable):",
    "1. The data below is the COMPLETE, authoritative record for this scope. There is no other data.",
    "2. Any task, job number, vendor, or amount NOT listed below does NOT belong to this scope.",
    `3. If the user asks about an identifier that is absent below, say plainly that it is not one of ${ctx.scope.kind === "household" ? "their tasks" : "the records in scope"} — do NOT invent, guess, or substitute a similar record.`,
    "4. NEVER narrate one entity's facts under another entity's identifier. Every fact you state must come from the record that carries that identifier below.",
    "5. If asked something the data below cannot answer, say so plainly.",
    "",
    ...blocks,
    "── END SCOPED DATA ──",
  ].join("\n");
}
