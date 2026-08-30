import { NextRequest, NextResponse } from "next/server";
import { runNextPendingIssuanceJob } from "@/lib/marketing/voucher-engine";
import { invalidateBehaviourCache, invalidateCampaignPerfCache } from "@/lib/cache";
import { db } from "@/lib/db";

// POST /api/ops/marketing/dispatch-issuance
//
// ── F5 (also the F6 foundation): server-side issuance dispatcher ──
//
// Called by the ops-events mini-service cron (60 s tick) so PENDING
// VoucherIssuanceJobs complete WITHOUT any browser tab open. The create
// route no longer relies on client polling to trigger processing —
// client polling remains only as a status READ.
//
// Authentication: shared-secret header `x-cron-secret` (CRON_SECRET env).
// NOTE: this is deliberately NOT the unauthenticated pattern used by
// /api/predictive/lock (flagged as follow-up debt outside marketing scope).
//
// Idempotent + concurrency-safe: the claim is the same atomic
// updateMany PENDING→RUNNING used by the manual processor route.

const DEV_FALLBACK_SECRET = "anna-cron-dev-secret";

function cronSecret(): string {
  const s = process.env.CRON_SECRET;
  if (!s && process.env.NODE_ENV === "production") {
    // Loud, but non-fatal here: the comparison below will simply never
    // match, so the endpoint stays closed in prod until CRON_SECRET is set.
    console.error(
      "[dispatch-issuance] CRON_SECRET is not set — the cron dispatcher endpoint is effectively DISABLED. Set CRON_SECRET to enable it."
    );
  } else if (!s) {
    console.warn(
      "[dispatch-issuance] CRON_SECRET not set — using dev fallback secret. Do NOT ship this to production."
    );
  }
  return s || DEV_FALLBACK_SECRET;
}

export async function POST(req: NextRequest) {
  try {
    const provided =
      req.headers.get("x-cron-secret") ??
      new URL(req.url).searchParams.get("secret") ??
      "";
    const expected = cronSecret();
    if (provided !== expected) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
