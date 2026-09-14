import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getOpsSession, hasMinRole } from "@/lib/ops-auth";
import { processPendingNotifications } from "@/lib/notify/delivery";
import { checkRateLimit } from "@/lib/rate-limit";

// POST /api/ops/notifications/dispatch
//
// ── FIX-1d: cron-driven notification delivery sweep ──
//
// Called by the ops-events mini-service cron (60 s tick) so PENDING
// notifications are actually DELIVERED (status PENDING → SENT +
// deliveredAt/deliveredVia) instead of accumulating forever — the
// audit finding "notification dispatch mechanism is pure DB theater".
// Runs the same engine code (processPendingNotifications) for every
// channel through the active DeliveryChannel adapter — see
// src/lib/notify/delivery.ts (log adapter today; external email/SMS/
// WhatsApp adapters are pending a provider decision).
//
// Authentication (mirrors /api/ops/marketing/dispatch-expiry — the
// established police-1c hardened posture — PLUS an ops-session path
// so ops staff can also trigger the sweep manually from the CMS):
//   • header `x-cron-secret` only (no query-param fallback — secrets in
//     URLs leak via logs/referrers)
//   • timing-safe comparison
//   • PROD with unset CRON_SECRET → cron path is CLOSED (ops session
//     still works); the dev fallback secret exists only outside
//     production.
//   • rate-limited (6/min) so a leaked secret cannot hammer the sweep
//
// Idempotent by construction: rows already SENT/READ/FAILED are never
// selected, and each row update is guarded by status: PENDING —
// repeated calls are no-ops when there is nothing to deliver.

const DEV_FALLBACK_SECRET = "anna-cron-dev-secret";

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still do a comparison to keep timing roughly constant.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function resolveSecret(): string | null {
  const s = process.env.CRON_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[notifications-dispatch] CRON_SECRET is not set — cron path CLOSED (401) until it is configured."
    );
    return null;
  }
  console.warn(
    "[notifications-dispatch] CRON_SECRET not set — using dev fallback secret. Do NOT ship this to production."
  );
  return DEV_FALLBACK_SECRET;
}

export async function POST(req: NextRequest) {
  try {
    // ── Auth: cron secret OR ops session ──
    const provided = req.headers.get("x-cron-secret") ?? "";
    let cronAuthed = false;
    if (provided) {
      const expected = resolveSecret();
      if (expected && secretsMatch(provided, expected)) {
        cronAuthed = true;
      }
    }

    let opsUserId: string | undefined;
    if (!cronAuthed) {
      const session = await getOpsSession();
      if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      // ── P9A-F05 (Phase 9, Section A) ──
      // The ops path was session-only: ANY ops session (incl. the lowest
      // data-analyst role) could trigger the global dispatch sweep. Global
      // operational side-effects now require Coordinator tier — mirrors
      // /api/ops/events/push. The cron-secret path is unchanged.
      if (!hasMinRole(session.role, "COORDINATOR")) {
        return NextResponse.json(
          { error: "Forbidden — global notification dispatch requires Coordinator tier" },
          { status: 403 }
        );
      }
      opsUserId = session.userId;
    }

    // 6 calls/min is far above the 60s tick rate — anything faster is abuse.
    const rlKey = cronAuthed
      ? "cron:notifications-dispatch"
      : `ops:${opsUserId ?? "anon"}:notifications-dispatch`;
    if (!checkRateLimit(rlKey, 6, 60_000)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const result = await processPendingNotifications();

    // Always return the full shape { processed, sent, failed, skipped }
    // (the ops-events cron logs it; 0/0/0/0 means "nothing pending").
    return NextResponse.json(result);
  } catch (error) {
    console.error("[/api/ops/notifications/dispatch POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
