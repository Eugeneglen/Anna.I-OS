import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AiBriefGeneration, AiBriefStatus, EscrowState, TaskStatus } from "@prisma/client";
import { buildDisputeCase, type DisputeCaseData } from "./case-builder";
import { computeEligibleActions, isActionEligible, type PolicyEvaluation } from "./policy";
import {
  callDisputeRecommendationLlm,
  manualReviewFallback,
  validateLlmRecommendation,
  DisputeLlmError,
  type CallLlmOptions,
} from "./llm";
import { logAiEvent, newAiChainId } from "@/lib/ai-audit";
import { executeEscrowAction, type EscrowActionInput } from "@/lib/escrow/execute-action";
import type { OpsSession } from "@/lib/ops-auth";

// ─────────────────────────────────────────────────────────────
// Phase 2 · Step 2.4 — DISPUTE CASE-BRIEF SERVICE
//
// Orchestrates the L4 workflow for qualifying disputes:
//
//   AI request → case generated → AI recommendation → human
//   decision → execution (ONE money path) → result
//
// All stages land in the EXISTING AuditLog via logAiEvent,
// correlated by the brief's aiChainId — one query reconstructs
// the full story (§7). Coverage (§8): every qualifying dispute
// produces a brief row, success or failure; nothing is hidden.
// ─────────────────────────────────────────────────────────────

const ENTITY_TYPE = "task";

/** Single-flight guard per task (dev server is one process). */
const inFlight = new Set<string>();
/** A GENERATING row younger than this is skipped by sweeps. */
const GENERATING_TTL_MS = 3 * 60 * 1000;
/** A FAILED row is retried by sweeps only after this cool-down. */
const RETRY_COOLDOWN_MS = 60 * 1000;
/** Max generation attempts before the row stays FAILED for humans. */
const MAX_ATTEMPTS = 5;

export interface GenerateBriefOptions {
  /** Who/what asked for generation (audit + stats). */
  trigger: "dispute_raised" | "sweep" | "manual";
  /**
   * Adversarial-test seam — passed through to the LLM engine ONLY by
   * routes that have already verified ai:configure + non-production.
   */
  simulate?: CallLlmOptions["simulate"];
  /** Force regeneration even when a GENERATED brief exists. */
  force?: boolean;
}

export interface GenerateBriefResult {
  status:
    | "generated"
    | "failed"
    | "skipped_in_flight"
    | "not_qualifying"
    | "exists"
    | "already_decided";
  briefId: string | null;
  fallback: boolean;
  error?: string;
}

/** Deterministic summary line — built from case facts, never from LLM text. */
function buildSummary(caseData: DisputeCaseData): string {
  const disputeReason =
    caseData.escrow.entries.find((e) => e.disputeReason)?.disputeReason ?? "no reason recorded";
  const cash = caseData.escrow.totals.orderTotalCashCents;
  return (
    `Dispute on ${caseData.task.category.toLowerCase()} task ${caseData.jobNo ?? caseData.taskId.slice(-8)} ` +
    `(${caseData.householdName}, SGD $${(cash / 100).toFixed(2)} held): ${disputeReason}`
  );
}

async function logStage(
  stage: "ai_request" | "ai_recommendation" | "human_decision" | "execution" | "result",
  chainId: string,
  action: string,
  scope: { householdId?: string; vendorId?: string; entityType?: string; entityId?: string; surface?: string },
  detail: Record<string, unknown>,
  actor?: { userId?: string; userName?: string }
): Promise<void> {
  try {
    await logAiEvent({
      stage,
      chainId,
      action,
      actor: actor?.userId ? { userId: actor.userId, userName: actor.userName } : undefined,
      scope: { ...scope, surface: scope.surface ?? "dispute-brief" },
      detail,
    });
  } catch (e) {
    // Audit failures are fail-loud in logAiEvent by design, but a broken
    // audit write must never block the governance record's other stages.
    console.error("[brief-service] audit stage write failed:", e);
  }
}

/**
 * Ensure a dispute case brief exists (and is fresh) for a task, generating
 * the AI recommendation through the deterministic pipeline:
 *   scoped case → code-first policy → LLM → strict validation → brief.
 */
