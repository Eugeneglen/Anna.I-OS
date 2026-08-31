/**
 * Voucher Engine
 * ==============
 * Manages the voucher wallet lifecycle:
 * - Issue vouchers to households (from campaigns/segments)
 * - Get household vouchers (available + used + expired)
 * - Get eligible vouchers for a specific order (checkout auto-detection)
 * - Mark vouchers as viewed / used / expired / revoked
 * - Restore vouchers on task cancellation
 *
 * A Voucher is a DiscountCode assigned to a specific household.
 * The existing validateRedemption + applyRedemption chain handles the
 * actual discount validation + application — the voucher engine wraps
 * that with wallet management.
 */

import { db } from "@/lib/db";
import { generateSingleCode } from "./campaign-service";
import { getMarketingConfig } from "./config";
import {
  CampaignEventType,
  NotificationChannel,
  NotificationEventType,
  NotificationStatus,
  RecipientType,
  VoucherOrigin,
} from "@prisma/client";

// ── Issue a single voucher to a household ──

export async function issueVoucher(params: {
  householdId: string;
  campaignId: string;
  customExpiry?: Date;
}): Promise<{ voucherId: string; code: string }> {
  // ── F22 (policy R3): origin derivation ──
  //
  // The voucher's origin is derived from its container campaign's type —
  // single source of truth, no caller can mislabel a voucher:
  //   CampaignType.REFUND_CREDIT    → VoucherOrigin.REFUND_CREDIT   (transactional)
  //   CampaignType.SERVICE_RECOVERY → VoucherOrigin.SERVICE_RECOVERY (keep as-is)
  //   anything else                 → VoucherOrigin.MARKETING        (promo)
  const campaignRow = await db.campaign.findUnique({
    where: { id: params.campaignId },
    select: { type: true },
  });
  if (!campaignRow) {
    throw new Error(`Campaign ${params.campaignId} not found — voucher not issued.`);
  }
  const origin: VoucherOrigin =
    campaignRow.type === "REFUND_CREDIT"
      ? VoucherOrigin.REFUND_CREDIT
      : campaignRow.type === "SERVICE_RECOVERY"
        ? VoucherOrigin.SERVICE_RECOVERY
        : VoucherOrigin.MARKETING;

  // ── Fix 20 — PDPA marketingConsent gate (F22-refined) ──
  //
  // Households with `marketingConsent=false` have explicitly opted out
  // of marketing communications. Issuing them a MARKETING voucher would
  // violate PDPA consent rules, so we short-circuit BEFORE creating any
  // DiscountCode / Voucher / Notification rows.
  //
  // ── Fix 20 — PDPA marketingConsent gate (F22-refined, police-2a) ──
  //
  // Households with `marketingConsent=false` have explicitly opted out
  // of marketing communications. Issuing them a MARKETING or
  // SERVICE_RECOVERY voucher would violate PDPA consent rules (policy:
  // service recovery "keep as-is" = gate stays ON), so we short-circuit
  // BEFORE creating any DiscountCode / Voucher / Notification rows.
  //
  // F22 exemption: REFUND_CREDIT ONLY — it is the household's OWN money
  // converted to platform credit (transactional, not marketing); policy
  // R3 rules it consent-exempt ("PDPA-safe to notify").
  const household = await db.household.findUnique({
    where: { id: params.householdId },
    select: { marketingConsent: true, name: true },
  });
  if (!household) {
    throw new Error(`Household ${params.householdId} not found — voucher not issued.`);
  }
  if (household.marketingConsent === false && origin !== VoucherOrigin.REFUND_CREDIT) {
    throw new Error(
      "Household has opted out of marketing communications. Voucher not issued.",
    );
  }

  // F22: per-origin expiry default — refund credit is store credit, standard
  // practice (and policy sub-decision 3.2) is a 12-month TTL when the caller
  // doesn't pin an explicit expiry. Marketing/service-recovery keep the
  // code-level expiry as before.
  const creditDefaultExpiry = new Date();
  creditDefaultExpiry.setDate(creditDefaultExpiry.getDate() + 365);
  const effectiveExpiry =
    params.customExpiry ??
    (origin === VoucherOrigin.REFUND_CREDIT ? creditDefaultExpiry : undefined);

  // Generate a unique code assigned to this household
  const code = await generateSingleCode(params.campaignId, {
    maxUses: 1, // single-use voucher
    expiresAt: effectiveExpiry?.toISOString(),
  });

  // Set assignedHouseholdId on the code (so only this household can redeem it)
  await db.discountCode.update({
    where: { id: code.id },
    data: { assignedHouseholdId: params.householdId },
  });

  // Create the Voucher wallet entry
  const voucher = await db.voucher.create({
    data: {
      householdId: params.householdId,
      discountCodeId: code.id,
      campaignId: params.campaignId,
      status: "CLAIMED",
      origin,
      expiresAt: effectiveExpiry || code.expiresAt,
      // F20 (E2): notifiedAt is the expiry-REMINDER watermark. It stays null
      // at issuance and is stamped ONLY by the expiry-reminder sweep
      // (sendVoucherExpiryReminders) when a "voucher expiring soon"
      // notification is actually sent.
      notifiedAt: null,
    },
    include: {
      campaign: {
        select: {
          id: true,
          name: true,
          type: true,
          targetCategory: true,
          discountRule: {
            select: {
              discountType: true,
              discountValue: true,
              maxDiscountCapCents: true,
            },
          },
        },
      },
    },
  });

  // Record campaign attribution — F22: SKIP for REFUND_CREDIT. A refund is
  // the household's own money returning as credit, not a campaign win:
  // attribution/ROI/insights must not count it as marketing influence.
  if (origin !== VoucherOrigin.REFUND_CREDIT) {
    await db.campaignAttribution.create({
      data: {
        householdId: params.householdId,
        campaignId: params.campaignId,
        touchpoint: "VOUCHER_CLAIMED",
        weight: 0.3,
      },
    });
  }

  // Record campaign event
  await db.campaignEvent.create({
    data: {
      campaignId: params.campaignId,
      householdId: params.householdId,
      eventType: "VOUCHER_ISSUED",
      metadata: { voucherId: voucher.id, code: code.code },
    },
  });

  // ── Phase 1 P0-3 fix: create a household Notification so the household
  // learns they received a marketing voucher. Mirrors the
  // VOUCHER_COMPENSATION_ISSUED pattern in /api/ops/escrow/[id]/route.ts.
  // Wrapped in try/catch — voucher issuance should still succeed even if the
  // notification write fails (the wallet row is the source of truth).
  try {
    const campaign = voucher.campaign;
    const rule = campaign.discountRule;
    const isPct = rule?.discountType === "PERCENTAGE";
    const discountLabel = rule
      ? isPct
        ? `${rule.discountValue}% off`
        : `SGD $${rule.discountValue.toFixed(2)} off`
      : "a discount";
    const expiresAt = voucher.expiresAt;
    const expiryLabel = expiresAt
      ? expiresAt.toLocaleDateString("en-SG", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "no expiry";

    // Look up household members so each one gets a personal notification.
    const members = await db.familyMember.findMany({
      where: { householdId: params.householdId },
      select: { id: true },
    });

    for (const member of members) {
      await db.notification.create({
        data: {
          householdId: params.householdId,
          recipientType: RecipientType.HOUSEHOLD_MEMBER,
          memberId: member.id,
          channel: NotificationChannel.WEB_PUSH,
          eventType: NotificationEventType.VOUCHER_ISSUED,
          title: `New voucher: ${discountLabel}`,
          body: `You've received a voucher (code ${code.code}) for "${campaign.name}". Expires ${expiryLabel}. Apply it at checkout on your next booking.`,
          status: NotificationStatus.PENDING,
          referenceType: "voucher",
          referenceId: voucher.id,
        },
      });
    }

    // F20 (E2): deliberately NOT stamping voucher.notifiedAt here. The old
    // code stamped it right after the VOUCHER_ISSUED notification fan-out,
    // which pre-armed the expiry-reminder watermark — the reminder sweep
    // (which matches on notifiedAt: null) could never fire. notifiedAt now
    // belongs exclusively to sendVoucherExpiryReminders below.
  } catch (error) {
    console.error(
      `[voucher-engine] Failed to create VOUCHER_ISSUED notification for voucher ${voucher.id}:`,
      error,
    );
    // Non-fatal: the voucher itself was already created successfully.
  }

  return { voucherId: voucher.id, code: code.code };
}

// ── Issue vouchers to all members of a segment ──
//
// Phase 2 Fix 11: this function now optionally accepts a `jobId` so the
// caller (the background job processor) can stream progress to the
// `VoucherIssuanceJob` row as it goes. When `jobId` is undefined the
// function behaves exactly as before (synchronous, all members at once)
// so existing callers are unaffected.
//
// Processing is done in batches of `batchSize` (default 50) to keep
// memory bounded for large segments. Between batches, if a jobId is
// provided, the job row's processedCount/voucherIds are updated.

const DEFAULT_BATCH_SIZE = 50;

export async function issueVouchersToSegment(params: {
  segmentId: string;
  campaignId: string;
  customExpiry?: Date;
  jobId?: string;
  batchSize?: number;
}): Promise<{ issued: number; voucherIds: string[]; failedCount: number; skippedCount: number }> {
  const members = await db.segmentMember.findMany({
    where: { segmentId: params.segmentId },
    select: { householdId: true },
  });

  // ── Fix 20 — pre-filter households that have opted out of marketing ──
  //
  // We do a single bulk lookup so we can skip opted-out households BEFORE
  // calling issueVoucher (which would throw the consent error for each
  // one). This keeps the bulk path efficient — one extra query instead
  // of N extra DiscountCode-update rollbacks — and lets us surface a
  // distinct `skippedCount` to the caller / job log, instead of lumping
  // consent opt-outs into `failedCount` (which would surface as a
  // misleading red error in the issuance-job UI).
  //
  // F22 (police-2a finding 4): the pre-filter is type-aware — only
  // marketing campaigns lose consent-off members up-front. REFUND_CREDIT
  // is consent-exempt (transactional), so those members pass through and
  // issueVoucher enforces the final semantics per member.
  const campaignForConsent = await db.campaign.findUnique({
    where: { id: params.campaignId },
    select: { type: true, endDate: true },
  });

  // ── F20 (E1): default expiry for segment-issued vouchers ──
  //
  // The issuance-job path (process-issuance-job / dispatch-issuance →
  // runNextPendingIssuanceJob) never passes customExpiry, so segment
  // vouchers used to be born with expiresAt=NULL — they sat in the wallet
  // as "Available" forever and the expiry sweep could never flip them.
  // Default, in priority order:
  //   1. an explicit customExpiry from the caller (unchanged behaviour);
  //   2. the campaign's endDate — the voucher dies with its campaign
  //      (natural marketing semantics);
  //   3. else a 365-day TTL — the SAME constant default issueVoucher applies
  //      to REFUND_CREDIT (policy sub-decision 3.2 / F22).
  // Edge case: a campaign whose endDate has already passed yields
  // born-expired vouchers — honest (the campaign window is over and
  // validateRedemption would reject the code anyway); the expiry sweep
  // flips them on the next tick.
  const segmentDefaultExpiry = new Date();
  segmentDefaultExpiry.setDate(segmentDefaultExpiry.getDate() + 365);
  const effectiveCustomExpiry =
    params.customExpiry ?? campaignForConsent?.endDate ?? segmentDefaultExpiry;

  const consentExemptCampaign = campaignForConsent?.type === "REFUND_CREDIT";
  const householdIds = members.map((m) => m.householdId);
  const optedOutHouseholdIds = new Set<string>();
  if (householdIds.length > 0 && !consentExemptCampaign) {
    const optedOut = await db.household.findMany({
      where: {
        id: { in: householdIds },
        marketingConsent: false,
      },
      select: { id: true },
    });
    for (const h of optedOut) optedOutHouseholdIds.add(h.id);
  }

  const eligibleMembers = members.filter(
    (m) => !optedOutHouseholdIds.has(m.householdId),
  );
  const skippedCount = optedOutHouseholdIds.size;

  if (skippedCount > 0) {
    // Log how many were skipped — surfaces in the dev server console so
    // ops can correlate a "200 vouchers issued, 5 skipped" run with the
    // segment's actual consent state.
    console.info(
      `[voucher-engine] Segment ${params.segmentId}: skipping ${skippedCount} household${skippedCount === 1 ? "" : "s"} with marketingConsent=false (PDPA opt-out).`,
    );
  }

  const batchSize = params.batchSize ?? DEFAULT_BATCH_SIZE;
  const voucherIds: string[] = [];
  let failedCount = 0;

  // If a jobId is provided, mark the job as RUNNING + set totalMembers.
  // NOTE: totalMembers reflects the *eligible* count (segment members
  // minus opted-out households) so the progress bar denominator matches
  // the actual number of vouchers we will attempt to issue.
  if (params.jobId) {
    await db.voucherIssuanceJob.update({
      where: { id: params.jobId },
      data: {
        status: "RUNNING",
        totalMembers: eligibleMembers.length,
        startedAt: new Date(),
      },
    }).catch((err) => {
      // Non-fatal — log and continue. The job row may have been deleted
      // concurrently; the issuance itself should still proceed.
      console.error("[voucher-engine] Failed to mark job RUNNING:", err);
    });
  }

  for (let i = 0; i < eligibleMembers.length; i += batchSize) {
    const batch = eligibleMembers.slice(i, i + batchSize);
    for (const member of batch) {
      try {
        const result = await issueVoucher({
          householdId: member.householdId,
          campaignId: params.campaignId,
          customExpiry: effectiveCustomExpiry,
        });
        voucherIds.push(result.voucherId);
      } catch (error) {
        // Distinguish consent opt-out from genuine failures. The pre-filter
        // above should make this branch rare for consent reasons (only if the
        // household flipped consent between the bulk lookup and this call),
        // but we still log it as "skipped" rather than "failed" so the
        // failure count reflects actual errors only.
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("opted out of marketing communications")) {
          // Defensive — should be 0 in practice due to the pre-filter.
          console.info(
            `[voucher-engine] Late skip for household ${member.householdId} (consent flipped mid-batch).`,
          );
        } else {
          console.error(`[voucher-engine] Failed to issue voucher to household ${member.householdId}:`, error);
          failedCount++;
        }
        // Continue with other households
      }
    }

    // After each batch, stream progress to the job row (if a jobId was provided).
    if (params.jobId) {
      try {
        await db.voucherIssuanceJob.update({
          where: { id: params.jobId },
          data: {
            processedCount: i + batch.length,
            failedCount,
            voucherIds: voucherIds as unknown as Record<string, unknown>,
          },
        });
      } catch (err) {
        // Non-fatal — log and continue.
        console.error("[voucher-engine] Failed to update job progress:", err);
      }
    }
  }

  // Mark the job as COMPLETED (if a jobId was provided).
  if (params.jobId) {
    try {
      await db.voucherIssuanceJob.update({
        where: { id: params.jobId },
        data: {
          status: "COMPLETED",
          processedCount: eligibleMembers.length,
          failedCount,
          voucherIds: voucherIds as unknown as Record<string, unknown>,
          completedAt: new Date(),
        },
      });
    } catch (err) {
      console.error("[voucher-engine] Failed to mark job COMPLETED:", err);
    }
  }

  return { issued: voucherIds.length, voucherIds, failedCount, skippedCount };
}

