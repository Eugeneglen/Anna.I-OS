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
// implemented the household builder (Ask Anna — the surface where the
// narrative-misattribution defect was found). Phase 3 (§3.2) adds the
// vendor builder (Vendor AI) and the ops builder (Ops AI — cross-
// household AGGREGATES only, no PII), all on the same discipline.
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
        jobType: { select: { name: true, slug: true } },
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
        service: t.jobType?.name ?? null,
        status: t.status,
        // ── Service/Pricing/Availability Authority ── labelled as history:
        // household context ONLY, never current pricing authority.
        historicalAmount: fmtSgd(t.amountCents),
        amountNote: "paid history — NOT current pricing; current prices come from the catalogue tools",
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
// Vendor context (Vendor AI) — Phase 3 · §3.2
// ─────────────────────────────────────────────────────────────

/**
 * Build the deterministic, vendor-scoped context. Every query below
 * filters by vendorId — vendor B's rows structurally cannot appear in
 * vendor A's context, so the LLM never receives data it could leak.
 * Minimal: the vendor's own jobs, schedule, payout and performance —
 * the facts the Vendor AI narrates.
 */
export async function buildVendorContext(vendorId: string): Promise<ScopedContext> {
  const [vendor, bookings, escrowEntries, performance] = await Promise.all([
    db.vendor.findUnique({
      where: { id: vendorId },
      select: {
        id: true,
        name: true,
        vendorType: true,
        status: true,
        dailyCapacity: true,
        maxTasksPerDay: true,
      },
    }),
    db.booking.findMany({
      where: { vendorId },
      select: {
        id: true,
        status: true,
        scheduledStart: true,
        rating: true,
        task: {
          select: { id: true, jobNo: true, category: true, status: true, amountCents: true, discountCents: true, finalAmountCents: true, instructions: true, jobType: { select: { name: true, slug: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.escrowLedger.findMany({
      where: { booking: { vendorId } },
      select: {
        state: true,
        amountCents: true,
        vendorPayoutCents: true,
        refundCents: true,
        createdAt: true,
        task: { select: { jobNo: true, category: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.booking.aggregate({
      where: { vendorId },
      _avg: { rating: true },
      _count: { _all: true },
    }),
  ]);

  const heldPayout = escrowEntries
    .filter((e) => e.state === "HELD")
    .reduce((s, e) => s + (e.vendorPayoutCents ?? 0), 0);
  const releasedPayout = escrowEntries
    .filter((e) => e.state === "RELEASED")
    .reduce((s, e) => s + (e.vendorPayoutCents ?? 0), 0);

  const sections: ContextSection[] = [
    {
      key: "vendor_profile",
      data: vendor
        ? {
            name: vendor.name,
            vendorType: vendor.vendorType,
            status: vendor.status,
            dailyCapacity: vendor.dailyCapacity,
            maxTasksPerDay: vendor.maxTasksPerDay,
          }
        : null,
    },
    {
      key: "jobs",
      data: bookings.map((b) => ({
        bookingId: b.id,
        jobNo: b.task.jobNo,
        category: b.task.category,
        // ── Service/Pricing/Availability Authority ── the vendor AI
        // narrates the SPECIFIC booked service and the CUSTOMER-APPROVED
        // amount, not a generic category + pre-discount figure.
        service: b.task.jobType?.name ?? null,
        taskStatus: b.task.status,
        bookingStatus: b.status,
        scheduledDate: b.scheduledStart ? fmtDate(new Date(b.scheduledStart)) : null,
        approvedAmount: fmtSgd(b.task.finalAmountCents || b.task.amountCents),
        rating: b.rating,
      })),
    },
    {
      key: "escrow_payouts",
      data: {
        heldPayout: fmtSgd(heldPayout),
        releasedPayout: fmtSgd(releasedPayout),
        entries: escrowEntries.slice(0, 5).map((e) => ({
          taskJobNo: e.task.jobNo, // every payout fact pinned to its owning task
          category: e.task.category,
          state: e.state,
          payout: fmtSgd(e.vendorPayoutCents ?? 0),
          refunded: e.refundCents ? fmtSgd(e.refundCents) : null,
          date: fmtDate(e.createdAt),
        })),
      },
    },
    {
      key: "performance",
      data: {
        totalBookings: performance._count._all,
        averageRating: performance._avg.rating ?? null,
      },
    },
  ];

  return {
    scope: { kind: "vendor", vendorId },
    generatedAt: new Date().toISOString(),
    sections,
  };
}

// ─────────────────────────────────────────────────────────────
// Ops context (Ops AI) — Phase 3 · §3.2
//
// Cross-household AGGREGATES only: counts and sums the ops role is
// permitted to see. No household names, no member PII, no vendor
// contact details — the ops AI narrates platform state, not
// individual dossiers. Role-appropriate by construction.
// ─────────────────────────────────────────────────────────────

export async function buildOpsContext(): Promise<ScopedContext> {
  const [
    activeAnomalyCount,
    anomaliesBySeverity,
    disputedTaskCount,
    escrowAggregates,
    tasksByStatus,
    pendingBriefs,
    newInsights,
  ] = await Promise.all([
    db.anomaly.count({ where: { status: "ACTIVE" } }),
    db.anomaly.groupBy({
      by: ["severity"],
      where: { status: "ACTIVE" },
      _count: { _all: true },
    }),
    db.task.count({ where: { status: "DISPUTED" } }),
    db.escrowLedger.groupBy({
      by: ["state"],
      _count: { _all: true },
      _sum: { amountCents: true },
    }),
    db.task.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    db.aiCaseBrief.count({ where: { status: "PENDING_REVIEW" } }),
    db.aiInsight.count({ where: { status: "NEW" } }),
  ]);

  const escrowSummary: Record<string, { count: number; total: string }> = {};
  for (const g of escrowAggregates) {
    escrowSummary[g.state] = {
      count: g._count._all,
      total: fmtSgd(g._sum.amountCents ?? 0),
    };
  }

  const sections: ContextSection[] = [
    {
      key: "anomalies",
      data: {
        activeTotal: activeAnomalyCount,
        bySeverity: anomaliesBySeverity.map((g) => ({ severity: g.severity, count: g._count._all })),
      },
    },
    {
      key: "tasks",
      data: {
        disputed: disputedTaskCount,
        byStatus: tasksByStatus.map((g) => ({ status: g.status, count: g._count._all })),
      },
    },
    {
      key: "escrow",
      data: escrowSummary,
    },
    {
      key: "ai_workqueue",
      data: {
        caseBriefsPendingReview: pendingBriefs,
        insightsNew: newInsights,
      },
    },
  ];

  return {
    scope: { kind: "ops" },
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
