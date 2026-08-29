/**
 * Campaign Service
 * ================
 * Business logic for the Marketing module:
 * - Campaign CRUD + state transitions (DRAFT → ACTIVE → PAUSED → ENDED)
 * - Code generation (single + bulk batch)
 * - Redemption validation (full rule chain)
 * - Discount application (job amount + subscription fee)
 */

import { db } from "@/lib/db";
import { CampaignStatus } from "@prisma/client";
import * as crypto from "crypto";

// ── Campaign CRUD ──

export interface CreateCampaignInput {
  name: string;
  description?: string;
  type: string;
  appliesTo?: string;
  targetTier?: string;
  targetCategory?: string;
  maxRedemptions?: number;
  startDate?: string;
  endDate?: string;
  // Discount rule
  discountType: string;
  discountValue: number;
  minOrderValueCents?: number;
  maxDiscountCapCents?: number;
  stackable?: boolean;
  eligibility?: string;
  minAutonomyLevel?: number;
  maxAutonomyLevel?: number;
  createdById?: string;
  createdByName: string;
  // ── Phase 2 Fix 10 — campaign content editor ──
  subjectLine?: string;
  bodyText?: string;
  bodyHtml?: string;
  smsText?: string;
  // ── Fix 21 — timezone-aware scheduled send ──
  // Optional ISO datetime string interpreted in `timezone`. When omitted,
  // the campaign has no scheduled send (existing "send on activation"
  // behaviour). The timezone defaults to Asia/Singapore server-side.
  sendAt?: string;
  timezone?: string;
}

export async function createCampaign(input: CreateCampaignInput) {
  return db.campaign.create({
    data: {
      name: input.name,
      description: input.description,
      type: input.type as any,
      appliesTo: (input.appliesTo || "BOTH") as any,
      targetTier: input.targetTier,
      targetCategory: input.targetCategory,
      maxRedemptions: input.maxRedemptions,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
      createdById: input.createdById,
      createdByName: input.createdByName,
      // Phase 2 Fix 10 — content editor fields (optional, additive)
      subjectLine: input.subjectLine || null,
      bodyText: input.bodyText || null,
      bodyHtml: input.bodyHtml || null,
      smsText: input.smsText || null,
      // Fix 21 — scheduled send (additive). `sendAt` is stored as UTC
      // (Prisma DateTime is always UTC); the original timezone string is
      // persisted alongside so the UI can render the wall-clock time in
      // the user's chosen zone rather than always defaulting to SG.
      // Defaults to Asia/Singapore when timezone is empty (matches the
      // Prisma column default).
      sendAt: input.sendAt ? new Date(input.sendAt) : null,
      timezone: input.timezone?.trim() || "Asia/Singapore",
      discountRule: {
        create: {
          discountType: input.discountType as any,
          discountValue: input.discountValue,
          minOrderValueCents: input.minOrderValueCents,
          maxDiscountCapCents: input.maxDiscountCapCents,
          stackable: input.stackable ?? false,
          eligibility: (input.eligibility || "ANY") as any,
          minAutonomyLevel: input.minAutonomyLevel,
          maxAutonomyLevel: input.maxAutonomyLevel,
        },
      },
    },
    include: { discountRule: true },
  });
}