export async function ensureDisputeCaseBrief(
  taskId: string,
  options: GenerateBriefOptions
): Promise<GenerateBriefResult> {
  // 1. Deterministic case — also the qualifying gate.
  const caseData = await buildDisputeCase(taskId);
  if (!caseData) {
    // Not (or no longer) qualifying: expire any pending briefs.
    await expirePendingBriefsForTask(taskId, "Task is no longer a qualifying dispute");
    return { status: "not_qualifying", briefId: null, fallback: false };
  }

  // 2. Existing brief handling (dedup / retry / supersede).
  const existing = await db.aiCaseBrief.findFirst({
    where: { caseType: "DISPUTE", entityType: ENTITY_TYPE, entityId: taskId },
    orderBy: { createdAt: "desc" },
  });

  if (existing && !options.force) {
    // A DECIDED brief (APPROVED/REJECTED) is a decision record — the sweep
    // and auto-triggers must never regenerate over it. Only an explicit
    // manual force (ai:prepare) may create a newer brief, and even then
    // the decided record is preserved (not superseded).
    if (
      existing.status === AiBriefStatus.APPROVED ||
      existing.status === AiBriefStatus.REJECTED
    ) {
      return { status: "already_decided", briefId: existing.id, fallback: false };
    }
    if (
      existing.status === AiBriefStatus.PENDING_REVIEW &&
      existing.generationStatus === AiBriefGeneration.GENERATING &&
      Date.now() - existing.updatedAt.getTime() < GENERATING_TTL_MS
    ) {
      return { status: "skipped_in_flight", briefId: existing.id, fallback: false };
    }
    if (
      existing.status === AiBriefStatus.PENDING_REVIEW &&
      existing.generationStatus === AiBriefGeneration.GENERATED
    ) {
      // Fresh enough? If escrow/task moved after generation → supersede.
      const movedAt = await latestEntityTouch(taskId);
      if (movedAt <= existing.updatedAt.getTime()) {
        return { status: "exists", briefId: existing.id, fallback: false };
      }
    }
    if (
      existing.status === AiBriefStatus.PENDING_REVIEW &&
      (existing.generationStatus === AiBriefGeneration.FAILED ||
        existing.generationStatus === AiBriefGeneration.QUEUED) &&
      existing.generationAttempts >= MAX_ATTEMPTS
    ) {
      return {
        status: "failed",
        briefId: existing.id,
        fallback: true,
        error: existing.generationError ?? "max attempts reached",
      };
    }
  }

  if (inFlight.has(taskId) && !(options.force && options.trigger === "manual")) {
    // In-flight sweep/auto generation — skip to avoid stampede. An explicit
    // MANUAL force regeneration bypasses the guard: the caller (ai:prepare,
    // coordinator+) deliberately wants a fresh brief NOW, and the supersede
    // logic keeps exactly one active row.
    return { status: "skipped_in_flight", briefId: existing?.id ?? null, fallback: false };
  }
  inFlight.add(taskId);
  try {
    return await generateBrief(caseData, options, existing);
  } finally {
    inFlight.delete(taskId);
  }
}

/** Latest known state-change touch on the task's escrow entries or task row —
 *  used to detect stale briefs. EscrowLedger has no updatedAt, so the state
 *  timestamps (disputed/refunded/released/resolved) are the signals. */
async function latestEntityTouch(taskId: string): Promise<number> {
  const entries = await db.escrowLedger.findMany({
    where: { taskId },
    select: {
      createdAt: true, heldAt: true, releasedAt: true, disputedAt: true,
      refundedAt: true, disputeResolvedAt: true,
    },
  });
  const task = await db.task.findUnique({ where: { id: taskId }, select: { updatedAt: true } });
  let max = task?.updatedAt.getTime() ?? 0;
  for (const e of entries) {
    max = Math.max(
      max,
      e.createdAt.getTime(),
      e.heldAt?.getTime() ?? 0,
      e.releasedAt?.getTime() ?? 0,
      e.disputedAt?.getTime() ?? 0,
      e.refundedAt?.getTime() ?? 0,
      e.disputeResolvedAt?.getTime() ?? 0
    );
  }
  return max;
}

/**
 * SQLite lock-resilient write: brief generation is BACKGROUND work — a
 * transient P1008 (socket timeout under write contention) is retried with
 * backoff instead of failing the whole generation. Never used for money
 * paths (those keep their strict existing semantics).
 */
async function resilientWrite<T>(op: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      const code = (err as { code?: string })?.code;
      if (code === "P1008" || code === "P2024") {
        await new Promise((r) => setTimeout(r, 600 * attempt));
        continue;
      }
      throw err;
    }
  }
  console.error(`[brief-service] ${label} failed after retries:`, lastErr);
  throw lastErr;
}

