// ============================================================
// Anna.I — Shared z-ai-web-dev-sdk wrapper
// ============================================================
// Centralizes SDK initialization with proper error handling.
//
// Config discovery order:
//   1. Existing .z-ai-config on disk (written by entrypoint.sh)
//   2. Environment variables Z_AI_BASE_URL + Z_AI_API_KEY
//      → auto-writes .z-ai-config to cwd so the SDK can find it
//
// If neither is available, AI features gracefully degrade —
// getZAI() returns null instead of throwing.
//
// ─────────────────────────────────────────────────────────────
// AUTH-4 (three-layer test architecture) — provider resilience
// + deterministic LLM stub seam:
//
//   1. RESILIENCE: every SDK call through this module is bounded
//      by a timeout (ZAI_TIMEOUT_MS, default 60s) and retried a
//      bounded number of times (ZAI_RETRY_MAX, default 2 extra
//      attempts) with exponential backoff on TRANSIENT provider
//      failures only (429 / 5xx / network / timeout). The retry
//      wraps ONLY the model call — tool execution happens in the
//      routes ABOVE this seam, so a retry can never re-execute a
//      tool or duplicate a write.
//
//   2. STUB SEAM (test-only): when the control file
//      ${ANNA_LLM_STUB_DIR}/ACTIVE exists and NODE_ENV is not
//      "production", chat / vision / ASR calls are served from a
//      scripted JSON queue (${STUB_DIR}/script.json) instead of
//      the live provider. Scripted provider errors flow through
//      the SAME retry policy as live errors, so 429/500/timeout
//      behaviour is testable deterministically with ZERO live
//      calls (Layer 2 of the test strategy). Every stubbed
//      attempt is appended to ${STUB_DIR}/calls.jsonl for
//      no-duplicate-execution assertions. An under-scripted test
//      fails LOUDLY ("script exhausted") — it can never fake a
//      pass. Never active in production; logs loudly when serving.
//
// Env knobs (all optional): ANNA_LLM_STUB_DIR, ZAI_RETRY_MAX,
// ZAI_RETRY_BASE_MS, ZAI_TIMEOUT_MS.
// ============================================================

import ZAI from "z-ai-web-dev-sdk";
import fs from "fs";
import path from "path";

let _zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;
let _initAttempted = false;
let _initError: string | null = null;

// ─────────────────────────────────────────────────────────────
// Provider resilience + deterministic stub seam (AUTH-4)
// ─────────────────────────────────────────────────────────────

/** Exact fallback sentence for provider-unavailable chat turns.
 *  Routes return this (HTTP 200, degraded:true) instead of a raw
 *  500 — Anna never guesses when she cannot reach the provider. */
export const PROVIDER_UNAVAILABLE_MESSAGE =
  "I can't access the current service information right now.";

export type ProviderErrorKind =
  | "rate_limit"
  | "server"
  | "timeout"
  | "network"
  | "client"
  | "stub_exhausted"
  | "unknown";

/** Error thrown for scripted stub failures (and used to normalise
 *  classification). `retryable` drives the bounded retry policy. */
