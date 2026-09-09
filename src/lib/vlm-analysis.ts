import { db } from "@/lib/db";
import { getZAI } from "@/lib/zai";
import { logAiEvent, newAiChainId } from "@/lib/ai-audit";
import { PhotoVerificationVerdict, Prisma } from "@prisma/client";
import { readFile } from "fs/promises";
import { join, basename } from "path";

// ─────────────────────────────────────────────────────────────
// Phase 3 · §3.4 — VLM PERSISTENCE (vendor completion photos)
//
//   completion photo → VLM analysis → PERSISTED verdict →
//   decision support → human outcome
//
// HARD RULE: the VLM NEVER releases escrow. This module has ZERO
// imports of the escrow/execute-action path — it cannot move
// money. Its output is a persisted PhotoVerification row plus an
// advisory recommendation that a HUMAN reads. The human outcome
// is stamped later by the existing verification route.
// ─────────────────────────────────────────────────────────────

const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), "public");
const VLM_TIMEOUT_MS = 45_000; // vision calls are slower than text
const MAX_CONCERNS = 10;
const MAX_CONCERN_CHARS = 300;

const VERDICTS: PhotoVerificationVerdict[] = ["PASS", "FAIL", "UNCLEAR"];
const RECOMMENDATIONS = ["approve", "review", "reject"] as const;

export interface VlmVerdictInput {
  verdict: PhotoVerificationVerdict;
  qualityScore: number | null;
  recommendation: "approve" | "review" | "reject";
  concerns: string[];
  issues: Record<string, unknown> | null;
}

export type VlmValidationResult =
  | { ok: true; verdict: VlmVerdictInput }
  | { ok: false; error: string };

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
 * PURE validator for the VLM verdict — exported for adversarial tests.
 * Rejections: unparseable JSON, non-object, unknown verdict, out-of-range
 * quality score, unknown recommendation. The caller then persists the
 * UNCLEAR/review safe fallback — decision support only, never a gate.
 */
export function validateVlmVerdict(raw: string): VlmValidationResult {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, error: "empty or non-string VLM response" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { ok: false, error: "response is not valid JSON" };
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return { ok: false, error: "response is not valid JSON" };
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "response is not a JSON object" };
  }
  const obj = parsed as Record<string, unknown>;

  // verdict: map the model's completionStatus/recommendation into the enum.
  let verdict: PhotoVerificationVerdict | null = null;
  if (typeof obj.verdict === "string" && VERDICTS.includes(obj.verdict as PhotoVerificationVerdict)) {
    verdict = obj.verdict as PhotoVerificationVerdict;
  } else if (typeof obj.completionStatus === "string") {
    if (obj.completionStatus === "completed") verdict = "PASS";
    else if (obj.completionStatus === "not_completed") verdict = "FAIL";
    else if (obj.completionStatus === "partially_completed") verdict = "UNCLEAR";
  }
  if (!verdict) {
    return { ok: false, error: "missing or unknown 'verdict'/'completionStatus'" };
  }

  // qualityScore: integer 0–10, else null (not fatal).
  let qualityScore: number | null = null;
  if (typeof obj.qualityScore === "number" && Number.isFinite(obj.qualityScore)) {
    if (Number.isInteger(obj.qualityScore) && obj.qualityScore >= 0 && obj.qualityScore <= 10) {
      qualityScore = obj.qualityScore;
    }
  }

  // recommendation: approve | review | reject, else "review".
  let recommendation: "approve" | "review" | "reject" = "review";
  if (
    typeof obj.recommendation === "string" &&
    (RECOMMENDATIONS as readonly string[]).includes(obj.recommendation)
  ) {
    recommendation = obj.recommendation as (typeof RECOMMENDATIONS)[number];
  }

  // concerns: bounded array of strings.
  const concerns: string[] = [];
  if (Array.isArray(obj.concerns)) {
    for (const c of obj.concerns.slice(0, MAX_CONCERNS)) {
      const text = sanitizeText(c, MAX_CONCERN_CHARS);
      if (text && text.length > 0 && text.toLowerCase() !== "none") concerns.push(text);
    }
  } else if (typeof obj.concerns === "string" && obj.concerns.trim().length > 0) {
    const text = sanitizeText(obj.concerns, MAX_CONCERN_CHARS);
    if (text && text.toLowerCase() !== "none") concerns.push(text);
  }

  const issues =
    typeof obj.summary === "string"
      ? { summary: sanitizeText(obj.summary, 800) ?? null, changes: sanitizeText(obj.changes, 800) ?? null }
      : null;

  return { ok: true, verdict: { verdict, qualityScore, recommendation, concerns, issues } };
}

