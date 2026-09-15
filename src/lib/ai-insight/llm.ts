import { getZAI } from "@/lib/zai";
import type { AnomalyInsightCase } from "./case-builder";
import type { InsightPolicy, InsightAction } from "./catalogue";

// ─────────────────────────────────────────────────────────────
// Phase 3 · §3.1 — INSIGHT LLM ENGINE + STRICT OUTPUT VALIDATOR
//
// The LLM's ONLY job: narrate the deterministic case as an ops
// insight (title/body) and pick ONE action from the code-computed
// eligible set. It has NO authority to invent actions, attach
// amounts, or execute anything (§3.1: "The LLM is advisory").
//
// validateInsightRecommendation() is PURE — the single gate every
// insight LLM response passes through, imported by the live server
// path AND the adversarial test suite. ANY invalid output → the
// monitor_only fallback. No fallback ever selects an operational
// action.
// ─────────────────────────────────────────────────────────────

export interface ValidInsightRecommendation {
  recommendedAction: InsightAction;
  title: string;
  body: string;
  confidence: number | null;
  reasoning: string;
}

export type InsightLlmValidationResult =
  | { ok: true; recommendation: ValidInsightRecommendation }
  | { ok: false; error: string };

const MAX_TITLE_CHARS = 120;
const MIN_TITLE_CHARS = 8;
const MAX_BODY_CHARS = 2000;
const MIN_BODY_CHARS = 40;
const MAX_REASONING_CHARS = 1200;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

function sanitizeText(v: unknown, maxChars: number): string | null {
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return cleaned.slice(0, maxChars);
}

/**
 * Validate a raw insight-LLM response against the code-first policy.
 * PURE — no I/O, deterministic, exported for adversarial tests.
 *
 * Rejections include: unparseable JSON, unknown/ineligible action
 * (ANY execution-shaped invention falls here), missing/oversized
 * title or body, contradictory amount fields, malformed fields.
 */