export class ProviderError extends Error {
  kind: ProviderErrorKind;
  status?: number;
  retryAfterMs?: number;
  constructor(kind: ProviderErrorKind, message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

interface ErrorClass {
  kind: ProviderErrorKind;
  retryable: boolean;
}

function errorStatus(err: unknown): number | undefined {
  const any = err as { status?: number; statusCode?: number; response?: { status?: number } } | null;
  if (!any) return undefined;
  return any.status ?? any.statusCode ?? any.response?.status;
}

function classifyProviderError(err: unknown): ErrorClass {
  if (err instanceof ProviderError) {
    const retryable =
      err.kind === "rate_limit" || err.kind === "server" || err.kind === "timeout" || err.kind === "network";
    return { kind: err.kind, retryable };
  }
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const status = errorStatus(err);
  if (status === 429 || /429|too many requests|rate.?limit/i.test(msg)) {
    return { kind: "rate_limit", retryable: true };
  }
  if (/timeout|timed\s*out|timedout|etimedout|abort/i.test(msg)) {
    return { kind: "timeout", retryable: true };
  }
  if (
    /econnreset|econnrefused|enotfound|ehostunreach|enetunreach|fetch failed|network|socket hang up|epipe/i.test(msg)
  ) {
    return { kind: "network", retryable: true };
  }
  if (status !== undefined && status >= 500 && status < 600) {
    return { kind: "server", retryable: true };
  }
  if (/(^|\D)5\d{2}(\D|$)|internal server|bad gateway|service unavailable|gateway timeout|server error/i.test(msg)) {
    return { kind: "server", retryable: true };
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return { kind: "client", retryable: false };
  }
  return { kind: "unknown", retryable: false };
}

/** True when an error means the MODEL PROVIDER is unavailable or
 *  transiently failing (NOT application bugs like DB errors) — the
 *  signal routes use to degrade gracefully instead of 500ing. */
export function isProviderError(err: unknown): boolean {
  const cls = classifyProviderError(err);
  return cls.retryable || cls.kind === "stub_exhausted";
}

function envInt(name: string, def: number): number {
  const raw = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : def;
}

const STUB_DIR = process.env.ANNA_LLM_STUB_DIR || "/tmp/anna-llm-stub";

function stubActive(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  try {
    return fs.existsSync(path.join(STUB_DIR, "ACTIVE"));
  } catch {
    return false;
  }
}

interface StubErrorSpec {
  kind: string;
  message?: string;
  status?: number;
  retryAfterMs?: number;
}
type StubStep =
  | { assistantText: string }
  | { response: unknown }
  | { empty: true }
  | { error: StubErrorSpec };

function readStubJson(rel: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(STUB_DIR, rel), "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stubErrorFromSpec(spec: StubErrorSpec): ProviderError {
  const kind = String(spec.kind).toLowerCase();
  let mapped: ProviderErrorKind = "server";
  let status: number | undefined = spec.status;
  switch (kind) {
    case "429":
    case "rate_limit":
    case "ratelimit":
      mapped = "rate_limit";
      status = status ?? 429;
      break;
    case "timeout":
    case "timed_out":
      mapped = "timeout";
      break;
    case "network":
    case "unavailable":
    case "unreachable":
      mapped = "network";
      break;
    case "500":
    case "5xx":
    case "server":
      mapped = "server";
      status = status ?? 500;
      break;
    default:
      mapped = "server";
  }
  return new ProviderError(
    mapped,
    spec.message ?? `[llm-stub] scripted provider failure (${mapped})`,
    status,
    spec.retryAfterMs
  );
}

/** Consume the next scripted step. One step per ATTEMPT, so a
 *  scripted 429 followed by a scripted success proves the retry
 *  policy exactly like a live transient would. */
function nextStubStep(fnName: string): unknown {
  const script = readStubJson("script.json");
  const steps = (Array.isArray(script?.steps) ? script?.steps : []) as unknown[] | undefined;
  const list = steps ?? [];
  const cursor = readStubJson("cursor.json");
  const n = typeof cursor?.n === "number" ? (cursor as { n: number }).n : 0;
  if (n >= list.length) {
    // Under-scripted test → fail loudly. A stub must NEVER invent a
    // plausible response: that would silently fake a green test.
    throw new ProviderError(
      "stub_exhausted",
      `[llm-stub] ${fnName}: script exhausted (${list.length} step(s), cursor=${n}) — the test under-scripted this call and FAILED loudly`
    );
  }
  try {
    fs.writeFileSync(path.join(STUB_DIR, "cursor.json"), JSON.stringify({ n: n + 1 }));
  } catch {
    // cursor persistence is best-effort; single-process tests make
    // this a no-op failure
  }
  const step = list[n] as StubStep;
  if ("error" in (step ?? {})) {
    throw stubErrorFromSpec((step as { error: StubErrorSpec }).error);
  }
  if (step && "response" in (step as object)) {
    return (step as { response: unknown }).response;
  }
  if (step && "assistantText" in (step as object)) {
    return {
      choices: [
        {
          message: {
            role: "assistant",
            content: (step as { assistantText: string }).assistantText,
          },
        },
      ],
    };
  }
  if (step && "empty" in (step as object)) {
    return { choices: [{ message: { role: "assistant", content: "" } }] };
  }
  throw new ProviderError("stub_exhausted", `[llm-stub] ${fnName}: invalid step at index ${n}`);
}

function logGatewayAttempt(
  fnName: string,
  attempt: number,
  outcome: string,
  latencyMs: number,
  stub: boolean
) {
  const line = `[zai] ${fnName} attempt ${attempt} → ${outcome} in ${latencyMs}ms${stub ? " (llm-stub)" : ""}`;
  if (outcome === "ok") console.log(line);
  else console.warn(line);
  if (stub) {
    try {
      fs.appendFileSync(
        path.join(STUB_DIR, "calls.jsonl"),
        JSON.stringify({
          ts: new Date().toISOString(),
          fn: fnName,
          attempt,
          outcome,
          latencyMs,
        }) + "\n"
      );
    } catch {
      // call-log persistence is best-effort
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Bounded-timeout + bounded-retry wrapper shared by LIVE calls and
 *  STUBBED calls (scripted errors ride the same policy). Retrying
 *  here re-issues ONLY the model call — never a tool. */
async function withResilience<T>(fnName: string, op: () => Promise<T>): Promise<T> {
  const maxRetries = envInt("ZAI_RETRY_MAX", 2);
  const baseMs = envInt("ZAI_RETRY_BASE_MS", 600);
  const timeoutMs = envInt("ZAI_TIMEOUT_MS", 60_000);
  let attempt = 0;
  for (;;) {
    attempt++;
    const startedAt = Date.now();
    const stub = stubActive();
    let timeoutFired = false;
    try {
      const result = await Promise.race([
        op(),
        new Promise<never>((_, reject) => {
          const t: ReturnType<typeof setTimeout> = setTimeout(() => {
            timeoutFired = true;
            reject(new ProviderError("timeout", `${fnName} exceeded ${timeoutMs}ms`));
          }, timeoutMs);
          // Node/Bun: don't hold the event loop open for the loser
          (t as { unref?: () => void }).unref?.();
        }),
      ]);
      logGatewayAttempt(fnName, attempt, "ok", Date.now() - startedAt, stub);
      return result;
    } catch (err) {
      const cls = classifyProviderError(err);
      logGatewayAttempt(fnName, attempt, cls.kind, Date.now() - startedAt, stub);
      if (timeoutFired && !(err instanceof ProviderError)) {
        err = new ProviderError("timeout", err instanceof Error ? err.message : String(err));
      }
      if (cls.retryable && attempt <= maxRetries) {
        const retryAfter =
          err instanceof ProviderError && typeof err.retryAfterMs === "number"
            ? err.retryAfterMs
            : undefined;
        const delay =
          retryAfter ?? baseMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
        console.warn(
          `[zai] ${fnName} transient ${cls.kind} (attempt ${attempt}/${maxRetries + 1}) — retrying in ${delay}ms`
        );
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
}

type AnyRecord = Record<string, unknown>;

/** Wrap one SDK method with stub + resilience. */
function wrapSdkMethod(owner: AnyRecord | null | undefined, key: string, fnName: string) {
  const real: ((params: unknown) => Promise<unknown>) | undefined =
    owner && typeof (owner as AnyRecord)[key] === "function"
      ? (owner as unknown as { [k: string]: (p: unknown) => Promise<unknown> })[key].bind(owner)
      : undefined;
  return async (params: unknown): Promise<unknown> => {
    if (stubActive()) {
      return withResilience(fnName, () => Promise.resolve(nextStubStep(fnName)));
    }
    if (!real) {
      throw new ProviderError("unknown", `[zai] ${fnName} is not available on this SDK instance`);
    }
    return withResilience(fnName, () => real(params));
  };
}

/** Install the gateway on the SDK instance. Passes through everything
 *  except chat.completions.create / createVision and audio.asr.create. */
function withGateway(sdk: Awaited<ReturnType<typeof ZAI.create>>): Awaited<ReturnType<typeof ZAI.create>> {
  const anySdk = sdk as unknown as { chat?: AnyRecord; audio?: AnyRecord };
  const chat = anySdk.chat;
  const audio = anySdk.audio;
  if (!chat) return sdk;

  const realCompletions = (chat as AnyRecord).completions as AnyRecord | undefined;
  if (!realCompletions) return sdk;

  const completionsProxy = new Proxy(realCompletions, {
    get(t, prop) {
      if (prop === "create") return wrapSdkMethod(t as AnyRecord, "create", "chat.completions.create");
      if (prop === "createVision")
        return wrapSdkMethod(t as AnyRecord, "createVision", "chat.completions.createVision");
      const v = (t as AnyRecord)[prop as string];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  }) as unknown as AnyRecord;

  const chatProxy = new Proxy(chat, {
    get(t, prop) {
      if (prop === "completions") return completionsProxy;
      const v = (t as AnyRecord)[prop as string];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  }) as unknown as AnyRecord;

  let audioProxy: AnyRecord | null = null;
  if (audio) {
    const realAsr = (audio as AnyRecord).asr as AnyRecord | undefined;
    if (realAsr) {
      const asrProxy = new Proxy(realAsr, {
        get(t, prop) {
          if (prop === "create") return wrapSdkMethod(t as AnyRecord, "create", "audio.asr.create");
          const v = (t as AnyRecord)[prop as string];
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
        },
      }) as unknown as AnyRecord;
      audioProxy = new Proxy(audio, {
        get(t, prop) {
          if (prop === "asr") return asrProxy;
          const v = (t as AnyRecord)[prop as string];
          return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
        },
      }) as unknown as AnyRecord;
    }
  }

  return new Proxy(sdk as object, {
    get(t, prop) {
      if (prop === "chat") return chatProxy;
      if (prop === "audio" && audioProxy) return audioProxy;
      const v = (t as AnyRecord)[prop as string];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  }) as Awaited<ReturnType<typeof ZAI.create>>;
}

// ─────────────────────────────────────────────────────────────
// Original config/init code (unchanged behaviour)
// ─────────────────────────────────────────────────────────────

/**
 * Try to write a .z-ai-config file from environment variables.
 * The SDK only reads from disk, so we must write the file for it.
 * Tries cwd first (1st SDK priority), then /etc/ as fallback.
 * Returns true if a config was successfully written.
 */
function ensureConfigFromEnv(): boolean {
  const baseUrl = process.env.Z_AI_BASE_URL;
  const apiKey = process.env.Z_AI_API_KEY;

  if (!baseUrl || !apiKey) {
    console.warn(
      "[zai] Z_AI_BASE_URL and/or Z_AI_API_KEY not set — cannot auto-create config"
    );
    return false;
  }

  const config: Record<string, string> = { baseUrl, apiKey };
  if (process.env.Z_AI_CHAT_ID) config.chatId = process.env.Z_AI_CHAT_ID;
  if (process.env.Z_AI_USER_ID) config.userId = process.env.Z_AI_USER_ID;
  if (process.env.Z_AI_TOKEN) config.token = process.env.Z_AI_TOKEN;

  const json = JSON.stringify(config);

  // Write to cwd first (SDK checks this path 1st)
  const cwdPath = path.join(process.cwd(), ".z-ai-config");
  try {
    fs.writeFileSync(cwdPath, json, { mode: 0o600 });
    console.log("[zai] Config auto-written from env vars →", cwdPath);
    return true;
  } catch (err) {
    console.warn("[zai] Failed to write config to cwd:", err);
  }

  // Fallback: /etc/.z-ai-config
  try {
    fs.writeFileSync("/etc/.z-ai-config", json, { mode: 0o600 });
    console.log("[zai] Config auto-written from env vars → /etc/.z-ai-config");
    return true;
  } catch (err) {
    console.warn("[zai] Failed to write config to /etc/:", err);
  }

  return false;
}

/**
 * Get or create the ZAI SDK instance.
 * Returns null if the SDK is not configured (graceful degradation).
 * Caches the instance after first successful creation.
 */
export async function getZAI() {
  if (_zai) return _zai;
  if (_initError) return null;

  try {
    // If no config file exists yet, try to create one from env vars
    ensureConfigFromEnv();

    _zai = withGateway(await ZAI.create());
    _initAttempted = true;
    return _zai;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    _initAttempted = true;
    _initError = msg;
    console.warn("[zai] SDK not configured — AI features disabled:", msg);
    return null;
  }
}

/**
 * Check if AI features are available (SDK configured).
 * Returns true if the SDK is ready, false if not configured.
 */
export function isAIReady(): boolean {
  return _zai !== null;
}

/**
 * Check if AI was attempted but failed (config missing).
 */
export function isAIDisabled(): boolean {
  return _initAttempted && _zai === null;
}