export async function getCampaigns(filters?: {
  status?: string;
  type?: string;
}) {
  const where: Record<string, unknown> = {};
  if (filters?.status) where.status = filters.status;
  if (filters?.type) where.type = filters.type;

  return db.campaign.findMany({
    where,
    include: {
      discountRule: true,
      _count: { select: { codes: true, redemptions: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getCampaign(id: string) {
  return db.campaign.findUnique({
    where: { id },
    include: {
      discountRule: true,
      codes: { orderBy: { createdAt: "desc" }, take: 50 },
      _count: { select: { codes: true, redemptions: true } },
    },
  });
}

export async function updateCampaign(id: string, data: Record<string, unknown>) {
  const { discountRule, ...campaignData } = data;

  return db.$transaction(async (tx) => {
    const updated = await tx.campaign.update({
      where: { id },
      data: campaignData,
    });

    if (discountRule) {
      await tx.discountRule.upsert({
        where: { campaignId: id },
        create: { ...discountRule, campaignId: id },
        update: discountRule,
      });
    }

    return tx.campaign.findUnique({
      where: { id },
      include: { discountRule: true },
    });
  });
}

// ── State transitions ──

export async function transitionCampaignStatus(
  id: string,
  newStatus: CampaignStatus
) {
  const campaign = await db.campaign.findUnique({ where: { id } });
  if (!campaign) throw new Error("Campaign not found");

  const validTransitions: Record<string, string[]> = {
    DRAFT: ["ACTIVE"],
    ACTIVE: ["PAUSED", "ENDED"],
    PAUSED: ["ACTIVE", "ENDED"],
    ENDED: [],
  };

  const allowed = validTransitions[campaign.status] || [];
  if (!allowed.includes(newStatus)) {
    throw new Error(
      `Cannot transition from ${campaign.status} to ${newStatus}. Allowed: ${allowed.join(", ") || "none"}`
    );
  }

  return db.campaign.update({
    where: { id },
    data: { status: newStatus },
  });
}

// ── Code generation ──

function generateCode(prefix?: string, length = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing chars (0/O, 1/I)
  let code = "";
  for (let i = 0; i < length; i++) {
    code += chars[crypto.randomInt(chars.length)];
  }
  return prefix ? `${prefix}-${code}` : code;
}

export async function generateSingleCode(
  campaignId: string,
  options?: {
    code?: string; // manual entry
    maxUses?: number;
    expiresAt?: string;
  }
) {
  const code = options?.code?.toUpperCase() || generateCode();

  // Check uniqueness
  const existing = await db.discountCode.findUnique({ where: { code } });
  if (existing) throw new Error(`Code ${code} already exists`);

  return db.discountCode.create({
    data: {
      code,
      campaignId,
      maxUses: options?.maxUses,
      usesRemaining: options?.maxUses,
      expiresAt: options?.expiresAt ? new Date(options.expiresAt) : null,
    },
  });
}

export async function generateBulkCodes(
  campaignId: string,
  options: {
    quantity: number;
    prefix?: string;
    codeLength?: number;
    maxUses?: number;
    expiresAt?: string;
  }
) {
  const batchId = `batch-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const codes: string[] = [];
  const usedCodes = new Set<string>();

  for (let i = 0; i < options.quantity; i++) {
    let code: string;
    do {
      code = generateCode(options.prefix, options.codeLength || 8);
    } while (usedCodes.has(code));
    usedCodes.add(code);
    codes.push(code);
  }

  // Bulk insert
  await db.discountCode.createMany({
    data: codes.map((code) => ({
      code,
      campaignId,
      batchId,
      maxUses: options.maxUses,
      usesRemaining: options.maxUses,
      expiresAt: options.expiresAt ? new Date(options.expiresAt) : null,
    })),
  });

  return { batchId, codes, count: codes.length };
}

// ── Redemption validation ──

export interface RedemptionResult {
  valid: boolean;
  reason?: string;
  discountCents?: number;
  campaignId?: string;
  codeId?: string;
}

export async function validateRedemption(params: {
  code: string;
  householdId: string;
  orderValueCents: number; // the job amount or subscription fee
  orderType: "job" | "subscription";
  category?: string;
  existingDiscountApplied?: boolean; // for stackable check
}): Promise<RedemptionResult> {
  const { code, householdId, orderValueCents, orderType, category, existingDiscountApplied } = params;

  // 1. Code exists
  const discountCode = await db.discountCode.findUnique({
    where: { code: code.toUpperCase() },
    include: {
      campaign: { include: { discountRule: true } },
    },
  });

  if (!discountCode) {
    return { valid: false, reason: "Code not found" };
  }

  // 2. Security: targeted voucher assigned to a different household
  // (closes the gap where any household could redeem another's targeted voucher)
  if (
    discountCode.assignedHouseholdId !== null &&
    discountCode.assignedHouseholdId !== householdId
  ) {
    return { valid: false, reason: "This voucher was not issued to your household" };
  }

  // 3. Suspended (isActive=false) — distinguish from REVOKED using Voucher.status.
  //    Look up the household's Voucher row: if status==="REVOKED" → removed;
  //    if status==="CLAIMED" but isActive=false → suspended (e.g. ops pause).
  if (!discountCode.isActive) {
    const voucher = await db.voucher.findUnique({
      where: {
        householdId_discountCodeId: {
          householdId,
          discountCodeId: discountCode.id,
        },
      },
      select: { status: true },
    }).catch(() => null);

    if (voucher?.status === "REVOKED") {
      return { valid: false, reason: "This voucher has been removed" };
    }
    return { valid: false, reason: "This voucher has been temporarily suspended" };
  }

  // 4. Expired
  if (discountCode.expiresAt && new Date() > discountCode.expiresAt) {
    return { valid: false, reason: "This voucher has expired" };
  }

  // 5. Usage limit reached — but distinguish "you already redeemed" from
  //    "the code is exhausted globally". If the household has a prior
  //    CodeRedemption for this code, surface the more accurate reason.
  if (discountCode.usesRemaining !== null && discountCode.usesRemaining <= 0) {
    const priorRedemption = await db.codeRedemption.findFirst({
      where: { discountCodeId: discountCode.id, householdId },
      select: { id: true },
    });
    if (priorRedemption) {
      return { valid: false, reason: "You have already redeemed this voucher" };
    }
    return { valid: false, reason: "This voucher's usage limit has been reached" };
  }

  const { campaign } = discountCode;
  const rule = campaign.discountRule;

  // 6. Campaign state — distinguish paused / not-yet-started / ended
  if (campaign.status !== "ACTIVE") {
    if (campaign.status === "PAUSED") {
      return { valid: false, reason: "This campaign is paused" };
    }
    return { valid: false, reason: `This campaign is ${campaign.status.toLowerCase()}` };
  }

  const now = new Date();
  if (campaign.startDate && now < campaign.startDate) {
    return { valid: false, reason: "This voucher is not yet active" };
  }
  if (campaign.endDate && now > campaign.endDate) {
    return { valid: false, reason: "This voucher has expired" };
  }

  // 7. Campaign-level cap
  if (campaign.maxRedemptions !== null && campaign.redemptionsCount >= campaign.maxRedemptions) {
    return { valid: false, reason: "This voucher's usage limit has been reached" };
  }

  // 8. Applies to this order type
  if (campaign.appliesTo === "SUBSCRIPTION_FEE" && orderType !== "subscription") {
    return { valid: false, reason: "This code applies to subscription fees only" };
  }
  if (campaign.appliesTo === "JOB_COMMISSION" && orderType !== "job") {
    return { valid: false, reason: "This code applies to job orders only" };
  }

  // 9. Target category check
  if (campaign.targetCategory && category && campaign.targetCategory !== category) {
    return { valid: false, reason: `This voucher is for ${campaign.targetCategory} only` };
  }

  // 10. Eligibility check
  if (rule) {
    if (rule.eligibility === "FIRST_TIME_HOUSEHOLD_ONLY") {
      const existingBookings = await db.booking.count({
        where: { task: { householdId } },
      });
      if (existingBookings > 0) {
        return { valid: false, reason: "This offer is for first-time households only" };
      }
    } else if (rule.eligibility === "EXISTING_HOUSEHOLD") {
      const existingBookings = await db.booking.count({
        where: { task: { householdId } },
      });
      if (existingBookings === 0) {
        return { valid: false, reason: "This offer is for existing households only" };
      }
    }

    // 11. Min order value — surface the user's current order value too
    if (rule.minOrderValueCents && orderValueCents < rule.minOrderValueCents) {
      return {
        valid: false,
        reason: `Minimum order value is $${(rule.minOrderValueCents / 100).toFixed(2)} — your order is $${(orderValueCents / 100).toFixed(2)}`,
      };
    }

    // 12. Stackable check
    if (existingDiscountApplied && !rule.stackable) {
      return { valid: false, reason: "Another discount is already applied and this code is not stackable" };
    }
  }

  // 13. Calculate discount
  let discountCents = 0;
  if (rule) {
    if (rule.discountType === "PERCENTAGE") {
      discountCents = Math.round((orderValueCents * rule.discountValue) / 100);
      if (rule.maxDiscountCapCents) {
        discountCents = Math.min(discountCents, rule.maxDiscountCapCents);
      }
    } else {
      // FIXED_AMOUNT
      discountCents = Math.round(rule.discountValue * 100);
      discountCents = Math.min(discountCents, orderValueCents); // can't discount more than the order
    }
  }

  return {
    valid: true,
    reason: "applied",
    discountCents,
    campaignId: campaign.id,
    codeId: discountCode.id,
  };
}

// ── Apply redemption (write to DB) ──

export async function applyRedemption(params: {
  code: string;
  householdId: string;
  discountCents: number;
  campaignId: string;
  codeId: string;
  bookingId?: string;
  subscriptionId?: string;
}) {
  return db.$transaction(async (tx) => {
    // Decrement uses remaining
    const code = await tx.discountCode.findUnique({
      where: { id: params.codeId },
    });
    if (code && code.usesRemaining !== null) {
      await tx.discountCode.update({
        where: { id: params.codeId },
        data: { usesRemaining: code.usesRemaining - 1 },
      });
    }

    // Increment campaign redemption count
    await tx.campaign.update({
      where: { id: params.campaignId },
      data: { redemptionsCount: { increment: 1 } },
    });

    // Write redemption record
    const redemption = await tx.codeRedemption.create({
      data: {
        discountCodeId: params.codeId,
        campaignId: params.campaignId,
        householdId: params.householdId,
        bookingId: params.bookingId,
        subscriptionId: params.subscriptionId,
        discountAppliedCents: params.discountCents,
      },
    });

    // Phase 3 FIX (C1): If a Voucher exists for this household+code, mark it as USED
    // + record VOUCHER_USED + CODE_REDEEMED attribution + campaign events
    const voucher = await tx.voucher.findUnique({
      where: {
        householdId_discountCodeId: {
          householdId: params.householdId,
          discountCodeId: params.codeId,
        },
      },
    }).catch(() => null);

    if (voucher) {
      await tx.voucher.update({
        where: { id: voucher.id },
        data: { status: "USED", usedAt: new Date() },
      });
    }

    // Record attribution (CODE_REDEEMED or VOUCHER_USED depending on whether a voucher existed)
    await tx.campaignAttribution.create({
      data: {
        householdId: params.householdId,
        campaignId: params.campaignId,
        taskId: params.bookingId || null,
        touchpoint: voucher ? "VOUCHER_USED" : "CODE_REDEEMED",
        weight: 1.0,
      },
    }).catch(() => {}); // non-fatal — attribution is analytics, not transactional

    // Record campaign event
    await tx.campaignEvent.create({
      data: {
        campaignId: params.campaignId,
        householdId: params.householdId,
        eventType: "VOUCHER_REDEEMED",
        metadata: { code: params.code, discountCents: params.discountCents, taskId: params.bookingId },
      },
    }).catch(() => {});

    // Update household acquisition source if this is their first redemption
    const household = await tx.household.findUnique({
      where: { id: params.householdId },
    });
    if (household && household.acquisitionSource === "ORGANIC") {
      await tx.household.update({
        where: { id: params.householdId },
        data: {
          acquisitionSource: "PUBLIC_CODE",
          acquisitionCampaignId: params.campaignId,
        },
      });
    }

    return redemption;
  });
}

// ── Campaign performance stats ──

export async function getCampaignStats(campaignId: string) {
  const [redemptions, totalDiscount, bySource] = await Promise.all([
    db.codeRedemption.count({ where: { campaignId } }),
    db.codeRedemption.aggregate({
      where: { campaignId },
      _sum: { discountAppliedCents: true },
    }),
    db.codeRedemption.groupBy({
      by: ["householdId"],
      where: { campaignId },
    }),
  ]);

  // Get acquisition sources for households that redeemed
  const householdIds = bySource.map((r) => r.householdId);
  const households = await db.household.findMany({
    where: { id: { in: householdIds } },
    select: { acquisitionSource: true },
  });

  const sourceBreakdown = households.reduce<Record<string, number>>((acc, h) => {
    acc[h.acquisitionSource] = (acc[h.acquisitionSource] || 0) + 1;
    return acc;
  }, {});

  return {
    totalRedemptions: redemptions,
    totalDiscountCents: totalDiscount._sum.discountAppliedCents || 0,
    uniqueHouseholds: households.length,
    sourceBreakdown,
  };
}
