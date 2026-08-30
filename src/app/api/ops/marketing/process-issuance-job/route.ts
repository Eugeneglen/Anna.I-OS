import { NextRequest, NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";
import {
  claimNextPendingIssuanceJob,
  issueVouchersToSegment,
} from "@/lib/marketing/voucher-engine";
import { invalidateBehaviourCache, invalidateCampaignPerfCache } from "@/lib/cache";
import { checkRateLimit } from "@/lib/rate-limit";

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

    // ── F5 (C5): ownership-aware processor permission ──
    // Processing mutates voucher/job rows, so it needs marketing:edit —
    // EXCEPT a creator with marketing:create may finish THEIR OWN queued
    // job (create→process is one atomic user intent; they may never touch
    // others' jobs). This un-breaks the coordinator flow that previously
    // 403'd mid-dialog.
    const hasEdit = await hasPermission(session, "marketing", "edit");
    const hasCreate = hasEdit ? true : await hasPermission(session, "marketing", "create");
    if (!hasEdit && !hasCreate) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Creators without edit are pinned to their own jobs (enforced below
    // on both the explicit-jobId path and the claim path).
    const ownJobsOnly = !hasEdit;

    // F8: 10 processing calls / min per ops user.
    const rlKey = `ops:${session.userId}:process-issuance`;
    if (!checkRateLimit(rlKey, 10, 60_000)) {
      return NextResponse.json({ error: "Rate limit exceeded. Try again in a minute." }, { status: 429 });
    }

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
        select: { id: true, status: true, campaignId: true, segmentId: true, createdById: true, error: true },
      });
      if (!job) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
      }
      if (ownJobsOnly && job.createdById !== session.userId) {
        return NextResponse.json(
          { error: "Forbidden — you may only process issuance jobs you created (requires marketing:edit for others)" },
          { status: 403 }
        );
      }
      if (job.status !== "PENDING") {
        // ── F5.3: safe Retry for FAILED jobs ── a FAILED job that issued
        // NOTHING (processedCount = 0) may be re-claimed and re-run. A
        // FAILED job that issued SOME vouchers must NOT be re-run blindly —
        // re-issuance would duplicate vouchers for the already-processed
        // members (issueVouchersToSegment has no per-member resume).
        if (job.status === "FAILED") {
          const full = await db.voucherIssuanceJob.findUnique({
            where: { id: job.id },
            select: { processedCount: true },
          });
          if ((full?.processedCount ?? 0) > 0) {
            return NextResponse.json(
              {
                processed: false,
                jobId: job.id,
                status: "FAILED",
                error: job.error,
                message:
                  "This job failed after partially issuing vouchers — a blind retry would duplicate them. Review the job, then queue a fresh campaign/segment run.",
              },
              { status: 409 }
            );
          }
          // Nothing was issued — safe to retry: claim FAILED → RUNNING.
          const retryClaim = await db.voucherIssuanceJob.updateMany({
            where: { id: job.id, status: "FAILED" },
            data: { status: "RUNNING", startedAt: new Date(), error: null, completedAt: null },
          });
          if (retryClaim.count === 0) {
            return NextResponse.json({
              processed: false,
              jobId: job.id,
              status: "RUNNING",
              message: "Another processor is already retrying this job.",
            });
          }
          jobId = job.id;
          // fall through to processing
        } else {
          return NextResponse.json({
            processed: false,
            jobId: job.id,
            status: job.status,
            message: `Job is not PENDING (status=${job.status}). Already processed or in progress.`,
          });
        }
      } else {
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
      }
    } else {
      // F5: creators without edit may only claim THEIR OWN pending jobs.
      jobId = await claimNextPendingIssuanceJob(
        ownJobsOnly ? { createdById: session.userId } : undefined
      );
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
