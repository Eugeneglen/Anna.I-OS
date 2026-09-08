import { getZAI } from "@/lib/zai";
import type { DisputeCaseData } from "./case-builder";
import type { PolicyAction, PolicyEvaluation } from "./policy";

// ─────────────────────────────────────────────────────────────
// Phase 2 · Step 2.3 — LLM RECOMMENDATION ENGINE + STRICT
// OUTPUT VALIDATOR
//
// The LLM's ONLY job: pick one action from the code-generated
// eligible set (policy.ts) and explain it. It has NO authority
// to: invent an action, invent/bypass/increase a refund amount,
// alter financial calculations, or create exceptions (§2).
//
// validateLlmRecommendation() is a PURE function — it is the
// single validation gate every LLM response passes through,
// imported both by the live server path and by the adversarial
// test suite. ANY invalid output → MANUAL REVIEW. No fallback
// ever silently selects a refund.
// ─────────────────────────────────────────────────────────────

export interface ValidRecommendation {
  action: PolicyAction;
  /** Display-only suggested amount (never authoritative). */
  recommendedAmountCents: number | null;
  confidence: number | null;
  reasoning: string;
  alternativesConsidered: string[];
}

export type LlmValidationResult =
  | { ok: true; recommendation: ValidRecommendation }
  | { ok: false; error: string };

const MAX_REASONING_CHARS = 2000;
const MAX_ALTERNATIVES = 5;
const MAX_ALTERNATIVE_CHARS = 300;