/** The safe fallback for invalid VLM output — UNCLEAR + review. */
export function unclearVlmFallback(error: string): VlmVerdictInput {
  return {
    verdict: "UNCLEAR",
    qualityScore: null,
    recommendation: "review",
    concerns: [`VLM output failed validation: ${error.slice(0, 200)}`],
    issues: { parseError: error.slice(0, 300) },
  };
}

export interface AnalyzePhotoOptions {
  trigger: "photo_uploaded" | "manual" | "sweep";
  /** Force re-analysis even when a verdict exists. */
  force?: boolean;
}

export interface AnalyzePhotoResult {
  status: "generated" | "exists" | "failed" | "not_found";
  photoVerificationId: string | null;
  error?: string;
}

function mimeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    default:
      return "application/octet-stream";
  }
}

/**
 * Analyze ONE verification photo through the VLM and persist the verdict.
 * Idempotent per photo (verificationPhotoId is unique) unless forced.
 * NEVER touches escrow — decision support only.
 */
export async function analyzeVerificationPhoto(
  photoId: string,
  options: AnalyzePhotoOptions
): Promise<AnalyzePhotoResult> {
  const photo = await db.verificationPhoto.findUnique({
    where: { id: photoId },
    include: {
      task: { select: { id: true, jobNo: true, category: true, householdId: true } },
      booking: { select: { vendorId: true } },
    },
  });
  if (!photo) {
    return { status: "not_found", photoVerificationId: null };
  }

  const existing = await db.photoVerification.findUnique({
    where: { verificationPhotoId: photoId },
  });
  if (existing && !options.force) {
    return { status: "exists", photoVerificationId: existing.id };
  }

  const zai = await getZAI();
  if (!zai) {
    if (existing) return { status: "exists", photoVerificationId: existing.id };
    return { status: "failed", photoVerificationId: null, error: "AI provider not configured" };
  }

  // ── Read the image bytes from disk → base64 data URL (server-side only;
  //    the file path comes from the DB row, never the client) ──
  const filename = basename(photo.fileUrl);
  const filePath = join(UPLOAD_DIR, "attachments", "verification", filename);
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    return {
      status: "failed",
      photoVerificationId: null,
      error: `photo file not readable at ${filename}`,
    };
  }
  const dataUrl = `data:${mimeFor(filename)};base64,${bytes.toString("base64")}`;

  const categoryContext = photo.task.category
    ? `Service category: ${photo.task.category.toLowerCase()}.`
    : "";
  const prompt = `You are a quality verification AI for a home services platform. Analyze this work photo from task ${photo.task.jobNo ?? photo.taskId}.

${categoryContext}

Assess the visible work quality and completion state.

Respond with ONE JSON object and NOTHING else (no prose, no markdown):
{
  "verdict": "PASS" | "FAIL" | "UNCLEAR",
  "qualityScore": <integer 0-10>,
  "recommendation": "approve" | "review" | "reject",
  "concerns": ["<string>", ...],
  "summary": "<one-sentence assessment>"
}

PASS means the visible work looks complete and acceptable. FAIL means clear problems. UNCLEAR when the photo cannot support a judgement.`;

  const chainId = existing?.aiChainId ?? newAiChainId();
  const scope = {
    householdId: photo.task.householdId,
    vendorId: photo.booking?.vendorId ?? undefined,
    entityType: "verification_photo",
    entityId: photo.id,
    surface: "vlm-verification",
  };

  try {
    await logAiEvent({
      stage: "ai_request",
      chainId,
      action: "ai.vlm.request",
      scope,
      detail: { photoId: photo.id, trigger: options.trigger, taskJobNo: photo.task.jobNo },
    });
  } catch (e) {
    console.error("[vlm-analysis] audit request stage failed:", e);
  }

  let verdictInput: VlmVerdictInput;
  let modelVersion: string | null = null;
  try {
    const completion = await Promise.race([
      zai.chat.completions.createVision({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        thinking: { type: "disabled" },
        // The SDK's vision body TYPE marks `model` required, but the
        // runtime routes to the default vision model when omitted (the
        // same convention as every other zai call in this codebase —
        // no model name is ever specified). Cast keeps the runtime
        // pattern and the type gate happy.
      } as Parameters<typeof zai.chat.completions.createVision>[0]),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`VLM call timed out after ${VLM_TIMEOUT_MS}ms`)),
          VLM_TIMEOUT_MS
        )
      ),
    ]);

    const rawContent = completion.choices?.[0]?.message?.content ?? "";
    modelVersion = completion.model ?? "zai-vision-default";
    const validation = validateVlmVerdict(rawContent);
    verdictInput = validation.ok ? validation.verdict : unclearVlmFallback(validation.error);
  } catch (err) {
    // Provider failure → persisted FAILED-visible verdict (UNCLEAR/review),
    // never a silent gap: the row records the failure reason.
    const message = err instanceof Error ? err.message : "unknown VLM error";
    await db.photoVerification
      .upsert({
        where: { verificationPhotoId: photoId },
        update: {
          verdict: "UNCLEAR",
          qualityScore: null,
          recommendation: "review",
          concerns: [`VLM analysis failed: ${message.slice(0, 200)}`] as unknown as Prisma.InputJsonValue,
          issues: { error: message.slice(0, 300) } as unknown as Prisma.InputJsonValue,
          modelVersion: null,
          aiChainId: chainId,
        },
        create: {
          verificationPhotoId: photoId,
          verdict: "UNCLEAR",
          qualityScore: null,
          recommendation: "review",
          concerns: [`VLM analysis failed: ${message.slice(0, 200)}`] as unknown as Prisma.InputJsonValue,
          issues: { error: message.slice(0, 300) } as unknown as Prisma.InputJsonValue,
          modelVersion: null,
          aiChainId: chainId,
        },
      })
      .catch((e) => console.error("[vlm-analysis] failure persist failed:", e));
    return { status: "failed", photoVerificationId: null, error: message };
  }

  // ── Persist the verdict (one row per photo, upsert keyed unique) ──
  const row = await db.photoVerification.upsert({
    where: { verificationPhotoId: photoId },
    update: {
      verdict: verdictInput.verdict,
      qualityScore: verdictInput.qualityScore,
      recommendation: verdictInput.recommendation,
      concerns: verdictInput.concerns as unknown as Prisma.InputJsonValue,
      issues: verdictInput.issues as unknown as Prisma.InputJsonValue,
      modelVersion,
      aiChainId: chainId,
    },
    create: {
      verificationPhotoId: photoId,
      verdict: verdictInput.verdict,
      qualityScore: verdictInput.qualityScore,
      recommendation: verdictInput.recommendation,
      concerns: verdictInput.concerns as unknown as Prisma.InputJsonValue,
      issues: verdictInput.issues as unknown as Prisma.InputJsonValue,
      modelVersion,
      aiChainId: chainId,
    },
  });

  try {
    await logAiEvent({
      stage: "ai_recommendation",
      chainId,
      action: "ai.vlm.verdict",
      actor: undefined, // ANNA-AI — the verdict is system-generated
      scope,
      detail: {
        verdict: verdictInput.verdict,
        qualityScore: verdictInput.qualityScore,
        recommendation: verdictInput.recommendation,
        modelVersion,
        decisionSupportOnly: true,
      },
    });
  } catch (e) {
    console.error("[vlm-analysis] audit recommendation stage failed:", e);
  }

  return { status: "generated", photoVerificationId: row.id };
}
