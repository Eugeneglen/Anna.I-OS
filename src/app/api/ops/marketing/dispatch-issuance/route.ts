import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { runNextPendingIssuanceJob } from "@/lib/marketing/voucher-engine";
import { invalidateBehaviourCache, invalidateCampaignPerfCache } from "@/lib/cache";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

// POST /api/ops/marketing/dispatch-issuance
//
// ── F5 (also the F6 foundation): server-side issuance dispatcher ──
//
// Called by the ops-events mini-service cron (60 s tick) so PENDING
// VoucherIssuanceJobs complete WITHOUT any browser tab open. The create
// route no longer relies on client polling to trigger processing —
// client polling remains only as a status READ.
//
// Authentication (police-1c finding #2 hardened):
//   • header `x-cron-secret` only (no query-param fallback — secrets in
//     URLs leak via logs/referrers)
//   • timing-safe comparison
//   • PROD with unset CRON_SECRET → endpoint is CLOSED (401 always);
//     the dev fallback secret exists only outside production.
//   • rate-limited (6/min) so a leaked secret cannot hammer the issuer
//
// Idempotent + concurrency-safe: the claim is the same atomic
// updateMany PENDING→RUNNING used by the manual processor route.

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
    // Police-1c: the old code claimed "disabled" but still returned the
    // hardcoded dev secret — in prod the endpoint must actually be closed.
    console.error(
      "[dispatch-issuance] CRON_SECRET is not set — endpoint CLOSED (401) until it is configured."
    );
    return null;
  }
  console.warn(
    "[dispatch-issuance] CRON_SECRET not set — using dev fallback secret. Do NOT ship this to production."
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
    const rlKey = `cron:dispatch-issuance`;
    if (!checkRateLimit(rlKey, 6, 60_000)) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    const result = await runNextPendingIssuanceJob();

    if (!result.processed) {
      return new NextResponse(null, { status: 204 });
    }

    // Drop caches for the affected campaign (mirrors the manual route).
    if (result.status === "COMPLETED") {
      const job = await db.voucherIssuanceJob.findUnique({
        where: { id: result.jobId },
        select: { campaignId: true },
      });
      invalidateBehaviourCache();
      if (job) invalidateCampaignPerfCache(job.campaignId);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[/api/ops/marketing/dispatch-issuance POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
