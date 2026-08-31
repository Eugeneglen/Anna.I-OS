import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { runExpirySweep } from "@/lib/marketing/voucher-engine";
import { invalidateBehaviourCache, invalidateAllCampaignPerfCaches } from "@/lib/cache";
import { checkRateLimit } from "@/lib/rate-limit";

// POST /api/ops/marketing/dispatch-expiry
//
// ── F20: cron-driven voucher expiry lifecycle pass ──
//
// Called by the ops-events mini-service cron (60 s tick) so vouchers
// auto-expire and households get expiry reminders WITHOUT any browser tab
// open or a manual ops trigger. Runs the exact same engine code as the
// ops-manual /api/ops/marketing/expire-vouchers route (runExpirySweep).
//
// Authentication mirrors /api/ops/marketing/dispatch-issuance exactly
// (police-1c hardened posture):
//   • header `x-cron-secret` only (no query-param fallback — secrets in
//     URLs leak via logs/referrers)
//   • timing-safe comparison
//   • PROD with unset CRON_SECRET → endpoint is CLOSED (401 always);
//     the dev fallback secret exists only outside production.
//   • rate-limited (6/min) so a leaked secret cannot hammer the sweep
//
// Idempotent by construction: both passes inside runExpirySweep are
// watermark-guarded (status-flip for expiry, notifiedAt for reminders) —
// repeated calls are no-ops when there is nothing to do.

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
      "[dispatch-expiry] CRON_SECRET is not set — endpoint CLOSED (401) until it is configured."
    );
    return null;
  }
  console.warn(
    "[dispatch-expiry] CRON_SECRET not set — using dev fallback secret. Do NOT ship this to production."
  );
  return DEV_FALLBACK_SECRET;
}

export async function POST(req: NextRequest) {
  try {
    const expected = resolveSecret();
    const provided = req.headers.get("x-cron-secret") ?? "";
    if (!expected || !provided || !secretsMatch(provided, expected)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 6 calls/min is far above the 60s tick rate — anything faster is abuse.
    const rlKey = `cron:dispatch-expiry`;
    if (!checkRateLimit(rlKey, 6, 60_000)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const sweep = await runExpirySweep();

    if (sweep.expired === 0 && sweep.remindersSent === 0) {
      return new NextResponse(null, { status: 204 });
    }

    // Drop caches only when something actually flipped — reminders don't
    // change behaviour/funnel numbers (no status change), flips do (mirrors
    // the ops-manual expire-vouchers route's Fix 19 rationale).
    if (sweep.expired > 0) {
      invalidateBehaviourCache();
      invalidateAllCampaignPerfCaches();
    }

    return NextResponse.json(sweep);
  } catch (error) {
    console.error("[/api/ops/marketing/dispatch-expiry POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
