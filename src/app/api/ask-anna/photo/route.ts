import { NextRequest, NextResponse } from "next/server";
import { getZAI } from "@/lib/zai";
import { getHouseholdSession } from "@/lib/household-auth";
import { getOpsSession } from "@/lib/ops-auth";
import { logAiEvent, newAiChainId } from "@/lib/ai-audit";
import {
  PHOTO_ACCEPTED_MIME,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_PER_MESSAGE,
  PHOTO_TOKEN_TTL_MS,
  PHOTO_ANALYSIS_PROMPT,
  photoAnalysisFallback,
  sha256Hex,
  signPhotoAnalysis,
  validateImageBytes,
  validatePhotoAnalysis,
  type PhotoAnalysis,
} from "@/lib/ask-anna-multimodal";
import { checkRateLimit, RATE_LIMITS, rateLimitResponsePayload } from "@/lib/rate-limit";

// ─────────────────────────────────────────────────────────────
// POST /api/ask-anna/photo — Photo MVP (Household Ask Anna)
//
// Take/choose photo → authenticated image-analysis request →
// structured VLM triage → signed token → EXISTING /api/ask-anna
// flow (same context, tools, confirmation gates, audit).
//
// SECURITY / PRIVACY:
//   • P0 auth mirrors ask-anna: household session required; ops
//     get 403; unauthenticated get 401. Household identity NEVER
//     comes from the request body (client-supplied ids ignored).
//   • IMAGE RETENTION: the original image is NEVER persisted — no
//     file store, no DB blob. Bytes travel over TLS, are analyzed
//     in-memory, and discarded when the request ends. Retained:
//     the structured analysis (bounded text), a SHA-256
//     fingerprint, and audit metadata. Customer images are never
//     used for training.
//   • The analysis returns to the client inside an HMAC-SHA256
//     token bound to THIS household with a 15-minute expiry — it
//     cannot be forged, swapped, or used by another household
//     when it comes back with the ask-anna call.
//   • Rate limited: 10 photos / minute / household.
//   • Exactly ONE photo per message (MVP).
// ─────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const VLM_TIMEOUT_MS = 45_000; // vision calls are slower than text