// ── Helper: get a single VoucherIssuanceJob's status ──

export async function getVoucherIssuanceJobStatus(jobId: string) {
  const job = await db.voucherIssuanceJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      campaignId: true,
      segmentId: true,
      status: true,
      totalMembers: true,
      processedCount: true,
      failedCount: true,
      error: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
    },
  });
  return job;
}

// ── Helper: atomically claim the oldest PENDING job ──
//
// Uses an updateMany with a status filter to atomically transition
// PENDING → RUNNING for the oldest job, returning the claimed job's id.
// This avoids race conditions if multiple processor requests arrive
// concurrently. Returns null if no PENDING job exists.

export async function claimNextPendingIssuanceJob(
  opts?: { createdById?: string }
): Promise<string | null> {
  // Find oldest PENDING job first (read).
  // F5: optional createdById scope — creators with marketing:create may
  // claim only their own jobs (ownership-aware processor permission).
  const pending = await db.voucherIssuanceJob.findFirst({
    where: {
      status: "PENDING",
      ...(opts?.createdById ? { createdById: opts.createdById } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!pending) return null;

  // Atomically transition PENDING → RUNNING only if still PENDING.
  // This guards against concurrent processors both picking up the same row.
  const result = await db.voucherIssuanceJob.updateMany({
    where: { id: pending.id, status: "PENDING" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  if (result.count === 0) {
    // Another processor beat us to it — recurse to try the next one.
    return claimNextPendingIssuanceJob(opts);
  }
  return pending.id;
}

// ── Get all vouchers for a household ──

/**
 * F5/F6 dispatcher core: claim the oldest PENDING job and run it.
 * Shared by the ops-manual processor route (session-authenticated) and the
 * cron dispatcher endpoint (CRON_SECRET-authenticated) so both paths use
 * the exact same atomic claim + batch-issuance logic.
 */
// ── F19 (police-1c f3): reap zombie RUNNING issuance jobs ──
//
// A hard process death mid-batch leaves a job RUNNING forever (dispatcher
// claims PENDING only; retry handles FAILED only). Anything still RUNNING
// after REAP_AFTER_MS is dead — flip it to FAILED so the retry path (and the
// 409 duplicate-guard for partially-processed jobs) can take over.
// processedCount>0 + FAILED = un-retryable by design (safe: re-running could
// double-issue to already-served members); ops can inspect the job's
// voucherIds list. Called from runNextPendingIssuanceJob — the single funnel
// for both the ops-events cron tick and manual claims.
const REAP_AFTER_MS = 15 * 60 * 1000; // 15 minutes
export async function reapStaleIssuanceJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - REAP_AFTER_MS);
  const reaped = await db.voucherIssuanceJob.updateMany({
    where: {
      status: "RUNNING",
      OR: [{ startedAt: { lt: cutoff } }, { startedAt: null }],
    },
    data: {
      status: "FAILED",
      error: "Reaped: job stuck RUNNING >15min (process death / stuck batch) — auto-recovered by F19 reaper",
    },
  });
  if (reaped.count > 0) {
    console.warn(`[voucher-engine] reaped ${reaped.count} zombie RUNNING issuance job(s) → FAILED`);
  }
  return reaped.count;
}

export async function runNextPendingIssuanceJob(opts?: {
  createdById?: string;
}): Promise<
  | { processed: false }
  | { processed: true; jobId: string; status: "COMPLETED"; issued: number; failedCount: number; skippedCount: number }
  | { processed: true; jobId: string; status: "FAILED"; error: string }
> {
  // F19: clear zombies first so a stuck RUNNING job can't block its segment
  // (or sit unclaimable forever) while a fresh PENDING job waits behind it.
  await reapStaleIssuanceJobs();
  const jobId = await claimNextPendingIssuanceJob(opts);
  if (!jobId) return { processed: false };

  const job = await db.voucherIssuanceJob.findUnique({
    where: { id: jobId },
    select: { id: true, campaignId: true, segmentId: true },
  });
  if (!job) return { processed: false };

  try {
    const result = await issueVouchersToSegment({
      segmentId: job.segmentId,
      campaignId: job.campaignId,
      jobId: job.id,
    });
    return {
      processed: true,
      jobId: job.id,
      status: "COMPLETED",
      issued: result.issued,
      failedCount: result.failedCount,
      skippedCount: result.skippedCount,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error during issuance";
    try {
      await db.voucherIssuanceJob.update({
        where: { id: job.id },
        data: { status: "FAILED", error: errMsg.slice(0, 1000), completedAt: new Date() },
      });
    } catch (updateErr) {
      console.error("[runNextPendingIssuanceJob] failed to mark job FAILED:", updateErr);
    }
    return { processed: true, jobId: job.id, status: "FAILED", error: errMsg };
  }
}

export async function getHouseholdVouchers(householdId: string) {
  const vouchers = await db.voucher.findMany({
    where: { householdId },
    orderBy: { claimedAt: "desc" },
    include: {
      discountCode: {
        select: { code: true, isActive: true, usesRemaining: true, maxUses: true },
      },
      campaign: {
        select: {
          id: true,
          name: true,
          type: true,
          targetCategory: true,
          discountRule: {
            select: {
              discountType: true,
              discountValue: true,
              minOrderValueCents: true,
              maxDiscountCapCents: true,
              eligibility: true,
            },
          },
        },
      },
    },
  });

  return vouchers.map((v) => ({
    id: v.id,
    status: v.status,
    origin: v.origin, // F22 — drives the wallet badge (Refund credit / Service recovery / Promo)
    code: v.discountCode.code,
    campaignName: v.campaign.name,
    campaignType: v.campaign.type,
    targetCategory: v.campaign.targetCategory,
    discountType: v.campaign.discountRule?.discountType,
    discountValue: v.campaign.discountRule?.discountValue,
    minOrderValueCents: v.campaign.discountRule?.minOrderValueCents || 0,
    maxDiscountCapCents: v.campaign.discountRule?.maxDiscountCapCents || 0,
    eligibility: v.campaign.discountRule?.eligibility,
    claimedAt: v.claimedAt,
    usedAt: v.usedAt,
    expiresAt: v.expiresAt,
    // Underlying code state — drives the "Suspended" badge in the wallet UI
    // when the code is paused (isActive=false) but the Voucher row is still
    // CLAIMED. Without this the household sees an "Available" voucher that
    // fails to apply with a generic "deactivated" message.
    codeActive: v.discountCode.isActive,
    usesRemaining: v.discountCode.usesRemaining,
    maxUses: v.discountCode.maxUses,
    // Service-recovery audit fields (populated when this voucher was issued
    // as dispute compensation; null otherwise).
    issuedFromTaskId: v.issuedFromTaskId ?? null,
    compensationReason: v.compensationReason ?? null,
    issuedByName: v.issuedByName ?? null,
  }));
}

// ── Get eligible vouchers for a specific order (checkout auto-detection) ──

export async function getEligibleVouchers(params: {
  householdId: string;
  orderValueCents: number;
  category?: string;
}) {
  const vouchers = await db.voucher.findMany({
    where: {
      householdId: params.householdId,
      status: "CLAIMED",
    },
    include: {
      discountCode: { select: { code: true, isActive: true } },
      campaign: {
        select: {
          id: true,
          name: true,
          type: true,
          status: true,
          targetCategory: true,
          startDate: true,
          endDate: true,
          discountRule: {
            select: {
              discountType: true,
              discountValue: true,
              minOrderValueCents: true,
              maxDiscountCapCents: true,
              eligibility: true,
            },
          },
        },
      },
    },
  });

  const now = new Date();

  return vouchers
    .filter((v) => {
      // Basic checks
      if (!v.discountCode.isActive) return false;
      if (v.expiresAt && now > v.expiresAt) return false;
      if (v.campaign.status !== "ACTIVE") return false;
      if (v.campaign.startDate && now < v.campaign.startDate) return false;
      if (v.campaign.endDate && now > v.campaign.endDate) return false;

      // Target category check
      if (v.campaign.targetCategory && params.category && v.campaign.targetCategory !== params.category) {
        return false;
      }

      // Min order value check
      const minOrder = v.campaign.discountRule?.minOrderValueCents;
      if (minOrder && params.orderValueCents < minOrder) {
        return false;
      }

      return true;
    })
    .map((v) => ({
      voucherId: v.id,
      code: v.discountCode.code,
      campaignName: v.campaign.name,
      campaignType: v.campaign.type,
      targetCategory: v.campaign.targetCategory,
      discountType: v.campaign.discountRule?.discountType,
      discountValue: v.campaign.discountRule?.discountValue,
      minOrderValueCents: v.campaign.discountRule?.minOrderValueCents || 0,
      maxDiscountCapCents: v.campaign.discountRule?.maxDiscountCapCents || 0,
      expiresAt: v.expiresAt,
      ineligibleReason: null, // eligible
    }));
}

// ── Mark voucher as viewed ──

export async function markVoucherViewed(voucherId: string, householdId: string): Promise<void> {
  const voucher = await db.voucher.findUnique({
    where: { id: voucherId },
    select: { householdId: true, viewedAt: true },
  });

  if (!voucher || voucher.householdId !== householdId) return;
  if (voucher.viewedAt) return; // already viewed

  await db.voucher.update({
    where: { id: voucherId },
    data: { viewedAt: new Date() },
  });

  // Record campaign event
  await db.campaignEvent.create({
    data: {
      campaignId: (await db.voucher.findUnique({ where: { id: voucherId }, select: { campaignId: true } }))!.campaignId,
      householdId,
      eventType: "VOUCHER_VIEWED",
      metadata: { voucherId },
    },
  });
}

// ── Mark voucher as used (called after applyRedemption) ──

export async function markVoucherUsed(voucherId: string, taskId: string, householdId: string): Promise<void> {
  await db.voucher.update({
    where: { id: voucherId },
    data: { status: "USED", usedAt: new Date() },
  });

  // Record attribution — F22: skip for REFUND_CREDIT (spending store credit
  // is transactional, not a marketing win; policy R3 funnel exclusion).
  const voucher = await db.voucher.findUnique({
    where: { id: voucherId },
    select: { campaignId: true, campaign: { select: { type: true } } },
  });

  if (voucher && voucher.campaign.type !== "REFUND_CREDIT") {
    await db.campaignAttribution.create({
      data: {
        householdId,
        campaignId: voucher.campaignId,
        taskId,
        touchpoint: "VOUCHER_USED",
        weight: 1.0,
      },
    });
  }

  // Campaign event kept for ALL origins (police-2a nit 5: event handling
  // symmetric with writeRedemptionBookkeeping/tasks-inline — the audit
  // trail is transactional; attribution is the marketing signal).
  if (voucher) {
    await db.campaignEvent.create({
      data: {
        campaignId: voucher.campaignId,
        householdId,
        eventType: "VOUCHER_REDEEMED",
        metadata: { voucherId, taskId },
      },
    });
  }
}

// ── Expire vouchers (cron job) ──
//
// ── F20 (H4) fix: the re-query bug ──
//
// The old implementation flipped eligible vouchers with one guarded
// updateMany and then RE-QUERIED `{ status: "EXPIRED", expiresAt: { lt: now } }`
// to write the VOUCHER_EXPIRED campaign events. That re-query matched every
// voucher that had EVER been expired — not just the ones flipped by this
// pass — so any sweep that expired ≥1 voucher re-created duplicate
// VOUCHER_EXPIRED events for the ENTIRE historical expired set (unbounded
// audit-row spam), and the event set was decoupled from the flip set.
//
// F7-style idempotency (status-flip as the watermark): each voucher is
// flipped with its own guarded updateMany (CLAIMED → EXPIRED) and only the
// sweep that WINS the flip writes the event. A second run selects nothing →
// zero writes. Concurrent sweeps are safe — the loser of a flip sees
// count 0 and skips both the event and the counter.

export async function expireVouchers(): Promise<{ expired: number }> {
  const now = new Date();
  const eligible = await db.voucher.findMany({
    where: { status: "CLAIMED", expiresAt: { lt: now } },
    select: { id: true, campaignId: true, householdId: true },
    take: 500, // bounded per sweep; a larger backlog drains on subsequent ticks
  });
  if (eligible.length === 0) return { expired: 0 };

  let expired = 0;
  for (const v of eligible) {
    // Guarded status-flip — the flip itself is the idempotency watermark.
    const flipped = await db.voucher.updateMany({
      where: { id: v.id, status: "CLAIMED" },
      data: { status: "EXPIRED" },
    });
    if (flipped.count === 0) continue; // another actor flipped/used/revoked it first

    await db.campaignEvent.create({
      data: {
        campaignId: v.campaignId,
        householdId: v.householdId,
        eventType: "VOUCHER_EXPIRED",
        metadata: { voucherId: v.id },
      },
    }).catch(() => {}); // non-fatal — the status flip already happened
    expired++;
  }

  return { expired };
}

// ── Expiry-reminder sweep (F20 / E2) ──
//
// REVIVED + RELOCATED from /api/ops/marketing/expire-vouchers (where this
// logic was dead code): the old route-level sweep filtered `notifiedAt: null`,
// but issueVoucher stamped notifiedAt at issuance, so no voucher ever matched.
// notifiedAt now belongs exclusively to this sweep — it is the idempotency
// watermark, stamped atomically BEFORE the notification fan-out (claim-first,
// mirroring the F19 resolve_voucher claim pattern) and released again if the
// fan-out fails, so a failed reminder is retried on the next sweep.
//
// The notice window comes from the marketing config (voucherExpiryNoticeDays,
// default 3) instead of the old hardcoded 3 days.
//
// Vouchers with expiresAt=NULL (legacy E1 rows issued before the default
// landed) never match — they have no expiry to be reminded about.

export async function sendVoucherExpiryReminders(): Promise<number> {
  const config = await getMarketingConfig();
  const noticeDays = config.voucherExpiryNoticeDays ?? 3;
  const now = new Date();
  const windowEnd = new Date(now.getTime() + noticeDays * 24 * 60 * 60 * 1000);

  const expiring = await db.voucher.findMany({
    where: {
      status: "CLAIMED",
      expiresAt: { gte: now, lte: windowEnd },
      notifiedAt: null, // reminder watermark — not yet reminded
    },
    select: { id: true, householdId: true, expiresAt: true, campaignId: true },
    take: 100, // bounded fan-out per sweep; the rest goes on the next tick
  });
  if (expiring.length === 0) return 0;

  let sent = 0;
  for (const voucher of expiring) {
    // Claim the watermark FIRST (atomic null → now, still-CLAIMED guard so a
    // voucher redeemed in the meantime is not reminded). Exactly one sweep
    // wins per voucher.
    const claimed = await db.voucher.updateMany({
      where: { id: voucher.id, notifiedAt: null, status: "CLAIMED" },
      data: { notifiedAt: new Date() },
    });
    if (claimed.count === 0) continue;

    try {
      const campaign = await db.campaign.findUnique({
        where: { id: voucher.campaignId },
        select: { name: true },
      });
      const expiryLabel = voucher.expiresAt!.toLocaleDateString("en-SG", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

      // Notify every household member (same fan-out pattern as the
      // VOUCHER_ISSUED notification in issueVoucher).
      const members = await db.familyMember.findMany({
        where: { householdId: voucher.householdId },
        select: { id: true },
      });
      for (const member of members) {
        await db.notification.create({
          data: {
            householdId: voucher.householdId,
            recipientType: RecipientType.HOUSEHOLD_MEMBER,
            memberId: member.id,
            channel: NotificationChannel.WEB_PUSH,
            // No VOUCHER_EXPIRING value exists in NotificationEventType and
            // this task allows no schema changes — REBOOKING_PROMPT (the
            // "come back and use this" nudge type) is the closest existing
            // semantic; the panel renders voucher-referenced ones without the
            // task action-link. TODO (schema change allowed): add
            // VOUCHER_EXPIRING to the enum and switch.
            eventType: NotificationEventType.REBOOKING_PROMPT,
            title: "Voucher Expiring Soon",
            body: `Your voucher from "${campaign?.name ?? "a campaign"}" expires on ${expiryLabel}. Use it before it's gone!`,
            status: NotificationStatus.PENDING,
            referenceType: "voucher",
            referenceId: voucher.id,
          },
        });
      }
      sent++;
    } catch (error) {
      // Fan-out failed — release the watermark so the next sweep retries.
      await db.voucher
        .update({ where: { id: voucher.id }, data: { notifiedAt: null } })
        .catch(() => {});
      console.error(
        `[voucher-engine] Failed to send expiry reminder for voucher ${voucher.id}:`,
        error,
      );
    }
  }

  return sent;
}

// ── Full expiry lifecycle pass (F20) ──
//
// Single funnel shared by the ops-manual expire-vouchers route and the
// ops-events 60s cron tick (via /api/ops/marketing/dispatch-expiry):
//   1. flip past-expiry CLAIMED vouchers → EXPIRED (H4-fixed, idempotent);
//   2. send "expiring soon" reminders inside the configured notice window
//      (E2, notifiedAt watermark).
// Safe to run every tick: both passes are no-ops when there is nothing to do.

export async function runExpirySweep(): Promise<{ expired: number; remindersSent: number }> {
  const { expired } = await expireVouchers();
  const remindersSent = await sendVoucherExpiryReminders();
  return { expired, remindersSent };
}

// ── Revoke a voucher ──

export async function revokeVoucher(voucherId: string, reason: string): Promise<void> {
  const voucher = await db.voucher.findUnique({
    where: { id: voucherId },
    select: { discountCodeId: true, campaignId: true, householdId: true },
  });

  if (!voucher) throw new Error("Voucher not found");

  await db.voucher.update({
    where: { id: voucherId },
    data: { status: "REVOKED", revokedAt: new Date(), revokedReason: reason },
  });

  // Deactivate the code
  await db.discountCode.update({
    where: { id: voucher.discountCodeId },
    data: { isActive: false },
  });

  // Record event
  await db.campaignEvent.create({
    data: {
      campaignId: voucher.campaignId,
      householdId: voucher.householdId,
      eventType: "VOUCHER_REVOKED",
      metadata: { voucherId, reason },
    },
  });
}

// ── Restore voucher on task cancellation / refund (F3b, ruled R3) ──
//
// Ruled behaviour (download/voucher-policy-decision.md, R3):
//   • single-use WALLET voucher → REISSUED: returned to CLAIMED so it
//     reappears in the household wallet, spendable once more. (The
//     @@unique(householdId, discountCodeId) constraint means a fresh
//     Voucher row on the same code is impossible — restore-to-CLAIMED
//     IS the reissue form for wallet vouchers.)
//   • multi-use PUBLIC code → the consumed use is returned atomically.
//   • Campaign.redemptionsCount is decremented (H5 reconciliation) and
//     the task's CodeRedemption row is deleted so aggregates stay true.
//   • Task.discountCodeId is detached.
//   • Fully IDEMPOTENT: the task's CodeRedemption row is the marker —
//     once gone, subsequent calls are no-ops (double-cancel safe).

export interface VoucherRestoreResult {
  restored: boolean;
  voucherReissued: boolean; // wallet voucher back to CLAIMED
  useRestored: boolean;     // code usesRemaining incremented
  redemptionDeleted: boolean;
}

export async function restoreVoucherOnCancellation(
  taskId: string
): Promise<VoucherRestoreResult> {
  return db.$transaction(async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: taskId },
      select: { discountCodeId: true, householdId: true },
    });
    if (!task || !task.discountCodeId) {
      return { restored: false, voucherReissued: false, useRestored: false, redemptionDeleted: false };
    }

    // Idempotency marker: this task's CodeRedemption row, keyed on the
    // REAL taskId column (F4). Pre-F4 rows stored the Task id in the
    // free bookingId string — spoofable and unordered (C4); the F4
    // backfill (scripts/ops/f4-backfill.ts) re-keys those rows onto
    // taskId. A deliberate bookingId=<taskId> spoof row (taskId=null)
    // can no longer be consumed by this lookup.
    const redemption = await tx.codeRedemption.findFirst({
      where: {
        discountCodeId: task.discountCodeId,
        householdId: task.householdId,
        taskId: taskId,
      },
      orderBy: { redeemedAt: "asc" }, // deterministic if duplicates ever exist
    });
    if (!redemption) {
      // Already reconciled (or nothing was redeemed on this task) — no-op.
      return { restored: false, voucherReissued: false, useRestored: false, redemptionDeleted: false };
    }

    // 1) Wallet voucher (single-use, household-scoped): USED → CLAIMED.
    const voucher = await tx.voucher.findUnique({
      where: {
        householdId_discountCodeId: {
          householdId: task.householdId,
          discountCodeId: task.discountCodeId,
        },
      },
    });
    let voucherReissued = false;
    if (voucher && voucher.status === "USED") {
      await tx.voucher.update({
        where: { id: voucher.id },
        data: { status: "CLAIMED", usedAt: null },
      });
      voucherReissued = true;
    }

    // 2) Return the consumed use to the code — atomic increment, then a
    //    hygiene clamp to maxUses (SQLite cannot compare two columns inside
    //    updateMany; single-writer serialization keeps this race-free).
    await tx.discountCode.updateMany({
      where: { id: task.discountCodeId },
      data: { usesRemaining: { increment: 1 } },
    });
    const code = await tx.discountCode.findUnique({
      where: { id: task.discountCodeId },
      select: { usesRemaining: true, maxUses: true },
    });
    if (
      code &&
      code.usesRemaining !== null &&
      code.maxUses !== null &&
      code.usesRemaining > code.maxUses
    ) {
      await tx.discountCode.update({
        where: { id: task.discountCodeId },
        data: { usesRemaining: code.maxUses },
      });
    }

    // 3) H5 reconciliation: campaign counter down (guarded, never below 0)
    //    and the redemption row is removed so aggregates stay truthful.
    await tx.campaign.updateMany({
      where: { id: redemption.campaignId, redemptionsCount: { gt: 0 } },
      data: { redemptionsCount: { decrement: 1 } },
    });
    await tx.codeRedemption.delete({ where: { id: redemption.id } });

    // 4) Detach the discount from the task — it no longer applies.
    await tx.task.update({
      where: { id: taskId },
      data: { discountCodeId: null },
    });

    // 5) Honest audit trail (the old event was mislabeled VOUCHER_REVOKED).
    await tx.campaignEvent.create({
      data: {
        campaignId: redemption.campaignId,
        householdId: task.householdId,
        eventType: CampaignEventType.VOUCHER_ISSUED,
        metadata: {
          reissuedForTaskId: taskId,
          voucherId: voucher?.id ?? null,
          discountCents: redemption.discountAppliedCents,
          note: "voucher reissued on cancellation/refund (F3b)",
        },
      },
    });

    // 6) Tell the household their voucher is back (H5 gap: previously no
    //    notification was sent for any voucher restore).
    const members = await tx.familyMember.findMany({
      where: { householdId: task.householdId },
      select: { id: true },
    });
    for (const member of members) {
      await tx.notification.create({
        data: {
          householdId: task.householdId,
          recipientType: RecipientType.HOUSEHOLD_MEMBER,
          memberId: member.id,
          channel: NotificationChannel.WHATSAPP,
          eventType: NotificationEventType.VOUCHER_ISSUED,
          title: "Voucher Reissued",
          body: `Your voucher has been returned to your wallet and is ready to use again (ref task ${taskId.slice(-6).toUpperCase()}).`,
          status: NotificationStatus.PENDING,
          referenceType: "task",
          referenceId: taskId,
        },
      });
    }

    return { restored: true, voucherReissued, useRestored: true, redemptionDeleted: true };
  });
}
