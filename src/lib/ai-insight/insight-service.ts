import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AiBriefGeneration, AiInsightStatus, AnomalySeverity, AnomalyStatus, Prisma } from "@prisma/client";
import { buildAnomalyInsightCase, type AnomalyInsightCase } from "./case-builder";
import {
  computeInsightPolicy,
  INSIGHT_ACTION_CATALOGUE,
  prepareTargetFor,
  type InsightAction,
} from "./catalogue";
import {
  callInsightLlm,
  validateInsightRecommendation,
  monitorOnlyFallback,
  InsightLlmError,
  type CallInsightLlmOptions,
} from "./llm";
import {
  checkNarrationConsistency,
  contradictionFallback,
  type NarrationContradiction,
} from "./narration-consistency";
import { logAiEvent, newAiChainId } from "@/lib/ai-audit";
import { ensureDisputeCaseBrief } from "@/lib/ai-dispute/brief-service";
import type { OpsSession } from "@/lib/ops-auth";

// ─────────────────────────────────────────────────────────────
// Phase 3 · §3.1 — EVENT-DRIVEN AI INSIGHT SERVICE
//
//   existing anomaly detection → deterministic case →
//   code-first catalogue policy → LLM (advisory) → strict
//   validation → persisted AiInsight → ops feed →
//   human review / human Prepare
//
// Discipline (mirrors Phase 2):
//   • dedup — one insight per anomaly (dedupKey unique); repeated
//     anomaly sweeps can never create uncontrolled duplicates;
//   • decided insights (ACKNOWLEDGED/DISMISSED) are review
//     records — never regenerated over;
//   • FAILED rows stay visible with generationError;
//   • the LLM NEVER executes — even "prepare_case_brief" only
//     stages a Phase-2 brief for a HUMAN decision (maker-checker).
// ─────────────────────────────────────────────────────────────

const ENTITY_TYPE = "anomaly";

/** Single-flight guard per anomaly (dev server is one process). */
const inFlight = new Set<string>();
/** A GENERATING row younger than this is skipped by sweeps. */
const GENERATING_TTL_MS = 3 * 60 * 1000;
/** A FAILED row is retried by sweeps only after this cool-down. */
const RETRY_COOLDOWN_MS = 60 * 1000;
/** Max generation attempts before the row stays FAILED for humans. */
const MAX_ATTEMPTS = 5;

export interface GenerateInsightOptions {
  trigger: "anomaly_created" | "sweep" | "manual" | "insight_prepare";
  /** Adversarial-test seam — routes verify ai:configure + non-production. */
  simulate?: CallInsightLlmOptions["simulate"];
  /** Force regeneration even when a GENERATED insight exists. */
  force?: boolean;
}

export interface GenerateInsightResult {
  status:
    | "generated"
    | "failed"
    | "skipped_in_flight"
    | "not_qualifying"
    | "exists"
    | "already_reviewed";
  insightId: string | null;
  fallback: boolean;
  error?: string;
}

/** SQLite lock-resilient write — background work only, never money paths. */
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
  console.error(`[insight-service] ${label} failed after retries:`, lastErr);
  throw lastErr;
}

async function logStage(
  stage: "ai_request" | "ai_recommendation" | "human_decision" | "result",
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
      scope: { ...scope, surface: scope.surface ?? "ai-insight" },
      detail,
    });
  } catch (e) {
    // A broken audit write must never block the governance record's stages.
    console.error("[insight-service] audit stage write failed:", e);
  }
}

function dedupKeyFor(anomalyId: string): string {
  return `anomaly:${anomalyId}`;
}

// ── P11-F3: vendor-name universe for the narration/evidence consistency
// check, fetched once per sweep window (60s cache — mirrors the
// getCommissionRate config-cache pattern; vendor tables are small at demo
// scale, and the pure checker stays I/O-free for adversarial tests). ──
let vendorUniverseCache: { names: string[]; at: number } | null = null;
const VENDOR_UNIVERSE_TTL_MS = 60_000;
async function getVendorNameUniverse(): Promise<string[]> {
  if (vendorUniverseCache && Date.now() - vendorUniverseCache.at < VENDOR_UNIVERSE_TTL_MS) {
    return vendorUniverseCache.names;
  }
  try {
    const rows = await db.vendor.findMany({ select: { name: true } });
    const names = rows.map((r) => r.name);
    vendorUniverseCache = { names, at: Date.now() };
    return names;
  } catch {
    // Universe fetch failed → the pure checker still falls back to the
    // anomaly-message-derived universe (the observed defect class).
    return [];
  }
}