export async function POST(request: NextRequest) {
  try {
    // ── P0 auth: household identity ONLY from the session ──
    const session = await getHouseholdSession();
    if (!session) {
      const ops = await getOpsSession();
      if (ops) {
        return NextResponse.json(
          {
            error:
              "Photo input is part of Ask Anna — the household assistant. Ops staff should use the Ops AI console.",
          },
          { status: 403 }
        );
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const householdId = session.householdId; // NEVER from the request body

    // ── Rate limit (10 / min / household) ──
    const rlKey = `household:${householdId}:photo-analyze`;
    if (
      !checkRateLimit(rlKey, RATE_LIMITS.photoAnalyze.limit, RATE_LIMITS.photoAnalyze.windowMs)
    ) {
      return NextResponse.json(rateLimitResponsePayload(rlKey), { status: 429 });
    }

    // ── Parse multipart form ──
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Expected multipart/form-data with a 'photo' field" },
        { status: 400 }
      );
    }

    // Any client-supplied householdId in the form is DELIBERATELY IGNORED —
    // scope comes from the session (tested: spoofed ids cannot change ownership).
    const photoFiles = form.getAll("photo").filter((v): v is File => v instanceof File);
    if (photoFiles.length === 0) {
      return NextResponse.json({ error: "Missing photo file" }, { status: 400 });
    }
    if (photoFiles.length > PHOTO_MAX_PER_MESSAGE) {
      return NextResponse.json(
        {
          error: `Only ${PHOTO_MAX_PER_MESSAGE} photo per message is supported — attach one image at a time`,
        },
        { status: 400 }
      );
    }
    const photo = photoFiles[0];

    if (photo.size === 0) {
      return NextResponse.json(
        { error: "Empty upload — no image bytes received" },
        { status: 400 }
      );
    }
    if (photo.size > PHOTO_MAX_BYTES) {
      return NextResponse.json(
        { error: `Image too large (${photo.size} bytes; maximum ${PHOTO_MAX_BYTES})` },
        { status: 413 }
      );
    }

    // ── Read bytes → magic-byte validation (content decides, not claims) ──
    const bytes = Buffer.from(await photo.arrayBuffer());
    const declaredMime = (PHOTO_ACCEPTED_MIME as readonly string[]).includes(photo.type)
      ? photo.type
      : null;
    const imageCheck = validateImageBytes(bytes, declaredMime);
    if (!imageCheck.ok) {
      return NextResponse.json({ error: imageCheck.error }, { status: 400 });
    }

    // ── AI availability check ──
    const zai = await getZAI();
    if (!zai) {
      return NextResponse.json(
        {
          error:
            "Photo analysis is unavailable — the AI engine isn't configured on this server. Please describe the problem in text instead.",
        },
        { status: 503 }
      );
    }

    const imageSha256 = sha256Hex(bytes);
    const chainId = newAiChainId();

    // Audit: a photo analysis occurred (image bytes themselves never stored).
    await logAiEvent({
      stage: "ai_request",
      chainId,
      action: "ai.photo.analyze",
      actor: { memberId: session.memberId, userName: session.memberName },
      scope: { householdId, surface: "ask-anna-photo" },
      detail: {
        imageBytes: bytes.length,
        imageMime: imageCheck.mime,
        imageSha256,
        declaredName: (photo.name || "").slice(0, 120),
        retention: "image-not-persisted",
        trainingUse: false,
      },
      entityType: "ai_conversation",
    });

    // ── VLM triage call (base64 data URL; bytes live in memory only) ──
    const dataUrl = `data:${imageCheck.mime};base64,${bytes.toString("base64")}`;
    let analysis: PhotoAnalysis;
    let degraded = false;
    try {
      const completion = await Promise.race([
        zai.chat.completions.createVision({
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: PHOTO_ANALYSIS_PROMPT },
                { type: "image_url", image_url: { url: dataUrl } },
              ],
            },
          ],
          thinking: { type: "disabled" },
          // The SDK's vision body TYPE marks `model` required, but the
          // runtime routes to the default vision model when omitted (the
          // same convention + cast as every other zai vision call site in
          // this codebase — vlm-analysis.ts).
        } as Parameters<typeof zai.chat.completions.createVision>[0]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("VLM timeout")), VLM_TIMEOUT_MS)
        ),
      ]);

      const raw = completion.choices[0]?.message?.content ?? "";
      const validation = validatePhotoAnalysis(raw);
      if (validation.ok) {
        analysis = validation.analysis;
      } else {
        degraded = true;
        analysis = photoAnalysisFallback(validation.error);
      }
    } catch (err) {
      degraded = true;
      analysis = photoAnalysisFallback(
        err instanceof Error ? err.message : "VLM provider error"
      );
    }

    // ── Audit: analysis result (bounded summary, never the image) ──
    await logAiEvent({
      stage: "ai_recommendation",
      chainId,
      action: degraded ? "ai.photo.analysis_degraded" : "ai.photo.analyzed",
      scope: { householdId, surface: "ask-anna-photo" },
      detail: {
        imageSha256,
        imageQuality: analysis.imageQuality,
        issueType: analysis.issueType,
        confidence: analysis.confidence,
        recommendedCategory: analysis.recommendedCategory,
        needsMoreInfo: analysis.needsMoreInfo,
        observationCount: analysis.visibleObservations.length,
        containsInstructionText: analysis.containsInstructionText,
        degraded,
      },
    });

    // ── Sign the analysis (household-bound, 15-min TTL) and return ──
    const photoToken = signPhotoAnalysis({
      householdId,
      analysis,
      imageSha256,
      ttlMs: PHOTO_TOKEN_TTL_MS,
    });

    return NextResponse.json({
      analysis,
      photoToken,
      expiresAt: Date.now() + PHOTO_TOKEN_TTL_MS,
      chainId,
      degraded,
    });
  } catch (error) {
    console.error("[/api/ask-anna/photo]", error);
    return NextResponse.json(
      { error: "Photo analysis failed unexpectedly. Please try again or describe the problem in text." },
      { status: 500 }
    );
  }
}