async function generateBrief(
  caseData: NonNullable<Awaited<ReturnType<typeof buildDisputeCase>>>,
  options: GenerateBriefOptions,
  previous: { id: string; generationAttempts: number; status: AiBriefStatus } | null
): Promise<GenerateBriefResult> {
  // Supersede the previous brief ONLY when it was still pending — a
  // decided (APPROVED/REJECTED) brief is a decision record and stays
  // intact; the new row simply becomes the active one.
  if (previous && previous.status === AiBriefStatus.PENDING_REVIEW) {
    await db.aiCaseBrief.update({
      where: { id: previous.id },
      data: { status: AiBriefStatus.SUPERSEDED },
    }).catch(() => {});
  }

  // 3. Policy — BEFORE any LLM call (code-first eligibility, §2).
  const policy = computeEligibleActions(caseData);

  const chainId = newAiChainId();
  const summary = buildSummary(caseData);

  // Create the row first — coverage tracking means the row EXISTS even
  // if generation subsequently fails (§8: failures are never hidden).
  const brief = await resilientWrite(() => db.aiCaseBrief.create({
    data: {
      caseType: "DISPUTE",
      entityType: ENTITY_TYPE,
      entityId: caseData.taskId,
      householdId: caseData.householdId,
      escrowId: caseData.primaryEscrowId,
      vendorId: caseData.vendorId,
      aiChainId: chainId,
      status: AiBriefStatus.PENDING_REVIEW,
      generationStatus: AiBriefGeneration.GENERATING,
      generationAttempts: (previous?.generationAttempts ?? 0) + 1,
      summary,
      recommendation: "manual_review", // safe placeholder until generation completes
      rationale: "Generation in progress…",
      contextSnapshot: { case: caseData, policy } as any,
      eligibleActions: policy as any,
      financialImpact: policy.financialImpact as any,
    },
  }), "brief row create");

  // 4. Audit: AI request (scope + trigger + the deterministic envelope).
  await logStage("ai_request", chainId, "AI_CASE_REQUEST", {
    householdId: caseData.householdId,
    vendorId: caseData.vendorId ?? undefined,
    entityType: ENTITY_TYPE,
    entityId: caseData.taskId,
  }, {
    trigger: options.trigger,
    taskId: caseData.taskId,
    primaryEscrowId: caseData.primaryEscrowId,
    eligibleActions: policy.allowedChoices,
    caseFactsOnly: true,
    llmFinancialAuthority: false,
  });

  // 5. LLM call + strict validation.
  let recommendation;
  let fallback = false;
  let generationStatus: AiBriefGeneration = AiBriefGeneration.GENERATED;
  let generationError: string | null = null;
  let llmLatencyMs: number | null = null;
  let attempts = 1;

  try {
    const result = await callDisputeRecommendationLlm(caseData, policy, {
      simulate: options.simulate,
    });
    llmLatencyMs = result.latencyMs;
    attempts = result.attempts;
    const validation = validateLlmRecommendation(result.raw, policy);
    if (validation.ok) {
      recommendation = validation.recommendation;
    } else {
      recommendation = manualReviewFallback(validation.error);
      fallback = true;
      generationError = `invalid LLM output rejected: ${validation.error}`;
    }
  } catch (err) {
    // Provider failure (timeout/unavailable after retry) — keep the row,
    // mark FAILED, fall back to manual review with the error visible.
    const message =
      err instanceof DisputeLlmError ? err.message : (err as Error)?.message ?? String(err);
    if (err instanceof DisputeLlmError && err.attempts) {
      attempts = err.attempts; // retry tracking (§8) even on failure
    }
    recommendation = manualReviewFallback(`generation failed: ${message}`);
    generationStatus = AiBriefGeneration.FAILED;
    generationError = message.slice(0, 500);
  }

  // 6. Persist the recommendation (display amount recorded but never
  // authoritative — §3).
  await resilientWrite(() => db.aiCaseBrief.update({
    where: { id: brief.id },
    data: {
      summary,
      recommendation: recommendation.action,
      recommendedAmountCents: recommendation.recommendedAmountCents,
      fallbackFromInvalid: fallback,
      rationale: recommendation.reasoning,
      confidence: recommendation.confidence,
      generationStatus,
      generationError,
      generationAttempts: attempts,
      contextSnapshot: {
        case: caseData,
        policy,
        alternativesConsidered: recommendation.alternativesConsidered,
      } as any,
    },
  }), "brief recommendation persist");

  // 7. Audit: AI recommendation.
  await logStage("ai_recommendation", chainId, "AI_CASE_RECOMMENDATION", {
    householdId: caseData.householdId,
    vendorId: caseData.vendorId ?? undefined,
    entityType: ENTITY_TYPE,
    entityId: caseData.taskId,
  }, {
    briefId: brief.id,
    action: recommendation.action,
    recommendedAmountCents: recommendation.recommendedAmountCents,
    confidence: recommendation.confidence,
    fallbackFromInvalid: fallback,
    generationStatus,
    generationError,
    llmLatencyMs,
    attempts,
    eligibleActions: policy.allowedChoices,
    amountAuthority: "server-recomputed-at-execution",
  });

  return {
    status: generationStatus === AiBriefGeneration.FAILED ? "failed" : "generated",
    briefId: brief.id,
    fallback,
    error: generationError ?? undefined,
  };
}