/**
 * Ensure an AI insight exists for one anomaly, generating through the
 * deterministic pipeline:
 *   scoped case → code-first catalogue policy → LLM → validation → insight.
 */
export async function ensureAnomalyInsight(
  anomalyId: string,
  options: GenerateInsightOptions
): Promise<GenerateInsightResult> {
  // 1. Deterministic case — also the qualifying gate (ACTIVE anomalies only).
  const caseData = await buildAnomalyInsightCase(anomalyId);
  if (!caseData) {
    return { status: "not_qualifying", insightId: null, fallback: false };
  }

  // 2. Existing insight handling — dedup / review-record / retry.
  const existing = await db.aiInsight.findUnique({
    where: { dedupKey: dedupKeyFor(anomalyId) },
  });

  // A REVIEWED insight is a review record — never regenerated, even with
  // manual force (mirrors the Phase-2 decided-brief discipline).
  if (
    existing &&
    (existing.status === AiInsightStatus.ACKNOWLEDGED || existing.status === AiInsightStatus.DISMISSED)
  ) {
    return { status: "already_reviewed", insightId: existing.id, fallback: false };
  }

  if (existing && !options.force) {
    if (
      existing.generationStatus === AiBriefGeneration.GENERATING &&
      Date.now() - existing.updatedAt.getTime() < GENERATING_TTL_MS
    ) {
      return { status: "skipped_in_flight", insightId: existing.id, fallback: false };
    }
    if (existing.generationStatus === AiBriefGeneration.GENERATED) {
      return { status: "exists", insightId: existing.id, fallback: false };
    }
    if (
      (existing.generationStatus === AiBriefGeneration.FAILED ||
        existing.generationStatus === AiBriefGeneration.QUEUED) &&
      existing.generationAttempts >= MAX_ATTEMPTS
    ) {
      return {
        status: "failed",
        insightId: existing.id,
        fallback: true,
        error: existing.generationError ?? "max attempts reached",
      };
    }
    if (
      existing.generationStatus === AiBriefGeneration.FAILED &&
      Date.now() - existing.updatedAt.getTime() < RETRY_COOLDOWN_MS
    ) {
      return { status: "skipped_in_flight", insightId: existing.id, fallback: false };
    }
  }

  if (inFlight.has(anomalyId) && !(options.force && options.trigger === "manual")) {
    return { status: "skipped_in_flight", insightId: existing?.id ?? null, fallback: false };
  }
  inFlight.add(anomalyId);
  try {
    return await generateInsight(caseData, options, existing);
  } finally {
    inFlight.delete(anomalyId);
  }
}