/** Amount-bearing actions and which field they carry. */
const AMOUNT_FIELDS: Partial<Record<PolicyAction, "refundAmountCents" | "voucherAmountCents">> = {
  partial_refund: "refundAmountCents",
  resolve_voucher: "voucherAmountCents",
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Strip markdown code fences around an otherwise-JSON payload. */
function stripFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

function sanitizeText(v: unknown, maxChars: number): string | null {
  if (typeof v !== "string") return null;
  // Remove control characters (prompt-injection hardening for display).
  const cleaned = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return cleaned.slice(0, maxChars);
}

/**
 * Validate a raw LLM response against the code-first policy evaluation.
 * PURE — no I/O, deterministic, exported for adversarial tests.
 *
 * Rejection reasons include: unparseable JSON, non-object, unknown or
 * ineligible action, missing amount on an amount-bearing action,
 * non-integer/decimal amounts, negative amounts, amounts outside the
 * eligible bounds, amount present on a non-amount action
 * (contradiction), malformed fields. Every rejection → the caller
 * records a MANUAL_REVIEW fallback — never a refund.
 */
export function validateLlmRecommendation(
  raw: string,
  policy: PolicyEvaluation
): LlmValidationResult {
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

  // ── action: REQUIRED, must be in the eligible set ──
  const action = parsed.action;
  if (typeof action !== "string" || action.length === 0) {
    return { ok: false, error: "missing or non-string 'action' field" };
  }
  if (!policy.allowedChoices.includes(action as PolicyAction)) {
    return {
      ok: false,
      error: `action '${action.slice(0, 80)}' is not in the code-eligible set [${policy.allowedChoices.join(", ")}]`,
    };
  }
  const chosen = action as PolicyAction;

  // ── amounts ──
  const eligibleEntry = policy.eligibleActions.find((a) => a.action === chosen);
  const expectedAmountField = AMOUNT_FIELDS[chosen];

  let recommendedAmountCents: number | null = null;

  if (expectedAmountField) {
    // Amount REQUIRED for amount-bearing actions.
    const amount = parsed[expectedAmountField];
    if (typeof amount !== "number" || !Number.isFinite(amount)) {
      return {
        ok: false,
        error: `missing or non-numeric '${expectedAmountField}' for action '${chosen}'`,
      };
    }
    if (!Number.isInteger(amount)) {
      return {
        ok: false,
        error: `'${expectedAmountField}' must be an integer number of cents (got decimal)`,
      };
    }
    if (amount <= 0) {
      return { ok: false, error: `'${expectedAmountField}' must be positive (got ${amount})` };
    }
    const bounds = eligibleEntry?.bounds;
    if (!bounds) {
      return { ok: false, error: `no bounds available for eligible action '${chosen}'` };
    }
    if (amount < bounds.minAmountCents || amount > bounds.maxAmountCents) {
      return {
        ok: false,
        error: `'${expectedAmountField}' ${amount} is outside the eligible bounds [${bounds.minAmountCents}, ${bounds.maxAmountCents}]`,
      };
    }
    recommendedAmountCents = amount;
  } else {
    // Non-amount action: an amount field present is a CONTRADICTION —
    // (e.g. "dismiss" with a refund amount, or a manipulated response).
    for (const field of ["refundAmountCents", "voucherAmountCents"] as const) {
      if (parsed[field] !== undefined && parsed[field] !== null) {
        return {
          ok: false,
          error: `action '${chosen}' carries '${field}' — contradictory recommendation (this action has no amount parameter)`,
        };
      }
    }
  }

  // ── confidence: informational; invalid → null (not fatal) ──
  let confidence: number | null = null;
  const rawConfidence = parsed.confidence;
  if (typeof rawConfidence === "number" && Number.isFinite(rawConfidence)) {
    if (rawConfidence >= 0 && rawConfidence <= 1) {
      confidence = rawConfidence;
    }
  }

  // ── reasoning: optional string, sanitized ──
  const reasoning =
    sanitizeText(parsed.reasoning ?? parsed.rationale, MAX_REASONING_CHARS) ??
    "No reasoning provided by the model.";

  // ── alternatives: informational, sanitized, bounded ──
  const alternativesConsidered: string[] = [];
  if (Array.isArray(parsed.alternativesConsidered)) {
    for (const alt of parsed.alternativesConsidered.slice(0, MAX_ALTERNATIVES)) {
      const text = sanitizeText(alt, MAX_ALTERNATIVE_CHARS);
      if (text && text.length > 0) alternativesConsidered.push(text);
    }
  }

  return {
    ok: true,
    recommendation: {
      action: chosen,
      recommendedAmountCents,
      confidence,
      reasoning,
      alternativesConsidered,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// The MANUAL_REVIEW fallback recommendation — the ONLY result an
// invalid LLM output can produce. Nothing here ever selects a
// refund silently.
// ─────────────────────────────────────────────────────────────

export function manualReviewFallback(error: string): ValidRecommendation {
  return {
    action: "manual_review",
    recommendedAmountCents: null,
    confidence: null,
    reasoning:
      `The AI recommendation was rejected by policy validation (${error.slice(0, 300)}). ` +
      "Falling back to MANUAL REVIEW: a human must resolve this dispute through the standard escrow controls. " +
      "No automated action was taken.",
    alternativesConsidered: [],
  };
}

// ─────────────────────────────────────────────────────────────
// LLM invocation
// ─────────────────────────────────────────────────────────────

export class DisputeLlmError extends Error {
  constructor(
    message: string,
    public kind: "timeout" | "provider" | "unavailable",
    /** How many LLM attempts were made before giving up (tracking §8). */
    public attempts: number = 1
  ) {
    super(message);
    this.name = "DisputeLlmError";
  }
}

const LLM_TIMEOUT_MS = 20_000; // per attempt — 2 attempts + build stays inside the 60s brief SLA
const TRANSIENT_RETRY_DELAY_MS = 1_500;

const SYSTEM_PROMPT = `You are Anna.I's dispute-resolution advisor. You investigate a household service dispute and RECOMMEND one resolution action for a human operations operator.

ABSOLUTE CONSTRAINTS — violations make your output invalid and it will be discarded:
1. You may ONLY choose an action from the "eligibleActions" list provided. Never invent, rename, or guess actions.
2. "partial_refund" requires "refundAmountCents" — an integer number of cents within the stated bounds.
3. "resolve_voucher" requires "voucherAmountCents" — an integer number of cents within the stated bounds.
4. "resolve_refund", "resolve_dismiss", "manual_review" carry NO amount fields. Do not attach any.
5. Amounts outside the bounds, negative, decimal, or attached to the wrong action are INVALID.
6. You have NO financial authority: every figure you see was computed by deterministic code and will be recomputed at execution. Your amount (if any) is a display suggestion only.
7. You are ADVISING. A human decides. Never state that you executed anything.

Respond with ONE JSON object and NOTHING else (no prose, no markdown, no extra fields):
{
  "action": "<one action from eligibleActions>",
  "refundAmountCents": <integer, only when action is partial_refund>,
  "voucherAmountCents": <integer, only when action is resolve_voucher>,
  "confidence": <number 0..1>,
  "reasoning": "<plain-text evidence-based justification, max 1200 chars, no quotes inside>"
}

Keep the object EXACTLY in this shape — any other field, any array, or any
non-JSON syntax makes the whole response invalid and it will be discarded.`;

export interface LlmCallResult {
  raw: string;
  latencyMs: number;
  attempts: number;
}

export interface CallLlmOptions {
  /**
   * Test/adversarial seam: when provided, this raw string is used INSTEAD of
   * a real provider call. Only the route layer may set it, and only for
   * callers holding ai:configure in non-production — enforced by the route,
   * not here. Also accepts { simulatedError: "timeout" | "provider" }.
   */
  simulate?: string | { simulatedError: "timeout" | "provider" };
}

async function singleAttempt(caseJson: string, simulate?: CallLlmOptions["simulate"]): Promise<string> {
  if (simulate !== undefined) {
    if (typeof simulate === "object" && simulate !== null && "simulatedError" in simulate) {
      throw new DisputeLlmError(
        `simulated ${simulate.simulatedError} error`,
        simulate.simulatedError
      );
    }
    return simulate as string;
  }

  const zai = await getZAI();
  if (!zai) {
    throw new DisputeLlmError("AI provider not configured", "unavailable");
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
      setTimeout(() => reject(new DisputeLlmError("LLM call timed out", "timeout")), LLM_TIMEOUT_MS)
    ),
  ]);

  const content = completion.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new DisputeLlmError("empty completion content", "provider");
  }
  return content;
}

/**
 * Call the recommendation LLM for a dispute case.
 * One retry ONLY for transient failures (timeout / provider error) —
 * invalid OUTPUT is never retried (validation happens after, once).
 */
export async function callDisputeRecommendationLlm(
  caseData: DisputeCaseData,
  policy: PolicyEvaluation,
  options: CallLlmOptions = {}
): Promise<LlmCallResult> {
  const userPayload = JSON.stringify({
    instruction:
      "Investigate this dispute case and recommend ONE resolution action. Facts are deterministic; choose only from eligibleActions.",
    case: caseData,
    policy: {
      eligibleActions: policy.eligibleActions,
      allowedChoices: policy.allowedChoices,
      policyNotes: policy.policyNotes,
    },
  });

  const started = Date.now();
  let attempts = 0;
  for (;;) {
    attempts++;
    try {
      const raw = await singleAttempt(userPayload, options.simulate);
      return { raw, latencyMs: Date.now() - started, attempts };
    } catch (err) {
      const transient =
        err instanceof DisputeLlmError &&
        (err.kind === "timeout" || err.kind === "provider");
      if (transient && attempts < 2) {
        await new Promise((r) => setTimeout(r, TRANSIENT_RETRY_DELAY_MS));
        continue;
      }
      if (err instanceof DisputeLlmError) {
        err.attempts = attempts;
      }
      throw err;
    }
  }
}
