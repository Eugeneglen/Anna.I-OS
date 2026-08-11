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
// ============================================================

import ZAI from "z-ai-web-dev-sdk";
import fs from "fs";
import path from "path";

let _zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;
let _initAttempted = false;
let _initError: string | null = null;

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

    _zai = await ZAI.create();
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