async function generateInsight(
  caseData: AnomalyInsightCase,
  options: GenerateInsightOptions,
  previous: { id: string; generationAttempts: number } | null
): Promise<GenerateInsightResult> {
  // 3. Code-first catalogue policy — BEFORE any LLM call.
  const policy = computeInsightPolicy({
    anomalyType: caseData.anomaly.type,
    hasTaskId: !!caseData.task,
    hasVendorId: !!caseData.vendor,
    qualifiesForCaseBrief: caseData.qualifiesForCaseBrief,
  });

  const chainId = previous
    ? // Reuse the row's chain on retries so the chain stays one story.
      await db.aiInsight
        .findUnique({ where: { id: previous.id }, select: { aiChainId: true } })
        .then((r) => r?.aiChainId ?? newAiChainId())
    : newAiChainId();

  // Create/update the row FIRST with GENERATING state — coverage means the
  // row exists even if generation subsequently fails (failures visible).
  const baseData = {
    insightType: "ANOMALY" as const,
    severity: caseData.anomaly.severity as AnomalySeverity, // code-authoritative triage scale
    entityType: ENTITY_TYPE,
    entityId: caseData.anomaly.id,
    householdId: caseData.household.id,
    vendorId: caseData.vendor?.id ?? null,
    status: AiInsightStatus.NEW,
    title: "Insight generation in progress…",
    body: "The AI insight for this anomaly is being generated. This placeholder is replaced on completion; a failure here is never hidden.",
    evidence: {
      case: caseData,
      policy,
    } as unknown as Prisma.InputJsonValue,
    dedupKey: dedupKeyFor(caseData.anomaly.id),
    aiChainId: chainId,
    generationStatus: AiBriefGeneration.GENERATING,
    generationAttempts: (previous?.generationAttempts ?? 0) + 1,
    generationError: null,
  };

  const insight = previous
    ? await resilientWrite(
        () => db.aiInsight.update({ where: { id: previous.id }, data: baseData }),
        "insight row update"
      )
    : await resilientWrite(
        () => db.aiInsight.create({ data: baseData }),
        "insight row create"
      );

  // 4. Audit: AI request.
  await logStage("ai_request", chainId, "AI_INSIGHT_REQUEST", {
    householdId: caseData.household.id,
    vendorId: caseData.vendor?.id,
    entityType: ENTITY_TYPE,
    entityId: caseData.anomaly.id,
  }, {
    trigger: options.trigger,
    anomalyType: caseData.anomaly.type,
    allowedActions: policy.allowedChoices,
  });

  // 5. LLM (advisory) → 6. strict validation → 6b. P11-F3 narration/
  // evidence consistency (a policy-valid response whose FACTS contradict
  // the authoritative evidence snapshot is replaced with the safe
  // contradiction fallback — never persisted as fact).
  let recommendation;
  let fallback = false;
  let modelVersion: string | null = null;
  let narrationContradictions: NarrationContradiction[] = [];

  try {
    const call = await callInsightLlm(caseData, policy, { simulate: options.simulate });
    modelVersion = call.modelVersion;
    const validation = validateInsightRecommendation(call.raw, policy);
    if (validation.ok) {
      narrationContradictions = checkNarrationConsistency(
        caseData,
        validation.recommendation.title,
        validation.recommendation.body,
        { vendorNameUniverse: await getVendorNameUniverse() }
      );
      if (narrationContradictions.length > 0) {
        recommendation = contradictionFallback(narrationContradictions, caseData);
        fallback = true;
      } else {
        recommendation = validation.recommendation;
      }
    } else {
      recommendation = monitorOnlyFallback(validation.error);
      fallback = true;
    }
  } catch (err) {
    if (err instanceof InsightLlmError && err.kind === "unavailable") {
      // Provider not configured: FAILED row kept visible.
      await resilientWrite(
        () =>
          db.aiInsight.update({
            where: { id: insight.id },
            data: {
              generationStatus: AiBriefGeneration.FAILED,
              generationError: err.message.slice(0, 500),
            },
          }),
        "insight failure update"
      );
      return {
        status: "failed",
        insightId: insight.id,
        fallback: false,
        error: err.message,
      };
    }
    // Timeout/provider after retries → FAILED row with visible error.
    const message = err instanceof Error ? err.message : "unknown provider error";
    await resilientWrite(
      () =>
        db.aiInsight.update({
          where: { id: insight.id },
          data: {
            generationStatus: AiBriefGeneration.FAILED,
            generationError: message.slice(0, 500),
          },
        }),
      "insight failure update"
    );
    return { status: "failed", insightId: insight.id, fallback: false, error: message };
  }

  // 7. Persist the validated recommendation (or the safe fallback).
  await resilientWrite(
    () =>
      db.aiInsight.update({
        where: { id: insight.id },
        data: {
          generationStatus: AiBriefGeneration.GENERATED,
          generationError: null,
          title: recommendation.title,
          body: recommendation.body,
          recommendedAction: recommendation.recommendedAction,
          fallbackFromInvalid: fallback,
          confidence: recommendation.confidence,
          modelVersion,
        },
      }),
    "insight persist"
  );

  // 8. Audit: AI recommendation.
  await logStage("ai_recommendation", chainId, "AI_INSIGHT_RECOMMENDATION", {
    householdId: caseData.household.id,
    vendorId: caseData.vendor?.id,
    entityType: ENTITY_TYPE,
    entityId: caseData.anomaly.id,
  }, {
    recommendedAction: recommendation.recommendedAction,
    fallbackFromInvalid: fallback,
    title: recommendation.title,
    confidence: recommendation.confidence,
    modelVersion,
    narrationContradictions: narrationContradictions.length
      ? narrationContradictions.map((c) => ({ check: c.check, narration: c.narration, evidence: c.evidence }))
      : undefined,
  });

  return {
    status: "generated",
    insightId: insight.id,
    fallback,
  };
}

