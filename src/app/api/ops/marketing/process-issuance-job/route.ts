import { NextRequest, NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import {
  claimNextPendingIssuanceJob,
  issueVouchersToSegment,
} from "@/lib/marketing/voucher-engine";
import { invalidateBehaviourCache, invalidateCampaignPerfCache } from "@/lib/cache";

// POST /api/ops/marketing/process-issuance-job
//
// Phase 2 Fix 11 — polling-based background processor.
// Picks up the oldest PENDING VoucherIssuanceJob, transitions it to RUNNING,
// calls `issueVouchersToSegment({ jobId, ... })` (which processes in batches
// of 50 and streams progress to the job row), then transitions to COMPLETED
// (or FAILED on error).
//
// The route can be invoked manually or via a simple setInterval on the client.
// It is idempotent: if no PENDING job exists, returns 204 No Content.
//
// Optional body:
//   { "jobId": "<cuid>" }   — process a specific job instead of the oldest PENDING
//
// Returns:
//   200 { processed: true,  jobId, status: "COMPLETED", issued, failedCount }
//   200 { processed: true,  jobId, status: "FAILED", error }
//   204 { processed: false }  — no PENDING job in the queue

export async function POST(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Processing requires edit permission — it mutates voucher/job rows.
    const allowed = await hasPermission(session, "marketing", "edit");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Allow callers to target a specific job (otherwise claim oldest PENDING).
    let body: { jobId?: string } = {};
    try {
      body = await req.json();
    } catch {
      // Empty body is fine — claim oldest PENDING.
    }

    let jobId: string | null;
    if (body.jobId) {
      // Verify the job exists and is still PENDING before processing.
      const job = await db.voucherIssuanceJob.findUnique({
        where: { id: body.jobId },
        select: { id: true, status: true, campaignId: true, segmentId: true },
      });
      if (!job) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
      if (job.status !== "PENDING") {
        return NextResponse.json({
          processed: false,
          jobId: job.id,
          status: job.status,
          message: `Job is not PENDING (status=${job.status}). Already processed or in progress.`,
        });
      }
      // Atomically claim it.
      const claim = await db.voucherIssuanceJob.updateMany({
        where: { id: job.id, status: "PENDING" },
        data: { status: "RUNNING", startedAt: new Date() },
      });
      if (claim.count === 0) {
        // Another processor beat us — return current status.
        const fresh = await db.voucherIssuanceJob.findUnique({
          where: { id: body.jobId },
          select: { status: true },
        });
        return NextResponse.json({
          processed: false,
          jobId: body.jobId,
          status: fresh?.status ?? "UNKNOWN",
        });
      }
      jobId = job.id;
    } else {
      jobId = await claimNextPendingIssuanceJob();
    }

    if (!jobId) {
      return new NextResponse(null, { status: 204 });
    }

    const job = await db.voucherIssuanceJob.findUnique({
      where: { id: jobId },
      select: { id: true, campaignId: true, segmentId: true },
    });
    if (!job) {
      return NextResponse.json({ error: "Job disappeared" }, { status: 404 });
    }

    try {
      const result = await issueVouchersToSegment({
        segmentId: job.segmentId,
        campaignId: job.campaignId,
        jobId: job.id,
      });

      // ── Fix 19 — voucher issuance changes behaviour outputs ──
      // (vouchersClaimed) and campaign-perf funnel numbers
      // (vouchersIssued, viewRate denominator, etc.). Drop both caches
      // so the next dashboard read sees the newly issued vouchers.
      invalidateBehaviourCache();
      invalidateCampaignPerfCache(job.campaignId);

      return NextResponse.json({
        processed: true,
        jobId: job.id,
        status: "COMPLETED",
        issued: result.issued,
        failedCount: result.failedCount,
        // Fix 20 — how many segment members were skipped due to
        // marketingConsent=false (PDPA opt-out). Additive; existing
        // callers that don't read this field are unaffected.
        skippedCount: result.skippedCount,
      });
    } catch (error) {
      // Mark the job as FAILED with the error message.
      const errMsg =
        error instanceof Error ? error.message : "Unknown error during issuance";
      try {
        await db.voucherIssuanceJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            error: errMsg.slice(0, 1000),
            completedAt: new Date(),
          },
        });
      } catch (updateErr) {
        console.error(
          "[/api/ops/marketing/process-issuance-job] Failed to mark job FAILED:",
          updateErr,
        );
      }
      console.error("[/api/ops/marketing/process-issuance-job] Issuance failed:", error);
      return NextResponse.json({
        processed: true,
        jobId: job.id,
        status: "FAILED",
        error: errMsg,
      });
    }
  } catch (error) {
    console.error("[/api/ops/marketing/process-issuance-job POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
