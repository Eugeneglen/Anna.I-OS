"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Send,
  AlertCircle,
  CheckCircle2,
  CalendarDays,
  Shield,
  Sparkles,
  CircleDot,
  Camera,
  ImageIcon,
  Mic,
  Square,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAnnaStore } from "@/lib/store";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  pendingConfirmation?: PendingConfirmation;
  actionResult?: {
    success: boolean;
    toolName: string;
    data?: Record<string, unknown>;
  };
  /** Multimodal MVP: badge shown when this user turn had a photo attached. */
  photoAttached?: boolean;
  /** Multimodal MVP: badge shown when this user turn came from voice. */
  voiceInput?: boolean;
}

interface PendingConfirmation {
  toolName: string;
  confirmationMessage: string;
  confirmationAction: Record<string, unknown>;
  /** Server-generated — sent back on confirm so the audit chain
   *  correlates the human decision with the original AI request. */
  chainId?: string;
}

interface AskAnnaResponse {
  response: string;
  dataUsed: string[];
  pendingConfirmation?: PendingConfirmation;
  actionResult?: {
    success: boolean;
    toolName: string;
    data?: Record<string, unknown>;
  };
  conversationId?: string;
  chainId?: string;
  aiUnavailable?: boolean;
}

// ─────────────────────────────────────────────────────────────
// Multimodal MVP — client-side voice capture (press-to-talk)
//
// Captures raw PCM via AudioContext + ScriptProcessorNode (baseline
// support incl. Safari), then encodes a 16 kHz mono 16-bit WAV — a
// deterministic format the server-side ASR handles well. 60 s at
// 16 kHz ≈ 1.9 MB, comfortably under the 10 MB upload cap.
// ─────────────────────────────────────────────────────────────

const MAX_RECORDING_SECONDS = 60;
const TARGET_SAMPLE_RATE = 16_000;