// ─────────────────────────────────────────────────────────────
// Sweep — the event-driven backstop. Scans ACTIVE anomalies and
// ensures an insight for each (dedup makes this idempotent).
// ─────────────────────────────────────────────────────────────

export interface InsightSweepResult {
  scanned: number;
  ensured: number;
  skipped: number;
}

export async function sweepInsights(): Promise<InsightSweepResult> {
  const anomalies = await db.anomaly.findMany({
    where: { status: AnomalyStatus.ACTIVE },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  let ensured = 0;
  let skipped = 0;
  for (const a of anomalies) {
    const result = await ensureAnomalyInsight(a.id, { trigger: "sweep" });
    if (result.status === "generated" || result.status === "failed") ensured++;
    else skipped++;
  }
  return { scanned: anomalies.length, ensured, skipped };
}

// ─────────────────────────────────────────────────────────────
// Human review — ACKNOWLEDGE / DISMISS (ai:approve at the route).
// All validation BEFORE any state change is recorded.
// ─────────────────────────────────────────────────────────────

export async function reviewInsight(
  insightId: string,
  session: OpsSession,
  input: { status: "ACKNOWLEDGED" | "DISMISSED"; note?: string }
): Promise<NextResponse> {
  const insight = await db.aiInsight.findUnique({ where: { id: insightId } });
  if (!insight) {
    return NextResponse.json({ error: "Insight not found" }, { status: 404 });
  }
  if (insight.status !== AiInsightStatus.NEW) {
    return NextResponse.json(
      { error: `Insight already reviewed (${insight.status}) — review records are never overwritten` },
      { status: 409 }
    );
  }
  if (insight.generationStatus !== AiBriefGeneration.GENERATED) {
    return NextResponse.json(
      { error: "Insight has not finished generating — review after generation completes" },
      { status: 409 }
    );
  }

  await logStage(
    "human_decision",
    insight.aiChainId ?? newAiChainId(),
    "AI_INSIGHT_REVIEWED",
    {
      householdId: insight.householdId ?? undefined,
      vendorId: insight.vendorId ?? undefined,
      entityType: insight.entityType,
      entityId: insight.entityId,
    },
    {
      reviewStatus: input.status,
      note: input.note?.slice(0, 500) ?? null,
      recommendedAction: insight.recommendedAction,
    },
    { userId: session.userId, userName: session.name }
  );

  await db.aiInsight.update({
    where: { id: insight.id },
    data: {
      status: input.status as AiInsightStatus,
      reviewedById: session.userId,
      reviewedAt: new Date(),
    },
  });

  return NextResponse.json({
    ok: true,
    insightId: insight.id,
    status: input.status,
  });
}

// ─────────────────────────────────────────────────────────────
// Prepare — the human-initiated follow-up for a recommended
// action. Navigation targets come from the catalogue + evidence
// (NEVER the LLM). "prepare_case_brief" stages a Phase-2 brief
// for HUMAN decision — it does not decide, and it never touches
// money.
// ─────────────────────────────────────────────────────────────

export interface PrepareInsightResult {
  action: InsightAction;
  kind: "navigate" | "prepare" | "none";
  label: string;
  redirect: string | null;
  briefId?: string;
  taskId?: string;
  briefStatus?: string;
}

export async function prepareInsight(
  insightId: string,
  session: OpsSession
): Promise<NextResponse> {
  const insight = await db.aiInsight.findUnique({ where: { id: insightId } });
  if (!insight) {
    return NextResponse.json({ error: "Insight not found" }, { status: 404 });
  }
  if (insight.generationStatus !== AiBriefGeneration.GENERATED) {
    return NextResponse.json(
      { error: "Insight has not finished generating" },
      { status: 409 }
    );
  }

  const action = insight.recommendedAction as InsightAction | null;
  if (!action || !(action in INSIGHT_ACTION_CATALOGUE)) {
    return NextResponse.json(
      { error: "Insight carries no valid catalogue action" },
      { status: 422 }
    );
  }
  const def = INSIGHT_ACTION_CATALOGUE[action];

  // Evidence ids are SERVER-persisted (from the anomaly row) — never re-taken
  // from the client.
  const evidence = (insight.evidence as { case?: AnomalyInsightCase } | null)?.case;
  const evidenceIds = {
    anomalyId: insight.entityId,
    taskId: evidence?.task?.id ?? undefined,
    vendorId: insight.vendorId ?? evidence?.vendor?.id ?? undefined,
    householdId: insight.householdId ?? undefined,
  };

  await logStage(
    "human_decision",
    insight.aiChainId ?? newAiChainId(),
    "AI_INSIGHT_PREPARE",
    {
      householdId: insight.householdId ?? undefined,
      vendorId: insight.vendorId ?? undefined,
      entityType: insight.entityType,
      entityId: insight.entityId,
    },
    { action, kind: def.kind },
    { userId: session.userId, userName: session.name }
  );

  // ── The one preparation act: stage a Phase-2 case brief for a human ──
  if (def.kind === "prepare" && action === "prepare_case_brief") {
    const taskId = evidenceIds.taskId;
    if (!taskId) {
      return NextResponse.json(
        { error: "Insight carries no task to prepare a case brief for" },
        { status: 422 }
      );
    }
    // Re-verify qualifying at prepare time (fresh server state).
    const briefResult = await ensureDisputeCaseBrief(taskId, {
      trigger: "insight_prepare",
    });
    const redirect = prepareTargetFor("prepare_case_brief", evidenceIds);

    await logStage(
      "result",
      insight.aiChainId ?? newAiChainId(),
      "AI_INSIGHT_PREPARE_RESULT",
      {
        householdId: insight.householdId ?? undefined,
        vendorId: insight.vendorId ?? undefined,
        entityType: insight.entityType,
        entityId: insight.entityId,
      },
      { action, briefStatus: briefResult.status, briefId: briefResult.briefId, taskId },
      { userId: session.userId, userName: session.name }
    );

    const result: PrepareInsightResult = {
      action,
      kind: "prepare",
      label: def.label,
      redirect,
      briefId: briefResult.briefId ?? undefined,
      taskId,
      briefStatus: briefResult.status,
    };
    return NextResponse.json(result);
  }

  // ── Navigation acts: server-computed target from the catalogue ──
  if (def.kind === "none") {
    return NextResponse.json(
      { error: "This insight is monitor-only — there is nothing to prepare" },
      { status: 400 }
    );
  }

  const redirect = prepareTargetFor(action, evidenceIds);
  if (!redirect) {
    return NextResponse.json(
      { error: `Action '${action}' has no prepare target for this insight's evidence` },
      { status: 422 }
    );
  }

  await logStage(
    "result",
    insight.aiChainId ?? newAiChainId(),
    "AI_INSIGHT_PREPARE_RESULT",
    {
      householdId: insight.householdId ?? undefined,
      vendorId: insight.vendorId ?? undefined,
      entityType: insight.entityType,
      entityId: insight.entityId,
    },
    { action, redirect },
    { userId: session.userId, userName: session.name }
  );

  const result: PrepareInsightResult = {
    action,
    kind: "navigate",
    label: def.label,
    redirect,
  };
  return NextResponse.json(result);
}

// ─────────────────────────────────────────────────────────────
// Coverage stats (ops feed strip)
// ─────────────────────────────────────────────────────────────

export interface InsightStats {
  total: number;
  newCount: number;
  acknowledgedCount: number;
  dismissedCount: number;
  generationFailed: number;
  fallbacks: number;
  dedupProtected: number;
}

export async function getInsightStats(): Promise<InsightStats> {
  const [total, newCount, acknowledgedCount, dismissedCount, generationFailed, fallbacks] =
    await Promise.all([
      db.aiInsight.count(),
      db.aiInsight.count({ where: { status: AiInsightStatus.NEW } }),
      db.aiInsight.count({ where: { status: AiInsightStatus.ACKNOWLEDGED } }),
      db.aiInsight.count({ where: { status: AiInsightStatus.DISMISSED } }),
      db.aiInsight.count({ where: { generationStatus: AiBriefGeneration.FAILED } }),
      db.aiInsight.count({ where: { fallbackFromInvalid: true } }),
    ]);
  // Every ACTIVE anomaly has at most one insight by dedupKey — the
  // dedup-protected count is insights that exist (detector + unique key
  // hold the line; stats surface the current stable population).
  const activeAnomalies = await db.anomaly.count({ where: { status: AnomalyStatus.ACTIVE } });
  return {
    total,
    newCount,
    acknowledgedCount,
    dismissedCount,
    generationFailed,
    fallbacks,
    dedupProtected: Math.max(0, total - activeAnomalies), // reviewed/retained rows
  };
}