export function validateInsightRecommendation(
  raw: string,
  policy: InsightPolicy
): InsightLlmValidationResult {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, error: "empty or non-string LLM response" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return { ok: false, error: "response is not valid JSON" };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: "response is not a JSON object" };
  }

  // ── recommendedAction: REQUIRED, must be in the code-eligible set ──
  const action = parsed.recommendedAction ?? parsed.action;
  if (typeof action !== "string" || action.length === 0) {
    return { ok: false, error: "missing or non-string 'recommendedAction' field" };
  }
  if (!policy.allowedChoices.includes(action as InsightAction)) {
    return {
      ok: false,
      error: `action '${action.slice(0, 80)}' is not in the code-eligible set [${policy.allowedChoices.join(", ")}]`,
    };
  }
  const chosen = action as InsightAction;

  // Insights carry NO amount parameters. Any amount field is a
  // contradiction (a manipulated or confused response).
  for (const field of ["amountCents", "refundAmountCents", "voucherAmountCents", "amount"]) {
    if (parsed[field] !== undefined && parsed[field] !== null) {
      return {
        ok: false,
        error: `recommendation carries '${field}' — insights never carry amounts (contradiction)`,
      };
    }
  }

  // ── title: required, bounded ──
  const title = sanitizeText(parsed.title, MAX_TITLE_CHARS);
  if (!title || title.trim().length < MIN_TITLE_CHARS) {
    return {
      ok: false,
      error: `missing or too-short 'title' (min ${MIN_TITLE_CHARS} chars)`,
    };
  }

  // ── body: required, bounded ──
  const body = sanitizeText(parsed.body, MAX_BODY_CHARS);
  if (!body || body.trim().length < MIN_BODY_CHARS) {
    return {
      ok: false,
      error: `missing or too-short 'body' (min ${MIN_BODY_CHARS} chars)`,
    };
  }

  // ── confidence: informational; invalid → null (not fatal) ──
  let confidence: number | null = null;
  const rawConfidence = parsed.confidence;
  if (typeof rawConfidence === "number" && Number.isFinite(rawConfidence)) {
    if (rawConfidence >= 0 && rawConfidence <= 1) confidence = rawConfidence;
  }

  // ── reasoning: optional string, sanitized ──
  const reasoning =
    sanitizeText(parsed.reasoning ?? parsed.rationale, MAX_REASONING_CHARS) ??
    "No reasoning provided by the model.";

  return {
    ok: true,
    recommendation: {
      recommendedAction: chosen,
      title: title.trim(),
      body: body.trim(),
      confidence,
      reasoning,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// The MONITOR_ONLY fallback — the ONLY result an invalid insight
// LLM output can produce. Nothing here ever selects an
// operational action.
// ─────────────────────────────────────────────────────────────

export function monitorOnlyFallback(error: string): ValidInsightRecommendation {
  return {
    recommendedAction: "monitor_only",
    title: "Insight requires manual review",
    body:
      `The AI-generated insight failed policy validation (${error.slice(0, 300)}). ` +
      "Falling back to MONITOR ONLY: a human operator should review this anomaly directly in the anomalies console. " +
      "No automated action was taken.",
    confidence: null,
    reasoning: "Safe fallback applied after strict validation rejected the model output.",
  };
}

// ─────────────────────────────────────────────────────────────
// LLM invocation (mirrors the Phase-2 engine: timeout race,
// one transient retry, simulate seam for adversarial tests)
// ─────────────────────────────────────────────────────────────

export class InsightLlmError extends Error {
  constructor(
    message: string,
    public kind: "timeout" | "provider" | "unavailable",
    public attempts: number = 1
  ) {
    super(message);
    this.name = "InsightLlmError";
  }
}

const LLM_TIMEOUT_MS = 20_000;
const TRANSIENT_RETRY_DELAY_MS = 1_500;

const SYSTEM_PROMPT = `You are Anna.I's ops insight writer. You receive a deterministic, server-generated snapshot of ONE detected platform anomaly and write an operations insight for a human operator.

ABSOLUTE CONSTRAINTS — violations make your output invalid and it will be discarded:
1. You may ONLY choose a recommendedAction from the "allowedActions" list provided. Never invent, rename, or guess actions.
2. Insights NEVER carry amounts, refunds, or execution parameters. Do not attach any amount field.
3. Everything you state must come from the case facts provided. Never invent metrics, names, or histories.
4. You are ADVISING. A human operator decides. Never state that you executed or will execute anything.
5. P11-F3: where the anomaly MESSAGE text and the structured vendor/task fields disagree, the STRUCTURED fields (vendor.name, task.category, task.status, amounts) are authoritative. Narrate from the structured fields and, when relevant, state the discrepancy explicitly ("the anomaly message names X, but the linked vendor is Y") — never assert the message's version as fact.

Respond with ONE JSON object and NOTHING else (no prose, no markdown, no extra fields):
{
  "recommendedAction": "<one action from allowedActions>",
  "title": "<factual headline, 8-120 chars, no quotes inside>",
  "body": "<what the operator needs to know, grounded in the facts, 40-2000 chars, no quotes inside>",
  "confidence": <number 0..1>,
  "reasoning": "<plain-text justification referencing the facts, max 1200 chars, no quotes inside>"
}

Keep the object EXACTLY in this shape — any other field, any array, or any non-JSON syntax makes the whole response invalid and it will be discarded.`;

export interface InsightLlmCallResult {
  raw: string;
  latencyMs: number;
  attempts: number;
  modelVersion: string | null;
}

export interface CallInsightLlmOptions {
  /**
   * Test/adversarial seam: raw string used INSTEAD of a real provider call.
   * Only the route layer may set it, only for ai:configure holders in
   * non-production — enforced by the route, not here. Also accepts
   * { simulatedError: "timeout" | "provider" }.
   */
  simulate?: string | { simulatedError: "timeout" | "provider" };
}

async function singleAttempt(
  caseJson: string,
  simulate?: CallInsightLlmOptions["simulate"]
): Promise<{ content: string; model: string | null }> {
  if (simulate !== undefined) {
    if (typeof simulate === "object" && simulate !== null && "simulatedError" in simulate) {
      throw new InsightLlmError(`simulated ${simulate.simulatedError} error`, simulate.simulatedError);
    }
    return { content: simulate as string, model: null };
  }

  const zai = await getZAI();
  if (!zai) {
    throw new InsightLlmError("AI provider not configured", "unavailable");
  }

  const completion = await Promise.race([
    zai.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: caseJson },
      ],
      thinking: { type: "disabled" },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new InsightLlmError("LLM call timed out", "timeout")), LLM_TIMEOUT_MS)
    ),
  ]);

  const content = completion.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new InsightLlmError("empty completion content", "provider");
  }
  const model = completion.model ?? null;
  return { content, model };
}

export async function callInsightLlm(
  caseData: AnomalyInsightCase,
  policy: InsightPolicy,
  options: CallInsightLlmOptions = {}
): Promise<InsightLlmCallResult> {
  const userPayload = JSON.stringify({
    instruction:
      "Write the ops insight for this anomaly and recommend ONE action. Facts are deterministic; choose only from allowedActions.",
    case: caseData,
    policy: {
      allowedActions: policy.allowedChoices,
      policyNotes: policy.policyNotes,
    },
  });

  const started = Date.now();
  let attempts = 0;
  for (;;) {
    attempts++;
    try {
      const { content, model } = await singleAttempt(userPayload, options.simulate);
      return { raw: content, latencyMs: Date.now() - started, attempts, modelVersion: model };
    } catch (err) {
      const transient =
        err instanceof InsightLlmError && (err.kind === "timeout" || err.kind === "provider");
      if (transient && attempts < 2) {
        await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS));
        continue;
      }
      if (err instanceof InsightLlmError) {
        err.attempts = attempts;
      }
      throw err;
    }
  }
}