/**
 * Expire still-pending briefs for a task — called from the ONE money path
 * after any successful escrow action, and from the household self-resolve
 * route. The brief being decided is updated BEFORE execution, so it is
 * never caught here.
 */
export async function expirePendingBriefsForTask(taskId: string, reason: string): Promise<void> {
  try {
    const pending = await db.aiCaseBrief.findMany({
      where: {
        caseType: "DISPUTE",
        entityType: ENTITY_TYPE,
        entityId: taskId,
        status: AiBriefStatus.PENDING_REVIEW,
      },
      select: { id: true, aiChainId: true },
    });
    for (const b of pending) {
      await db.aiCaseBrief.update({
        where: { id: b.id },
        data: {
          status: AiBriefStatus.EXPIRED,
          executionResult: {
            kind: "expired",
            reason: reason.slice(0, 300),
            at: new Date().toISOString(),
          } as any,
        },
      });
      if (b.aiChainId) {
        await logStage("result", b.aiChainId, "AI_CASE_EXPIRED", {
          entityType: ENTITY_TYPE,
          entityId: taskId,
        }, { reason: reason.slice(0, 300) });
      }
    }
  } catch (e) {
    console.error("[brief-service] expirePendingBriefsForTask failed:", e);
  }
}

// ─────────────────────────────────────────────────────────────
// Coverage sweep (§8): every qualifying dispute gets a brief.
// ─────────────────────────────────────────────────────────────

export interface SweepResult {
  qualifyingDisputes: number;
  ensured: number;
  expired: number;
  skipped: number;
  details: { taskId: string; status: string }[];
}

export async function sweepBriefs(): Promise<SweepResult> {
  // Currently-qualifying disputes.
  const disputedTasks = await db.task.findMany({
    where: { status: TaskStatus.DISPUTED },
    select: { id: true },
    take: 50,
  });

  const qualifying: string[] = [];
  for (const t of disputedTasks) {
    const hasDisputedEscrow = await db.escrowLedger.findFirst({
      where: { taskId: t.id, state: EscrowState.DISPUTED },
      select: { id: true },
    });
    if (hasDisputedEscrow) qualifying.push(t.id);
  }

  // Expire pending briefs on tasks that left the qualifying state.
  const pendingBriefs = await db.aiCaseBrief.findMany({
    where: { caseType: "DISPUTE", status: AiBriefStatus.PENDING_REVIEW },
    select: { entityId: true },
  });
  let expired = 0;
  for (const b of pendingBriefs) {
    if (!qualifying.includes(b.entityId)) {
      await expirePendingBriefsForTask(b.entityId, "Task left the qualifying dispute state (sweep)");
      expired++;
    }
  }

  // Ensure briefs for all qualifying disputes (retry failures past the
  // cool-down; skip fresh/in-flight).
  const details: { taskId: string; status: string }[] = [];
  let ensured = 0;
  let skipped = 0;
  for (const taskId of qualifying) {
    const latest = await db.aiCaseBrief.findFirst({
      where: { caseType: "DISPUTE", entityType: ENTITY_TYPE, entityId: taskId },
      orderBy: { createdAt: "desc" },
    });
    if (
      latest &&
      (latest.status === AiBriefStatus.APPROVED || latest.status === AiBriefStatus.REJECTED)
    ) {
      // Decided (APPROVED/REJECTED) — a decision record; the sweep never
      // regenerates over the human's decision.
      skipped++;
      continue;
    }
    if (
      latest &&
      latest.status === AiBriefStatus.PENDING_REVIEW &&
      (latest.generationStatus === AiBriefGeneration.GENERATED ||
        (latest.generationStatus === AiBriefGeneration.GENERATING &&
          Date.now() - latest.updatedAt.getTime() < GENERATING_TTL_MS) ||
        ((latest.generationStatus === AiBriefGeneration.FAILED ||
          latest.generationStatus === AiBriefGeneration.QUEUED) &&
          Date.now() - latest.updatedAt.getTime() < RETRY_COOLDOWN_MS))
    ) {
      skipped++;
      continue;
    }
    const res = await ensureDisputeCaseBrief(taskId, { trigger: "sweep" });
    details.push({ taskId, status: res.status });
    if (res.status === "generated" || res.status === "failed") ensured++;
    else skipped++;
  }

  return { qualifyingDisputes: qualifying.length, ensured, expired, skipped, details };
}

// ─────────────────────────────────────────────────────────────
// Coverage stats (§8) — nothing hidden.
// ─────────────────────────────────────────────────────────────

