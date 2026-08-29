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
import {
  NotificationChannel,
  NotificationEventType,
  NotificationStatus,
  RecipientType,
} from "@prisma/client";

// ── Issue a single voucher to a household ──

export async function issueVoucher(params: {
  householdId: string;
  campaignId: string;
  customExpiry?: Date;
}): Promise<{ voucherId: string; code: string }> {
  // ── Fix 20 — PDPA marketingConsent gate ──
  //
  // Households with `marketingConsent=false` have explicitly opted out
  // of marketing communications. Issuing them a marketing voucher would
  // violate PDPA consent rules, so we short-circuit BEFORE creating any
  // DiscountCode / Voucher / Notification rows. The check is placed at
  // the top of `issueVoucher` so every caller is covered — including
  // the segment-bulk path (issueVouchersToSegment) and the dispute
  // compensation path (service-recovery → issueCompensationVoucher).
  //
  // Throwing rather than returning a "soft" failure keeps the contract
  // simple: callers that want to ignore the failure (e.g. the bulk
  // issuer) wrap the call in try/catch, which is exactly what
  // issueVouchersToSegment already does.
  const household = await db.household.findUnique({
    where: { id: params.householdId },
    select: { marketingConsent: true, name: true },
  });
  if (!household) {
    throw new Error(`Household ${params.householdId} not found — voucher not issued.`);
  }
  if (household.marketingConsent === false) {
    throw new Error(
      "Household has opted out of marketing communications. Voucher not issued.",
    );
  }

  // Generate a unique code assigned to this household
  const code = await generateSingleCode(params.campaignId, {
    maxUses: 1, // single-use voucher
    expiresAt: params.customExpiry?.toISOString(),
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
      expiresAt: params.customExpiry || code.expiresAt,
      notifiedAt: null, // will be set when the VOUCHER_ISSUED notification is sent
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

  // Record campaign attribution
  await db.campaignAttribution.create({
    data: {
      householdId: params.householdId,
      campaignId: params.campaignId,
      touchpoint: "VOUCHER_CLAIMED",
      weight: 0.3,
    },
  });

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

    const now = new Date();
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

    // Mark the voucher as notified now that the notification(s) have been created
    await db.voucher.update({
      where: { id: voucher.id },
      data: { notifiedAt: now },
    });
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
  const householdIds = members.map((m) => m.householdId);
  const optedOutHouseholdIds = new Set<string>();
  if (householdIds.length > 0) {
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
          customExpiry: params.customExpiry,
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

export async function claimNextPendingIssuanceJob(): Promise<string | null> {
  // Find oldest PENDING job first (read).
  const pending = await db.voucherIssuanceJob.findFirst({
    where: { status: "PENDING" },
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
    return claimNextPendingIssuanceJob();
  }
  return pending.id;
}

// ── Get all vouchers for a household ──

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

  // Record attribution
  const voucher = await db.voucher.findUnique({
    where: { id: voucherId },
    select: { campaignId: true },
  });

  if (voucher) {
    await db.campaignAttribution.create({
      data: {
        householdId,
        campaignId: voucher.campaignId,
        taskId,
        touchpoint: "VOUCHER_USED",
        weight: 1.0,
      },
    });

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

export async function expireVouchers(): Promise<{ expired: number }> {
  const result = await db.voucher.updateMany({
    where: {
      status: "CLAIMED",
      expiresAt: { lt: new Date() },
    },
    data: { status: "EXPIRED" },
  });

  // Record campaign events for expired vouchers
  if (result.count > 0) {
    const expiredVouchers = await db.voucher.findMany({
      where: { status: "EXPIRED", expiresAt: { lt: new Date() } },
      select: { id: true, campaignId: true, householdId: true },
    });

    for (const v of expiredVouchers) {
      await db.campaignEvent.create({
        data: {
          campaignId: v.campaignId,
          householdId: v.householdId,
          eventType: "VOUCHER_EXPIRED",
          metadata: { voucherId: v.id },
        },
      }).catch(() => {}); // non-fatal
    }
  }

  return { expired: result.count };
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

// ── Restore voucher on task cancellation ──

export async function restoreVoucherOnCancellation(taskId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: taskId },
      select: { discountCodeId: true, householdId: true },
    });

    if (!task || !task.discountCodeId) return;

    // Find the voucher for this household + code
    const voucher = await tx.voucher.findFirst({
      where: {
        householdId: task.householdId,
        discountCodeId: task.discountCodeId,
        status: "USED",
      },
    });

    if (!voucher) return;

    // Restore the voucher to CLAIMED
    await tx.voucher.update({
      where: { id: voucher.id },
      data: { status: "CLAIMED", usedAt: null },
    });

    // Restore usesRemaining on the code
    const code = await tx.discountCode.findUnique({
      where: { id: task.discountCodeId },
      select: { usesRemaining: true },
    });
    if (code && code.usesRemaining !== null) {
      await tx.discountCode.update({
        where: { id: task.discountCodeId },
        data: { usesRemaining: code.usesRemaining + 1 },
      });
    }

    // Record event
    await tx.campaignEvent.create({
      data: {
        campaignId: voucher.campaignId,
        householdId: task.householdId,
        eventType: "VOUCHER_REVOKED",
        metadata: { voucherId: voucher.id, reason: "Task cancelled", taskId },
      },
    });
  });
}
