import { NextRequest, NextResponse } from "next/server";
import { getZAI } from "@/lib/zai";
import { getHouseholdSession } from "@/lib/household-auth";
import { getOpsSession } from "@/lib/ops-auth";
import { logAiEvent, newAiChainId } from "@/lib/ai-audit";
import {
  AUDIO_MAX_BYTES,
  RECORDING_MAX_MS,
} from "@/lib/ask-anna-multimodal";
import { checkRateLimit, RATE_LIMITS, rateLimitResponsePayload } from "@/lib/rate-limit";

// ─────────────────────────────────────────────────────────────
// POST /api/voice/transcribe — Voice MVP (Household Ask Anna)
//
// Microphone → speech-to-text. This is an INPUT channel only:
// the transcript returns to the client for preview/editing and
// is then sent through the EXISTING /api/ask-anna route (same
// auth, context, memory, tools, confirmation gates, audit).
//
// SECURITY / PRIVACY:
//   • P0 auth mirrors ask-anna: household session required;
//     ops sessions get 403; unauthenticated callers get 401.
//     Household identity NEVER comes from the request body.
//   • The audio bytes are NEVER persisted — they exist only in
//     the request body memory for the ASR call and are discarded.
//     Only audit metadata (duration, byte size, transcript) is
//     recorded via the existing AI audit chain.
//   • Rate limited per household (10 requests / minute) — ASR is
//     an abuse-prone network call.
// ─────────────────────────────────────────────────────────────

export const runtime = "nodejs";

/** Audio hint validation — extension/format sanity before the ASR call. */
const AUDIO_EXTENSION_ALLOWLIST = /\.(wav|mp3|m4a|flac|ogg|webm)$/i;

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
              "Voice input is part of Ask Anna — the household assistant. Ops staff should use the Ops AI console.",
          },
          { status: 403 }
        );
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const householdId = session.householdId; // NEVER from the request body

    // ── Rate limit (10 / min / household) ──
    const rlKey = `household:${householdId}:voice-transcribe`;
    if (
      !checkRateLimit(
        rlKey,
        RATE_LIMITS.voiceTranscribe.limit,
        RATE_LIMITS.voiceTranscribe.windowMs
      )
    ) {
      return NextResponse.json(rateLimitResponsePayload(rlKey), { status: 429 });
    }

    // ── Parse multipart form ──
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Expected multipart/form-data with an 'audio' field" },
        { status: 400 }
      );
    }

    const audioFiles = form.getAll("audio").filter((v): v is File => v instanceof File);
    if (audioFiles.length === 0) {
      return NextResponse.json({ error: "Missing audio file" }, { status: 400 });
    }
    if (audioFiles.length > 1) {
      return NextResponse.json(
        { error: "Only one audio file per transcription request" },
        { status: 400 }
      );
    }
    const audio = audioFiles[0];

    // Client-supplied duration (hint only — clamped for audit plausibility).
    const durationMsRaw = Number(form.get("durationMs"));
    const durationMs =
      Number.isFinite(durationMsRaw) && durationMsRaw > 0
        ? Math.min(Math.round(durationMsRaw), RECORDING_MAX_MS * 2)
        : null;

    if (audio.size === 0) {
      return NextResponse.json(
        { error: "Empty audio upload — the recording appears to be empty" },
        { status: 400 }
      );
    }
    if (audio.size > AUDIO_MAX_BYTES) {
      return NextResponse.json(
        { error: `Audio too large (${audio.size} bytes; maximum ${AUDIO_MAX_BYTES})` },
        { status: 413 }
      );
    }
    // Format hint: trust declared name/type as a HINT only; the ASR service
    // is the final arbiter of decodability.
    const nameHint = audio.name || "";
    const typeHint = audio.type || "";
    if (
      !AUDIO_EXTENSION_ALLOWLIST.test(nameHint) &&
      !typeHint.startsWith("audio/") &&
      !typeHint.startsWith("video/webm") // MediaRecorder webm containers carry audio
    ) {
      return NextResponse.json(
        {
          error: "Unsupported audio format — use WAV, MP3, M4A, FLAC, OGG or WebM audio",
        },
        { status: 400 }
      );
    }

    // ── AI availability check ──
    const zai = await getZAI();
    if (!zai) {
      return NextResponse.json(
        {
          error:
            "Speech-to-text is unavailable — the AI engine isn't configured on this server. Please type your message instead.",
        },
        { status: 503 }
      );
    }

    // ── Read bytes → base64 → ASR (bytes exist only in memory; never persisted) ──
    const bytes = Buffer.from(await audio.arrayBuffer());
    const base64Audio = bytes.toString("base64");

    const chainId = newAiChainId();
    // Audit: the voice interaction + transcription occurred (no audio retained).
    await logAiEvent({
      stage: "ai_request",
      chainId,
      action: "ai.voice.transcribe",
      actor: { memberId: session.memberId, userName: session.memberName },
      scope: { householdId, surface: "ask-anna-voice" },
      detail: {
        audioBytes: bytes.length,
        durationMs,
        audioName: nameHint.slice(0, 120),
        audioTypeHint: typeHint.slice(0, 60),
        retention: "audio-not-persisted",
      },
      entityType: "ai_conversation",
    });

    let transcript: string;
    try {
      const response = await zai.audio.asr.create({ file_base64: base64Audio });
      transcript = (response?.text ?? "").trim();
    } catch (err) {
      await logAiEvent({
        stage: "result",
        chainId,
        action: "ai.voice.transcribe_failed",
        scope: { householdId, surface: "ask-anna-voice" },
        detail: {
          error: err instanceof Error ? err.message : "ASR provider error",
          audioBytes: bytes.length,
        },
      });
      return NextResponse.json(
        { error: "Transcription failed. Please try again or type your message." },
        { status: 502 }
      );
    }

    if (transcript.length === 0) {
      await logAiEvent({
        stage: "result",
        chainId,
        action: "ai.voice.transcribe_empty",
        scope: { householdId, surface: "ask-anna-voice" },
        detail: { audioBytes: bytes.length, note: "ASR returned no speech content" },
      });
      return NextResponse.json(
        {
          error:
            "No speech detected in the recording. Hold the button while speaking, then release.",
        },
        { status: 422 }
      );
    }

    await logAiEvent({
      stage: "result",
      chainId,
      action: "ai.voice.transcribed",
      scope: { householdId, surface: "ask-anna-voice" },
      detail: {
        transcriptChars: transcript.length,
        transcriptPreview: transcript.slice(0, 200),
        durationMs,
        audioBytes: bytes.length,
      },
    });

    return NextResponse.json({
      transcript: transcript.slice(0, 2000),
      chainId,
    });
  } catch (error) {
    console.error("[/api/voice/transcribe]", error);
    return NextResponse.json(
      {
        error: "Transcription failed unexpectedly. Please try again or type your message.",
      },
      { status: 500 }
    );
  }
}