export interface CoverageStats {
  currentlyQualifyingDisputes: number;
  disputesWithActiveBrief: number;
  coveragePercent: number;
  totalQualifyingDisputesHistorical: number;
  briefsGenerated: number;
  generationFailures: number;
  generationFailuresActive: number;
  retries: number;
  expiredBriefs: number;
  supersededBriefs: number;
  manualReviewFallbacks: number;
  decided: { accepted: number; rejected: number; overridden: number };
  notes: string[];
}

export async function getCoverageStats(): Promise<CoverageStats> {
  const [disputedTasks, briefs, fallbackRows, decidedAccept, decidedReject, decidedOverride] =
    await Promise.all([
      db.task.findMany({
        where: { status: TaskStatus.DISPUTED },
        select: { id: true },
      }),
      db.aiCaseBrief.findMany({ where: { caseType: "DISPUTE" } }),
      db.aiCaseBrief.count({ where: { caseType: "DISPUTE", fallbackFromInvalid: true } }),
      db.aiCaseBrief.count({
        where: { caseType: "DISPUTE", decisionKind: "ACCEPT", status: AiBriefStatus.APPROVED },
      }),
      db.aiCaseBrief.count({
        where: { caseType: "DISPUTE", decisionKind: "REJECT", status: AiBriefStatus.REJECTED },
      }),
      db.aiCaseBrief.count({
        where: { caseType: "DISPUTE", decisionKind: "OVERRIDE", status: AiBriefStatus.APPROVED },
      }),
    ]);

  const qualifying: string[] = [];
  for (const t of disputedTasks) {
    const hasDisputedEscrow = await db.escrowLedger.findFirst({
      where: { taskId: t.id, state: EscrowState.DISPUTED },
      select: { id: true },
    });
    if (hasDisputedEscrow) qualifying.push(t.id);
  }

  const withActiveBrief = qualifying.filter((taskId) => {
    // Active brief awaiting review…
    if (
      briefs.some(
        (b) =>
          b.entityId === taskId &&
          b.status === AiBriefStatus.PENDING_REVIEW &&
          (b.generationStatus === AiBriefGeneration.GENERATED ||
            b.generationStatus === AiBriefGeneration.FAILED)
      )
    ) {
      return true;
    }
    // …or the latest brief for the task was DECIDED — the human already
    // handled this dispute episode; it is covered by definition.
    const latest = briefs
      .filter((b) => b.entityId === taskId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return latest?.status === AiBriefStatus.APPROVED || latest?.status === AiBriefStatus.REJECTED;
  });

  const uniqueDisputes = new Set(briefs.map((b) => b.entityId)).size;
  const generated = briefs.filter((b) => b.generationStatus === AiBriefGeneration.GENERATED).length;
  const failedActive = briefs.filter(
    (b) =>
      b.generationStatus === AiBriefGeneration.FAILED &&
      b.status === AiBriefStatus.PENDING_REVIEW
  ).length;
  const retries = briefs.reduce((s, b) => s + Math.max(0, b.generationAttempts - 1), 0);
  const expired = briefs.filter((b) => b.status === AiBriefStatus.EXPIRED).length;
  const superseded = briefs.filter((b) => b.status === AiBriefStatus.SUPERSEDED).length;
  const failedEver = briefs.filter((b) => b.generationAttempts > 1 || b.generationError).length;

  return {
    currentlyQualifyingDisputes: qualifying.length,
    disputesWithActiveBrief: withActiveBrief.length,
    coveragePercent:
      qualifying.length === 0
        ? 100
        : Math.round((withActiveBrief.length / qualifying.length) * 1000) / 10,
    totalQualifyingDisputesHistorical: uniqueDisputes,
    briefsGenerated: generated,
    generationFailures: failedEver,
    generationFailuresActive: failedActive,
    retries,
    expiredBriefs: expired,
    supersededBriefs: superseded,
    manualReviewFallbacks: fallbackRows + failedActive,
    decided: { accepted: decidedAccept, rejected: decidedReject, overridden: decidedOverride },
    notes: [
      "Coverage = currently-qualifying disputes holding an active (GENERATED or FAILED) brief.",
      "FAILED rows remain in the queue as manual-review cases with the error visible — never hidden.",
      "fallbackFromInvalid rows = LLM outputs rejected by policy validation → safe MANUAL_REVIEW.",
    ],
  };
}

// ─────────────────────────────────────────────────────────────
// HUMAN DECISION (§5) — Accept / Reject / Override.
//
//   • decision + reason recorded (audit human_decision stage)
//   • accept/override hand control to the ONE money path
//     (executeEscrowAction) with refundConfirmed maker-checker
//   • the maker-checker 409 gate stays fully intact — this
//     service cannot and does not bypass it
// ─────────────────────────────────────────────────────────────

export interface DecideBriefInput {
  decision: "accept" | "reject" | "override";
  reason: string;
  /** Explicit maker-checker confirmation (required for refund-class execution). */
  refundConfirmed?: boolean;
  /** For override: the chosen action. */
  overrideAction?: string;
  /** For override partial_refund. */
  refundAmountCents?: number;
  /** For override resolve_voucher. */
  voucherAmountCents?: number;
  voucherRefundAmountCents?: number;
}

export async function decideBrief(
  briefId: string,
  session: OpsSession,
  input: DecideBriefInput
): Promise<NextResponse> {
  const brief = await db.aiCaseBrief.findUnique({ where: { id: briefId } });
  if (!brief) {
    return NextResponse.json({ error: "AI case brief not found" }, { status: 404 });
  }
  if (brief.caseType !== "DISPUTE") {
    return NextResponse.json({ error: "Not a dispute case brief" }, { status: 400 });
  }
  if (brief.status !== AiBriefStatus.PENDING_REVIEW) {
    return NextResponse.json(
      {
        error: `This brief is already ${brief.status} — only PENDING_REVIEW briefs can be decided.`,
        code: "BRIEF_NOT_PENDING",
      },
      { status: 409 }
    );
  }

  const taskId = brief.entityId;

  // ── Re-verify the live case at decision time (§1/§10) ──
  const caseData = await buildDisputeCase(taskId);
  if (!caseData) {
    await expirePendingBriefsForTask(taskId, "Dispute resolved before the human decision landed");
    return NextResponse.json(
      { error: "The dispute is no longer active (already resolved) — brief expired.", code: "DISPUTE_RESOLVED" },
      { status: 409 }
    );
  }

  // The brief's identity scope MUST match the live case (defence in depth
  // against any identity drift — §10).
  if (
    caseData.householdId !== brief.householdId ||
    caseData.primaryEscrowId !== brief.escrowId
  ) {
    return NextResponse.json(
      { error: "Brief/case identity mismatch — refusing to execute.", code: "CASE_IDENTITY_MISMATCH" },
      { status: 409 }
    );
  }

  // ── Fresh policy at decision time (§2: eligibility is code, not LLM) ──
  const policy = computeEligibleActions(caseData);

  // Resolve the target action.
  let targetAction: string;
  if (input.decision === "reject") {
    targetAction = "reject";
  } else if (input.decision === "accept") {
    targetAction = brief.recommendation;
  } else {
    if (!input.overrideAction) {
      return NextResponse.json(
        { error: "override requires overrideAction from the eligible set" },
        { status: 400 }
      );
    }
    targetAction = input.overrideAction;
  }

  // Validate the target against the CURRENT eligible set.
  let chosen: string | null = null;
  if (targetAction !== "reject" && targetAction !== "manual_review") {
    const eligible = isActionEligible(policy, targetAction);
    if (!eligible) {
      return NextResponse.json(
        {
          error: `Action '${targetAction}' is not currently eligible. Policy may have changed since the brief was generated — review the updated case.`,
          code: "ACTION_NOT_ELIGIBLE",
          eligibleActions: policy.allowedChoices,
        },
        { status: 422 }
      );
    }
    chosen = targetAction;
  }

  // ── Maker-checker gate (§6) — BEFORE the decision is recorded, so an
  // unconfirmed refund-class call leaves the brief completely untouched
  // (same semantics as the manual escrow route's 409 gate). The AI route
  // is not a backdoor around the refundConfirmed protection. ──
  const REFUND_ACTIONS = ["resolve_refund", "partial_refund", "resolve_voucher"];
  if (input.decision !== "reject" && chosen && REFUND_ACTIONS.includes(chosen)) {
    if (!input.refundConfirmed) {
      return NextResponse.json(
        {
          error:
            "Refund actions require explicit confirmation — re-submit with refundConfirmed: true after reviewing the amount and reason.",
          action: chosen,
          requiresConfirmation: true,
        },
        { status: 409 }
      );
    }
  }

  // ── Amount validation (§3) — BEFORE the decision is recorded, so a 422
  // (out-of-bounds / non-integer amount) leaves the brief completely
  // untouched, exactly like the eligibility 422 and the maker-checker 409.
  // Out-of-bounds amounts are REJECTED, never clamped. ──
  let validatedRefundAmountCents: number | undefined;
  let validatedVoucherAmountCents: number | undefined;
  if (chosen === "partial_refund") {
    const bounds = isActionEligible(policy, "partial_refund")?.bounds;
    if (!bounds) {
      return NextResponse.json({ error: "partial_refund no longer eligible" }, { status: 422 });
    }
    const requested =
      input.refundAmountCents !== undefined
        ? input.refundAmountCents
        : input.decision === "accept"
          ? brief.recommendedAmountCents ?? undefined
          : undefined;
    if (
      typeof requested !== "number" ||
      !Number.isInteger(requested) ||
      requested < bounds.minAmountCents ||
      requested > bounds.maxAmountCents
    ) {
      return NextResponse.json(
        {
          error: `refundAmountCents must be an integer within [${bounds.minAmountCents}, ${bounds.maxAmountCents}] — got ${String(requested)}`,
          code: "AMOUNT_OUT_OF_BOUNDS",
        },
        { status: 422 }
      );
    }
    validatedRefundAmountCents = requested;
  } else if (chosen === "resolve_voucher") {
    const bounds = isActionEligible(policy, "resolve_voucher")?.bounds;
    if (!bounds) {
      return NextResponse.json({ error: "resolve_voucher no longer eligible" }, { status: 422 });
    }
    const requested =
      input.voucherAmountCents !== undefined
        ? input.voucherAmountCents
        : input.decision === "accept"
          ? brief.recommendedAmountCents ?? undefined
          : undefined;
    if (
      typeof requested !== "number" ||
      !Number.isInteger(requested) ||
      requested < bounds.minAmountCents ||
      requested > bounds.maxAmountCents
    ) {
      return NextResponse.json(
        {
          error: `voucherAmountCents must be an integer within [${bounds.minAmountCents}, ${bounds.maxAmountCents}] — got ${String(requested)}`,
          code: "AMOUNT_OUT_OF_BOUNDS",
        },
        { status: 422 }
      );
    }
    validatedVoucherAmountCents = requested;
  }

  // ── Record the human decision BEFORE any execution (§5/§7) ──
  const decisionLatencyMs = Date.now() - brief.updatedAt.getTime();
  const decisionAction = input.decision === "reject" ? null : chosen ?? "manual_review";
  const decisionKind = input.decision === "accept" ? "ACCEPT" : input.decision === "reject" ? "REJECT" : "OVERRIDE";

  const chainId = brief.aiChainId ?? newAiChainId();
  await logStage("human_decision", chainId, "AI_CASE_DECISION", {
    householdId: brief.householdId,
    vendorId: brief.vendorId ?? undefined,
    entityType: ENTITY_TYPE,
    entityId: taskId,
  }, {
    briefId: brief.id,
    decisionKind,
    aiRecommended: brief.recommendation,
    aiRecommendedAmountCents: brief.recommendedAmountCents,
    aiConfidence: brief.confidence,
    humanSelected: decisionAction ?? "reject",
    reason: input.reason.slice(0, 500),
    decisionLatencyMs,
    policySnapshot: {
      eligibleActions: policy.eligibleActions,
      allowedChoices: policy.allowedChoices,
      computedAt: policy.computedAt,
    },
  }, { userId: session.userId, userName: session.name });

  // Update the brief to its decided state (executions below can no longer
  // expire it — it is not PENDING_REVIEW anymore).
  await db.aiCaseBrief.update({
    where: { id: brief.id },
    data: {
      status: input.decision === "reject" ? AiBriefStatus.REJECTED : AiBriefStatus.APPROVED,
      reviewedById: session.userId,
      reviewedAt: new Date(),
      decisionNote: input.reason.slice(0, 500),
      decisionKind,
      decisionAction,
      decisionLatencyMs,
      aiChainId: chainId,
    },
  });

  // ── Pure decision endpoints: reject / accept-manual-review ──
  if (input.decision === "reject" || decisionAction === "manual_review" || decisionAction === null) {
    return NextResponse.json({
      briefId: brief.id,
      decision: decisionKind,
      executed: false,
      note:
        input.decision === "reject"
          ? "Recommendation rejected. Resolve through the standard escrow controls."
          : "Accepted a manual-review recommendation. Resolve through the standard escrow controls.",
    });
  }

  // ── Execution: prepare the payload, hand control to the ONE money path ──
  const actionInput: EscrowActionInput = {
    action: decisionAction as EscrowActionInput["action"],
    resolution: `${input.reason.slice(0, 400)} [AI-assisted: brief ${brief.id.slice(-8)} recommended ${brief.recommendation}]`,
  };

  // The maker-checker 409 gate has already fired (above, before the decision
  // was recorded); executeEscrowAction re-enforces it as the final authority.

  // Server-computed amounts (§3): the executable amount comes from the
  // live escrow/policy figures — never from the LLM's suggested number.
  const escrowId = brief.escrowId as string;
  const escrowRow = await db.escrowLedger.findUnique({ where: { id: escrowId } });
  if (!escrowRow) {
    return NextResponse.json({ error: "Escrow entry not found" }, { status: 404 });
  }

  if (decisionAction === "partial_refund") {
    // Amount was validated BEFORE the decision was recorded — the
    // executable figure comes from the live code-computed bounds.
    actionInput.refundAmountCents = validatedRefundAmountCents;
    actionInput.idempotencyKey = `ai-decision-${brief.id}`;
  } else if (decisionAction === "resolve_refund") {
    // Full refund: the amount is computed BY THE SERVER inside the money
    // path (amountCents − refundCents). The LLM's suggested amount is
    // display-only and is deliberately NOT forwarded.
    actionInput.refundConfirmed = true;
  } else if (decisionAction === "resolve_voucher") {
    // Amount validated BEFORE the decision was recorded.
    actionInput.voucherAmountCents = validatedVoucherAmountCents;
    actionInput.voucherRefundAmountCents = Math.max(0, input.voucherRefundAmountCents ?? 0);
    actionInput.voucherExpiryDays = 90;
    actionInput.idempotencyKey = `ai-decision-${brief.id}`;
    actionInput.refundConfirmed = true;
  }
  if (decisionAction === "partial_refund") {
    actionInput.refundConfirmed = true;
  }

  // Audit: execution stage — the exact payload handed to the money path.
  await logStage("execution", chainId, "AI_CASE_EXECUTION", {
    householdId: brief.householdId,
    vendorId: brief.vendorId ?? undefined,
    entityType: ENTITY_TYPE,
    entityId: taskId,
  }, {
    briefId: brief.id,
    escrowId,
    action: decisionAction,
    payload: {
      action: actionInput.action,
      resolution: actionInput.resolution,
      refundAmountCents: actionInput.refundAmountCents ?? null,
      voucherAmountCents: actionInput.voucherAmountCents ?? null,
      idempotencyKey: actionInput.idempotencyKey ?? null,
      refundConfirmed: actionInput.refundConfirmed ?? false,
    },
    amountSource: "server-computed",
    executesThrough: "src/lib/escrow/execute-action.ts (the existing money path)",
  }, { userId: session.userId, userName: session.name });

  // ── THE money path (same function the manual PATCH route calls) ──
  const execResponse = await executeEscrowAction(session, escrowId, actionInput);
  const execStatus = execResponse.status;
  let execBody: Record<string, unknown> | null = null;
  try {
    execBody = await execResponse.json();
  } catch {
    execBody = null;
  }
  const succeeded = execStatus >= 200 && execStatus < 300;

  // Audit: result stage + persisted on the brief (§7).
  const resultSummary = {
    kind: "execution",
    httpStatus: execStatus,
    ok: succeeded,
    action: decisionAction,
    refund: (execBody?.refund as Record<string, unknown>) ?? null,
    creditCode: execBody?.creditCode ?? null,
    code: execBody?.code ?? null,
    escrowState: (execBody?.escrow as Record<string, unknown> | undefined)?.state ?? null,
    error: succeeded ? null : (execBody?.error as string) ?? `HTTP ${execStatus}`,
    at: new Date().toISOString(),
  };
  await db.aiCaseBrief.update({
    where: { id: brief.id },
    data: { executionResult: resultSummary as any },
  });
  await logStage("result", chainId, succeeded ? "AI_CASE_RESULT_OK" : "AI_CASE_RESULT_FAILED", {
    householdId: brief.householdId,
    vendorId: brief.vendorId ?? undefined,
    entityType: ENTITY_TYPE,
    entityId: taskId,
  }, {
    briefId: brief.id,
    ...resultSummary,
    refundId: (execBody?.refund as Record<string, unknown> | undefined)?.refundId ?? null,
    cumulativeRefundCents:
      (execBody?.refund as Record<string, unknown> | undefined)?.cumulativeRefundCents ?? null,
  }, { userId: session.userId, userName: session.name });

  // Surface the execution outcome verbatim (same body shape the manual
  // PATCH route returns) plus the decision record.
  return NextResponse.json(
    {
      briefId: brief.id,
      decision: decisionKind,
      aiRecommended: brief.recommendation,
      humanSelected: decisionAction,
      executed: true,
      execution: execBody ?? { error: `HTTP ${execStatus}` },
      decisionRecord: {
        decidedBy: session.name,
        decidedById: session.userId,
        reason: input.reason.slice(0, 500),
        decisionLatencyMs,
        aiConfidence: brief.confidence,
        policySnapshotAtDecision: policy.eligibleActions,
      },
    },
    { status: succeeded ? 200 : execStatus }
  );
}