/** Encode captured Float32 PCM chunks as a 16 kHz mono WAV blob. */
function encodeWav(chunks: Float32Array[], inputSampleRate: number): Blob {
  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  // Downsample (box-average decimation) to the ASR-friendly rate.
  const ratio = Math.max(1, inputSampleRate / TARGET_SAMPLE_RATE);
  const outLen = Math.max(1, Math.floor(merged.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(merged.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += merged[j];
    out[i] = sum / (end - start);
  }
  // 16-bit PCM WAV header.
  const buffer = new ArrayBuffer(44 + out.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + out.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, out.length * 2, true);
  for (let i = 0; i < out.length; i++) {
    const s = Math.max(-1, Math.min(1, out[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}

interface AttachedPhoto {
  file: File;
  previewUrl: string;
}

// ─────────────────────────────────────────────────────────────
// Typing indicator
// ─────────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-start gap-2.5 px-4">
      <div className="w-7 h-7 rounded-full bg-[var(--anna-sage)] flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-[8px] font-bold text-white tracking-tight">A.I</span>
      </div>
      <div className="bg-[var(--anna-white)] border border-[var(--anna-border)] rounded-2xl rounded-tl-md px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 bg-[var(--anna-muted)] rounded-full animate-bounce [animation-delay:0ms]" />
          <span className="w-2 h-2 bg-[var(--anna-muted)] rounded-full animate-bounce [animation-delay:150ms]" />
          <span className="w-2 h-2 bg-[var(--anna-muted)] rounded-full animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Confirmation Card
// ─────────────────────────────────────────────────────────────

function ConfirmationCard({
  message,
  onConfirm,
  onDismiss,
  isPending,
}: {
  message: string;
  onConfirm: () => void;
  onDismiss: () => void;
  isPending: boolean;
}) {
  return (
    <div className="mx-4 my-1 anna-fade-in">
      <div className="bg-[var(--anna-sage-light)]/50 border border-[var(--anna-sage)]/30 rounded-2xl p-4 space-y-3">
        <div className="flex items-start gap-2">
          <div className="w-6 h-6 rounded-lg bg-[var(--anna-sage)]/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Shield size={12} className="text-[var(--anna-sage-dark)]" />
          </div>
          <p className="text-xs font-medium text-[var(--anna-slate)] leading-relaxed">
            {message}
          </p>
        </div>
        <div className="flex items-center gap-2 justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={onDismiss}
            disabled={isPending}
            className="rounded-lg h-8 text-xs text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-lg h-8 text-xs bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white font-semibold"
          >
            {isPending ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Confirming...
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <CheckCircle2 size={12} />
                Confirm
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Success/Error Result Card
// ─────────────────────────────────────────────────────────────

function ResultCard({
  success,
  toolName,
  data,
}: {
  success: boolean;
  toolName: string;
  data?: Record<string, unknown>;
}) {
  const toolLabels: Record<string, string> = {
    create_task: "Task Created",
    cancel_task: "Task Cancelled",
  };

  return (
    <div className="mx-4 my-1 anna-fade-in">
      <div
        className={cn(
          "rounded-xl p-3 flex items-center gap-2",
          success
            ? "bg-[var(--anna-success)]/10 border border-[var(--anna-success)]/20"
            : "bg-red-50 border border-red-200"
        )}
      >
        {success ? (
          <CheckCircle2 size={14} className="text-[var(--anna-success)] flex-shrink-0" />
        ) : (
          <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
        )}
        <span
          className={cn(
            "text-xs font-medium",
            success ? "text-[var(--anna-success)]" : "text-red-600"
          )}
        >
          {toolLabels[toolName] || toolName}
          {success && data && (
            <span className="text-[var(--anna-muted)] font-normal ml-1.5">
              — {data.scheduledDate || data.taskId || ""}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Quick-suggestion chips (NLU-aware)
// ─────────────────────────────────────────────────────────────

const SUGGESTION_CHIPS = [
  {
    label: "Book a cleaning for tomorrow",
    prompt: "Book a cleaning service for tomorrow at 10am",
    icon: CalendarDays,
  },
  {
    label: "What's my escrow balance?",
    prompt: "What's my current escrow balance?",
    icon: CircleDot,
  },
  {
    label: "Show my upcoming tasks",
    prompt: "What tasks are coming up for my household?",
    icon: CalendarDays,
  },
  {
    label: "Schedule aircon servicing",
    prompt: "I need an aircon servicing for next week",
    icon: Sparkles,
  },
];

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

export function AskAnna() {
  const { askAnnaOpen, setAskAnnaOpen, selectedHouseholdId } =
    useAnnaStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [aiUnavailable, setAiUnavailable] = useState(false);
  // Conversation threading: the server owns the conversation; we just echo
  // its id back on subsequent turns (L4 traceability — not chat memory).
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Multimodal MVP state ──
  const [attachedPhoto, setAttachedPhoto] = useState<AttachedPhoto | null>(null);
  const [isAnalyzingPhoto, setIsAnalyzingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [micDenied, setMicDenied] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [voiceTranscriptPending, setVoiceTranscriptPending] = useState(false);
  const [lastInputWasVoice, setLastInputWasVoice] = useState(false);
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);

  // Photo file inputs: one with capture (device camera), one without (library).
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  // Voice capture refs.
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioChunksRef = useRef<Float32Array[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef<number>(0);
  const autoStoppedRef = useRef(false);

  // Cleanup on unmount: stop any live capture + revoke any preview URL.
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      processorRef.current?.disconnect();
      sourceRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void audioContextRef.current?.close();
    };
  }, []);

  // Check AI availability when panel opens
  useEffect(() => {
    if (askAnnaOpen) {
      fetch("/api/ai-status")
        .then((r) => r.json())
        .then((data) => setAiUnavailable(!data.available))
        .catch(() => setAiUnavailable(false)); // Assume available if check fails
    }
  }, [askAnnaOpen]);

  // Mutation for sending messages
  const mutation = useMutation({
    mutationFn: async ({
      msg,
      confirmAction,
      photoToken,
      inputModality,
    }: {
      msg: string;
      confirmAction?: {
        toolName: string;
        action: Record<string, unknown>;
        chainId?: string;
      };
      photoToken?: string;
      inputModality?: "text" | "voice";
    }): Promise<AskAnnaResponse> => {
      const res = await fetch("/api/ask-anna", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          householdId: selectedHouseholdId,
          conversationId: conversationId ?? undefined,
          confirmAction,
          photoToken,
          inputModality,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to get response");
      }
      return res.json();
    },
    onSuccess: (data, variables) => {
      // If AI is unavailable, mark it for future display
      if (data.aiUnavailable) {
        setAiUnavailable(true);
      }
      if (data.conversationId) {
        setConversationId(data.conversationId);
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.response,
          timestamp: Date.now(),
          pendingConfirmation: data.pendingConfirmation || undefined,
          actionResult: data.actionResult || undefined,
        },
      ]);
    },
    onError: (error) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Sorry, something went wrong — ${error.message}`,
          timestamp: Date.now(),
        },
      ]);
    },
  });

  // Handle confirmation
  const confirmMutation = useMutation({
    mutationFn: async ({
      originalMessage,
      confirmAction,
    }: {
      originalMessage: string;
      confirmAction: {
        toolName: string;
        action: Record<string, unknown>;
        chainId?: string;
      };
    }) => {
      const res = await fetch("/api/ask-anna", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Confirm: ${confirmAction.toolName}`,
          householdId: selectedHouseholdId,
          conversationId: conversationId ?? undefined,
          confirmAction,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Confirmation failed");
      }
      return res.json();
    },
    onSuccess: (data, variables) => {
      // Thread the conversation across the confirm boundary too.
      if (data.conversationId) {
        setConversationId(data.conversationId);
      }
      // Remove the confirmation from the last assistant message
      setMessages((prev) => {
        const updated = [...prev];
        const lastAssistant = updated.findLastIndex((m) => m.role === "assistant");
        if (lastAssistant >= 0) {
          updated[lastAssistant] = {
            ...updated[lastAssistant],
            pendingConfirmation: undefined,
            actionResult: data.actionResult
              ? {
                  success: data.actionResult.success,
                  toolName: data.actionResult.toolName,
                  data: data.actionResult.data,
                }
              : undefined,
          };
        }
        // Add the follow-up response
        updated.push({
          role: "assistant",
          content: data.response,
          timestamp: Date.now(),
          actionResult: data.actionResult
            ? {
                success: data.actionResult.success,
                toolName: data.actionResult.toolName,
                data: data.actionResult.data,
              }
            : undefined,
        });
        return updated;
      });
    },
    onError: (error) => {
      // Mark confirmation as failed
      setMessages((prev) => {
        const updated = [...prev];
        const lastAssistant = updated.findLastIndex((m) => m.role === "assistant");
        if (lastAssistant >= 0) {
          updated[lastAssistant] = {
            ...updated[lastAssistant],
            pendingConfirmation: undefined,
          };
        }
        updated.push({
          role: "assistant",
          content: `Sorry, the action failed — ${error.message}`,
          timestamp: Date.now(),
        });
        return updated;
      });
    },
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, mutation.isPending, confirmMutation.isPending]);

  // Focus input when panel opens
  useEffect(() => {
    if (askAnnaOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [askAnnaOpen]);

  // ── Multimodal: photo attachment handling ──

  const handlePhotoSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset so re-selecting the SAME file re-fires onChange (replace flow).
      event.target.value = "";
      if (!file) return;
      setPhotoError(null);

      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setPhotoError("Unsupported image format — use JPEG, PNG or WebP.");
        return;
      }
      if (file.size < 1024) {
        setPhotoError("The image appears to be empty or corrupted — try re-taking the photo.");
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        setPhotoError("Image is too large — maximum 8 MB.");
        return;
      }

      // Replace any existing attachment (one photo per message).
      setAttachedPhoto((prev) => {
        if (prev) URL.revokeObjectURL(prev.previewUrl);
        return { file, previewUrl: URL.createObjectURL(file) };
      });
    },
    []
  );

  const removeAttachedPhoto = useCallback(() => {
    setAttachedPhoto((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    setPhotoError(null);
  }, []);

  // ── Multimodal: press-to-talk voice capture ──

  const teardownCapture = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    processorRef.current?.disconnect();
    processorRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close();
  }, []);

  const transcribeBlob = useCallback(
    async (blob: Blob, durationMs: number) => {
      if (blob.size < 1024) {
        setMicError("Recording too short — hold the button while speaking, then release.");
        return;
      }
      setIsTranscribing(true);
      setMicError(null);
      try {
        const form = new FormData();
        form.append("audio", blob, "recording.wav");
        form.append("durationMs", String(Math.round(durationMs)));
        const res = await fetch("/api/voice/transcribe", {
          method: "POST",
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Transcription failed");
        }
        const transcript = (data.transcript ?? "") as string;
        if (transcript.length === 0) {
          throw new Error("No speech detected");
        }
        // The transcript lands in the (editable) text input — the user
        // reviews/edits before sending. Typing remains fully available.
        setInput(transcript);
        setVoiceTranscriptPending(true);
        setLastInputWasVoice(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      } catch (err) {
        // Transcription failure → typing fallback with a clear reason.
        setMicError(
          err instanceof Error
            ? `${err.message}. You can type your message instead.`
            : "Transcription failed. You can type your message instead."
        );
        setTimeout(() => inputRef.current?.focus(), 50);
      } finally {
        setIsTranscribing(false);
      }
    },
    []
  );

  const stopRecordingAndTranscribe = useCallback(() => {
    if (!isRecording) return;
    const chunks = audioChunksRef.current;
    const sampleRate = audioContextRef.current?.sampleRate ?? 48000;
    const durationMs = Date.now() - recordingStartRef.current;
    teardownCapture();
    setIsRecording(false);
    setRecordingSeconds(0);

    const blob = encodeWav(chunks, sampleRate);
    void transcribeBlob(blob, durationMs);
  }, [isRecording, teardownCapture, transcribeBlob]);

  // Ref indirection so the auto-stop timer can call the latest stop handler.
  const stopRecordingRef = useRef<(() => void) | null>(null);
  stopRecordingRef.current = stopRecordingAndTranscribe;

  const startRecording = useCallback(async () => {
    if (isRecording || isTranscribing || mutation.isPending || confirmMutation.isPending) return;
    setMicError(null);
    setMicDenied(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicDenied(true);
      setMicError("Voice input isn't supported in this browser. Please type your message.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      // Permission denied / no microphone → typing fallback.
      setMicDenied(true);
      if (err instanceof DOMException && err.name === "NotFoundError") {
        setMicError("No microphone found on this device. Please type your message.");
      } else {
        setMicError("Microphone permission was denied. You can type your message instead.");
      }
      setTimeout(() => inputRef.current?.focus(), 50);
      return;
    }

    try {
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      // ScriptProcessorNode: deprecated but the only baseline-everywhere
      // synchronous capture path (AudioWorklet needs a separate module file
      // for marginal MVP gain).
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        // Copy the buffer — the AudioProcessingEvent reuses its memory.
        audioChunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      // ScriptProcessor requires a destination to run; connect through a
      // zero-gain node so nothing is audible.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      processor.connect(mute);
      mute.connect(ctx.destination);

      audioContextRef.current = ctx;
      streamRef.current = stream;
      sourceRef.current = source;
      processorRef.current = processor;
      audioChunksRef.current = [];
      autoStoppedRef.current = false;
      recordingStartRef.current = Date.now();
      setRecordingSeconds(0);
      setIsRecording(true);

      recordingTimerRef.current = setInterval(() => {
        const elapsed = (Date.now() - recordingStartRef.current) / 1000;
        setRecordingSeconds(Math.floor(elapsed));
        if (elapsed >= MAX_RECORDING_SECONDS && !autoStoppedRef.current) {
          autoStoppedRef.current = true; // auto-stop at the cap
          stopRecordingRef.current?.();
        }
      }, 250);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      teardownCapture();
      setMicError("Could not start recording. Please type your message instead.");
    }
  }, [isRecording, isTranscribing, mutation.isPending, confirmMutation.isPending, teardownCapture]);

  // Keyboard support for press-to-talk (space/enter hold on the mic button).
  const handleMicKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat && !isRecording) {
      e.preventDefault();
      void startRecording();
    }
  };
  const handleMicKeyUp = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      stopRecordingAndTranscribe();
    }
  };

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    const photo = attachedPhoto;
    if (
      (!trimmed && !photo) ||
      mutation.isPending ||
      confirmMutation.isPending ||
      isAnalyzingPhoto ||
      isRecording ||
      isTranscribing ||
      !selectedHouseholdId
    ) {
      return;
    }

    // Add user message (photo badge when attached)
    setMessages((prev) => [
      ...prev,
      {
        role: "user" as const,
        content: trimmed || "[Photo attached]",
        timestamp: Date.now(),
        photoAttached: !!photo,
        voiceInput: lastInputWasVoice && trimmed.length > 0,
      },
    ]);
    setInput("");
    setVoiceTranscriptPending(false);
    const wasVoice = lastInputWasVoice;
    setLastInputWasVoice(false);

    if (photo) {
      // Photo flow: authenticated analysis FIRST (server derives everything
      // from the session — client-supplied ids are ignored), then the normal
      // ask-anna call carries the signed analysis token.
      setIsAnalyzingPhoto(true);
      setPhotoError(null);
      (async () => {
        try {
          const form = new FormData();
          form.append("photo", photo.file, photo.file.name || "photo.jpg");
          const res = await fetch("/api/ask-anna/photo", {
            method: "POST",
            body: form,
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data.error || "Photo analysis failed");
          }
          mutation.mutate({
            msg: trimmed,
            photoToken: data.photoToken as string,
            inputModality: wasVoice && trimmed ? "voice" : "text",
          });
        } catch (err) {
          setPhotoError(
            err instanceof Error
              ? `${err.message}. You can remove the photo and send your text, or try again.`
              : "Photo analysis failed. You can remove the photo and send your text."
          );
        } finally {
          setIsAnalyzingPhoto(false);
          removeAttachedPhoto();
        }
      })();
    } else {
      mutation.mutate({
        msg: trimmed,
        inputModality: wasVoice ? "voice" : "text",
      });
    }
  }, [
    input,
    attachedPhoto,
    mutation,
    mutation.isPending,
    confirmMutation.isPending,
    isAnalyzingPhoto,
    isRecording,
    isTranscribing,
    selectedHouseholdId,
    lastInputWasVoice,
    removeAttachedPhoto,
  ]);

  const handleConfirm = useCallback(
    (originalMessage: string, confirmAction: PendingConfirmation) => {
      confirmMutation.mutate({
        originalMessage,
        confirmAction: {
          toolName: confirmAction.toolName,
          action: confirmAction.confirmationAction,
          chainId: confirmAction.chainId, // audit-chain correlation
        },
      });
    },
    [confirmMutation]
  );

  const handleDismiss = useCallback(() => {
    setMessages((prev) => {
      const updated = [...prev];
      const lastAssistant = updated.findLastIndex((m) => m.role === "assistant");
      if (lastAssistant >= 0) {
        updated[lastAssistant] = {
          ...updated[lastAssistant],
          pendingConfirmation: undefined,
        };
      }
      // Add a dismissal message
      updated.push({
        role: "assistant",
        content: "No problem, I've cancelled that action. Let me know if you need anything else!",
        timestamp: Date.now(),
      });
      return updated;
    });
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      {/* ── Floating Action Button (Speech Bubble) ── */}
      <AnimatePresence>
        {!askAnnaOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            onClick={() => setAskAnnaOpen(true)}
            className={cn(
              "fixed z-50 anna-fab-pulse",
              "bottom-20 right-4",
              "md:bottom-8 md:right-6"
            )}
            aria-label="Open Ask Anna"
          >
            <svg
              viewBox="0 0 64 72"
              width="56"
              height="63"
              className="drop-shadow-lg"
            >
              <path
                d="M32 4a28 28 0 0 1 28 28a28 28 0 0 1-28 28c-3.2 0-6.3-.5-9.2-1.5L14 68l2.8-12.3A27.9 27.9 0 0 1 4 32A28 28 0 0 1 32 4z"
                className="fill-[var(--anna-sage)] transition-colors group-hover:fill-[var(--anna-sage-dark)]"
              />
              <text
                x="32"
                y="36"
                textAnchor="middle"
                dominantBaseline="central"
                className="fill-white"
                style={{ fontSize: "16px", fontWeight: 700, fontFamily: "var(--font-manrope), system-ui, sans-serif", letterSpacing: "-0.02em" }}
              >
                A.I
              </text>
            </svg>
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Chat Panel ── */}
      <AnimatePresence>
        {askAnnaOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
            className={cn(
              "fixed z-50 bg-[var(--anna-white)] shadow-2xl flex flex-col overflow-hidden",
              "md:bottom-8 md:right-6 md:w-[380px] md:h-[520px] md:rounded-2xl md:border md:border-[var(--anna-border)]",
              "inset-0 md:inset-auto rounded-none md:rounded-2xl"
            )}
          >
            {/* ── Header ── */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--anna-border)] bg-[var(--anna-white)] flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-[var(--anna-sage)] flex items-center justify-center">
                  <span className="text-[10px] font-bold text-white tracking-tight">A.I</span>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--anna-slate)]">
                    Ask Anna
                  </h3>
                  <p className="text-[10px] text-[var(--anna-sage-dark)] font-medium">
                    Your household, understood
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-full hover:bg-[var(--anna-sage-light)]"
                onClick={() => setAskAnnaOpen(false)}
                aria-label="Close chat"
              >
                <X size={16} className="text-[var(--anna-slate-light)]" />
              </Button>
            </div>

            {/* ── Messages Area ── */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto anna-scroll px-0"
            >
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full px-6 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-[var(--anna-sage-light)] flex items-center justify-center mb-4">
                    <svg viewBox="0 0 64 72" width="28" height="32">
                      <path
                        d="M32 4a28 28 0 0 1 28 28a28 28 0 0 1-28 28c-3.2 0-6.3-.5-9.2-1.5L14 68l2.8-12.3A27.9 27.9 0 0 1 4 32A28 28 0 0 1 32 4z"
                        className="fill-[var(--anna-sage-dark)]"
                      />
                    </svg>
                  </div>
                  <p className="text-sm font-semibold text-[var(--anna-slate)] mb-1">
                    Hi, I&apos;m Anna
                  </p>
                  <p className="text-xs text-[var(--anna-muted)] leading-relaxed max-w-[260px] mb-5">
                    I can help manage your household — book services, check status, track spending, and more.
                  </p>
                  {/* Quick-suggestion chips */}
                  <div className="flex flex-col gap-2 w-full max-w-[280px]">
                    {SUGGESTION_CHIPS.map((chip) => {
                      const Icon = chip.icon;
                      return (
                        <button
                          key={chip.label}
                          onClick={() => {
                            setInput(chip.prompt);
                            setTimeout(() => inputRef.current?.focus(), 50);
                          }}
                          className="text-left px-3.5 py-2.5 rounded-xl border border-[var(--anna-border)] bg-[var(--anna-white)] hover:bg-[var(--anna-sage-light)] hover:border-[var(--anna-sage)] transition-all duration-150 group flex items-center gap-2.5"
                        >
                          <Icon
                            size={14}
                            className="text-[var(--anna-muted)] group-hover:text-[var(--anna-sage-dark)] flex-shrink-0"
                          />
                          <p className="text-xs font-medium text-[var(--anna-slate)] group-hover:text-[var(--anna-sage-dark)]">
                            {chip.label}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 py-4">
                  {/* AI unavailable banner */}
                  {aiUnavailable && (
                    <div className="mx-4 mt-1 mb-2 bg-[var(--anna-warning)]/10 border border-[var(--anna-warning)]/20 rounded-xl p-3 flex items-start gap-2">
                      <AlertCircle size={14} className="text-[var(--anna-warning)] flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-medium text-[var(--anna-warning)]">
                          AI Assistant Offline
                        </p>
                        <p className="text-[10px] text-[var(--anna-muted)] mt-0.5 leading-relaxed">
                          The AI engine isn't configured on this server. Ask your administrator to set up AI environment variables.
                        </p>
                      </div>
                    </div>
                  )}
                  {messages.map((msg, i) => (
                    <div key={i}>
                      {/* Message bubble */}
                      <div
                        className={cn(
                          "flex items-start gap-2.5 px-4",
                          msg.role === "user" ? "flex-row-reverse" : ""
                        )}
                      >
                        {/* Avatar */}
                        {msg.role === "assistant" && (
                          <div className="w-7 h-7 rounded-full bg-[var(--anna-sage)] flex items-center justify-center flex-shrink-0 mt-0.5">
                            <span className="text-[8px] font-bold text-white tracking-tight">
                              A.I
                            </span>
                          </div>
                        )}

                        {/* Bubble */}
                        <div
                          className={cn(
                            "max-w-[280px] px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
                            msg.role === "user"
                              ? "bg-[var(--anna-sage)] text-white rounded-2xl rounded-tr-md"
                              : "bg-[var(--anna-bg)] text-[var(--anna-slate)] rounded-2xl rounded-tl-md border border-[var(--anna-border)]"
                          )}
                        >
                          {(msg.photoAttached || msg.voiceInput) && (
                            <div className="flex items-center gap-2 mb-1.5 pb-1.5 border-b border-white/20">
                              {msg.photoAttached && (
                                <span
                                  className="flex items-center gap-1 text-[10px] font-medium"
                                  title="A photo was attached to this message"
                                >
                                  <ImageIcon size={11} aria-hidden /> Photo
                                </span>
                              )}
                              {msg.voiceInput && (
                                <span
                                  className="flex items-center gap-1 text-[10px] font-medium"
                                  title="This message started as a voice transcript"
                                >
                                  <Mic size={11} aria-hidden /> Voice
                                </span>
                              )}
                            </div>
                          )}
                          {msg.content}
                        </div>
                      </div>

                      {/* Confirmation card (below this assistant message) */}
                      {msg.pendingConfirmation && (
                        <ConfirmationCard
                          message={msg.pendingConfirmation.confirmationMessage}
                          onConfirm={() => {
                            // Find the user message that preceded this assistant message
                            const userMsg = messages
                              .slice(0, i)
                              .reverse()
                              .find((m) => m.role === "user");
                            handleConfirm(
                              userMsg?.content || "",
                              msg.pendingConfirmation
                            );
                          }}
                          onDismiss={handleDismiss}
                          isPending={confirmMutation.isPending}
                        />
                      )}

                      {/* Action result card */}
                      {msg.actionResult && !msg.pendingConfirmation && (
                        <ResultCard
                          success={msg.actionResult.success}
                          toolName={msg.actionResult.toolName}
                          data={msg.actionResult.data}
                        />
                      )}
                    </div>
                  ))}

                  {/* Typing indicator */}
                  {(mutation.isPending || confirmMutation.isPending || isAnalyzingPhoto) && (
                    <TypingIndicator />
                  )}

                  {/* Error state inline */}
                  {(mutation.isError || confirmMutation.isError) &&
                    messages[messages.length - 1]?.role !== "assistant" && (
                      <div className="flex items-start gap-2.5 px-4">
                        <div className="w-7 h-7 rounded-full bg-[var(--anna-error)]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <AlertCircle
                            size={14}
                            className="text-[var(--anna-error)]"
                          />
                        </div>
                        <div className="bg-[var(--anna-error)]/5 border border-[var(--anna-error)]/20 rounded-2xl rounded-tl-md px-4 py-2.5 text-sm text-[var(--anna-error)]">
                          Something went wrong. Please try again.
                        </div>
                      </div>
                    )}
                </div>
              )}
            </div>

            {/* ── Input Bar (Multimodal: [Photo] [Mic] [Text] [Send]) ── */}
            <div className="flex-shrink-0 border-t border-[var(--anna-border)] px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-[var(--anna-white)]">
              {!selectedHouseholdId ? (
                <p className="text-xs text-[var(--anna-muted)] text-center py-1.5">
                  Select a household first
                </p>
              ) : (
                <div className="space-y-2">
                  {/* ── Recording indicator (press-to-talk active) ── */}
                  {isRecording && (
                    <div
                      className="flex items-center gap-2 rounded-xl border border-[var(--anna-error)]/30 bg-[var(--anna-error)]/5 px-3 py-2"
                      role="status"
                      aria-live="polite"
                    >
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--anna-error)] opacity-60" />
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--anna-error)]" />
                      </span>
                      <span className="text-xs font-medium text-[var(--anna-error)]">
                        Recording · {String(Math.floor(recordingSeconds / 60))}:
                        {String(recordingSeconds % 60).padStart(2, "0")} / 1:00
                      </span>
                      <span className="text-[10px] text-[var(--anna-muted)] ml-auto">
                        Release to send · auto-stops at 1:00
                      </span>
                    </div>
                  )}

                  {/* ── Transcribing state ── */}
                  {isTranscribing && (
                    <div
                      className="flex items-center gap-2 rounded-xl border border-[var(--anna-sage)]/30 bg-[var(--anna-sage-light)]/50 px-3 py-2"
                      role="status"
                      aria-live="polite"
                    >
                      <Loader2 size={14} className="animate-spin text-[var(--anna-sage-dark)]" />
                      <span className="text-xs font-medium text-[var(--anna-sage-dark)]">
                        Transcribing your voice…
                      </span>
                    </div>
                  )}

                  {/* ── Photo analysis state ── */}
                  {isAnalyzingPhoto && (
                    <div
                      className="flex items-center gap-2 rounded-xl border border-[var(--anna-sage)]/30 bg-[var(--anna-sage-light)]/50 px-3 py-2"
                      role="status"
                      aria-live="polite"
                    >
                      <Loader2 size={14} className="animate-spin text-[var(--anna-sage-dark)]" />
                      <span className="text-xs font-medium text-[var(--anna-sage-dark)]">
                        Analyzing your photo…
                      </span>
                    </div>
                  )}

                  {/* ── Photo attachment preview ── */}
                  {attachedPhoto && (
                    <div className="flex items-center gap-3 rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)] px-3 py-2">
                      {/* Local object-URL preview (not a Next/Image asset —
                          the image is never persisted server-side). */}
                      <img
                        src={attachedPhoto.previewUrl}
                        alt="Photo to send — preview"
                        className="h-16 w-16 flex-shrink-0 rounded-lg object-cover border border-[var(--anna-border)]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold text-[var(--anna-slate)]">
                          Photo attached
                        </p>
                        <p className="truncate text-[10px] text-[var(--anna-muted)]">
                          {attachedPhoto.file.name || "photo"} · (
                          {(attachedPhoto.file.size / 1024 / 1024).toFixed(1)} MB)
                        </p>
                        <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">
                          Send with your message, or tap the camera to replace.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={removeAttachedPhoto}
                        aria-label="Remove attached photo"
                        className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-[var(--anna-muted)] hover:bg-[var(--anna-sage-light)] hover:text-[var(--anna-slate)]"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  {/* ── Voice transcript hint (editable in the input below) ── */}
                  {voiceTranscriptPending && !isTranscribing && (
                    <div className="flex items-center gap-2 px-1">
                      <Mic size={12} className="text-[var(--anna-sage-dark)]" />
                      <span className="text-[10px] text-[var(--anna-muted)]">
                        Voice transcript above — edit it if needed before sending.
                      </span>
                    </div>
                  )}

                  {/* ── Inline errors (photo / mic) — typing stays available ── */}
                  {photoError && (
                    <div className="flex items-start gap-2 rounded-xl border border-[var(--anna-error)]/20 bg-[var(--anna-error)]/5 px-3 py-2">
                      <AlertCircle size={13} className="mt-0.5 flex-shrink-0 text-[var(--anna-error)]" />
                      <span className="text-[11px] leading-relaxed text-[var(--anna-error)]">
                        {photoError}
                      </span>
                    </div>
                  )}
                  {micError && (
                    <div className="flex items-start gap-2 rounded-xl border border-[var(--anna-error)]/20 bg-[var(--anna-error)]/5 px-3 py-2">
                      <AlertCircle size={13} className="mt-0.5 flex-shrink-0 text-[var(--anna-error)]" />
                      <span className="text-[11px] leading-relaxed text-[var(--anna-error)]">
                        {micError}
                      </span>
                    </div>
                  )}
                  {micDenied && !micError && (
                    <div className="px-1 text-[10px] text-[var(--anna-muted)]">
                      Microphone unavailable — you can still type your message.
                    </div>
                  )}

                  {/* Hidden file inputs: camera capture + library chooser */}
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    className="hidden"
                    onChange={handlePhotoSelect}
                    aria-hidden
                    tabIndex={-1}
                  />
                  <input
                    ref={libraryInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handlePhotoSelect}
                    aria-hidden
                    tabIndex={-1}
                  />

                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSend();
                    }}
                    className="flex items-center gap-2"
                  >
                    {/* Photo button — tap for take/choose menu */}
                    <div className="relative flex-shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        onPointerDown={(e) => {
                          // Prevent the form from submitting on tap.
                          e.preventDefault();
                        }}
                        onClick={() => setPhotoMenuOpen((v) => !v)}
                        disabled={mutation.isPending || confirmMutation.isPending || isAnalyzingPhoto || isRecording}
                        className="h-11 w-11 rounded-xl p-0 text-[var(--anna-muted)] hover:text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)] disabled:opacity-40"
                        aria-label="Attach a photo — take or choose"
                        aria-expanded={photoMenuOpen}
                        aria-haspopup="menu"
                      >
                        <Camera size={18} />
                      </Button>
                      {photoMenuOpen && (
                        <div
                          role="menu"
                          aria-label="Photo source"
                          className="absolute bottom-12 left-0 z-10 w-40 overflow-hidden rounded-xl border border-[var(--anna-border)] bg-[var(--anna-white)] shadow-lg"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-[var(--anna-slate)] hover:bg-[var(--anna-sage-light)]"
                            onClick={() => {
                              setPhotoMenuOpen(false);
                              cameraInputRef.current?.click();
                            }}
                          >
                            <Camera size={14} className="text-[var(--anna-muted)]" />
                            Take photo
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 border-t border-[var(--anna-border)] px-3 py-2.5 text-left text-xs font-medium text-[var(--anna-slate)] hover:bg-[var(--anna-sage-light)]"
                            onClick={() => {
                              setPhotoMenuOpen(false);
                              libraryInputRef.current?.click();
                            }}
                          >
                            <ImageIcon size={14} className="text-[var(--anna-muted)]" />
                            Choose photo
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Mic button — press and hold to talk */}
                    <Button
                      type="button"
                      variant="ghost"
                      onPointerDown={(e) => {
                        e.preventDefault();
                        if (!isRecording) void startRecording();
                      }}
                      onPointerUp={(e) => {
                        e.preventDefault();
                        if (isRecording) stopRecordingAndTranscribe();
                      }}
                      onPointerLeave={() => {
                        // Finger slid off — treat as release (send what was said).
                        if (isRecording) stopRecordingAndTranscribe();
                      }}
                      onKeyDown={handleMicKeyDown}
                      onKeyUp={handleMicKeyUp}
                      disabled={
                        (micDenied && !isRecording) ||
                        mutation.isPending ||
                        confirmMutation.isPending ||
                        isAnalyzingPhoto ||
                        isTranscribing
                      }
                      className={cn(
                        "h-11 w-11 flex-shrink-0 rounded-xl p-0 disabled:opacity-40",
                        isRecording
                          ? "bg-[var(--anna-error)] text-white hover:bg-[var(--anna-error)] anna-fab-pulse"
                          : "text-[var(--anna-muted)] hover:text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)]"
                      )}
                      aria-label={
                        isRecording
                          ? "Stop recording and transcribe"
                          : "Hold to record a voice message"
                      }
                      aria-pressed={isRecording}
                    >
                      {isRecording ? (
                        <Square size={16} fill="currentColor" />
                      ) : isTranscribing ? (
                        <Loader2 size={18} className="animate-spin" />
                      ) : (
                        <Mic size={18} />
                      )}
                    </Button>

                    <Input
                      ref={inputRef}
                      value={input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        if (voiceTranscriptPending) setVoiceTranscriptPending(false);
                      }}
                      onKeyDown={handleKeyDown}
                      placeholder={
                        isRecording
                          ? "Listening… release the mic to transcribe"
                          : "Type, speak, or attach a photo…"
                      }
                      disabled={
                        mutation.isPending ||
                        confirmMutation.isPending ||
                        isRecording ||
                        isTranscribing
                      }
                      className="flex-1 h-11 text-sm border-[var(--anna-border)] bg-[var(--anna-bg)] rounded-xl px-3 focus-visible:ring-[var(--anna-sage)] focus-visible:ring-offset-0 placeholder:text-[var(--anna-muted)] disabled:opacity-60"
                      aria-label="Message to Anna — editable voice transcripts appear here"
                    />
                    <Button
                      type="submit"
                      size="icon"
                      disabled={
                        (!input.trim() && !attachedPhoto) ||
                        mutation.isPending ||
                        confirmMutation.isPending ||
                        isAnalyzingPhoto ||
                        isRecording ||
                        isTranscribing
                      }
                      className="h-11 w-11 rounded-xl bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white disabled:opacity-40 flex-shrink-0"
                      aria-label="Send message"
                    >
                      <Send size={16} />
                    </Button>
                  </form>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
