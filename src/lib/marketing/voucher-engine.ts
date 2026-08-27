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
import type { Campaign } from "@prisma/client";

// ── Issue a single voucher to a household ──

export async function issueVoucher(params: {
  householdId: string;
  campaignId: string;
  customExpiry?: Date;
}): Promise<{ voucherId: string; code: string }> {
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
      notifiedAt: new Date(), // will be set when notification is sent
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

  return { voucherId: voucher.id, code: code.code };
}

// ── Issue vouchers to all members of a segment ──

export async function issueVouchersToSegment(params: {
  segmentId: string;
  campaignId: string;
  customExpiry?: Date;
}): Promise<{ issued: number; voucherIds: string[] }> {
  const members = await db.segmentMember.findMany({
    where: { segmentId: params.segmentId },
    select: { householdId: true },
  });

  const voucherIds: string[] = [];
  for (const member of members) {
    try {
      const result = await issueVoucher({
        householdId: member.householdId,
        campaignId: params.campaignId,
        customExpiry: params.customExpiry,
      });
      voucherIds.push(result.voucherId);
    } catch (error) {
      console.error(`[voucher-engine] Failed to issue voucher to household ${member.householdId}:`, error);
      // Continue with other households
    }
  }

  return { issued: voucherIds.length, voucherIds };
}

// ── Get all vouchers for a household ──

export async function getHouseholdVouchers(householdId: string) {
  const vouchers = await db.voucher.findMany({
    where: { householdId },
    orderBy: { claimedAt: "desc" },
    include: {
      discountCode: {
        select: { code: true, maxUses: true, usesRemaining: true },
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
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { discountCodeId: true, householdId: true },
  });

  if (!task || !task.discountCodeId) return;

  // Find the voucher for this household + code
  const voucher = await db.voucher.findFirst({
    where: {
      householdId: task.householdId,
      discountCodeId: task.discountCodeId,
      status: "USED",
    },
  });

  if (!voucher) return;

  // Restore the voucher to CLAIMED
  await db.voucher.update({
    where: { id: voucher.id },
    data: { status: "CLAIMED", usedAt: null },
  });

  // Restore usesRemaining on the code
  const code = await db.discountCode.findUnique({
    where: { id: task.discountCodeId },
    select: { usesRemaining: true },
  });
  if (code && code.usesRemaining !== null) {
    await db.discountCode.update({
      where: { id: task.discountCodeId },
      data: { usesRemaining: code.usesRemaining + 1 },
    });
  }

  // Record event
  await db.campaignEvent.create({
    data: {
      campaignId: voucher.campaignId,
      householdId: task.householdId,
      eventType: "VOUCHER_REVOKED",
      metadata: { voucherId: voucher.id, reason: "Task cancelled", taskId },
    },
  });
}
