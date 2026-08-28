/**
 * Service Recovery Voucher Service
 * =================================
 *
 * Compensation voucher workflow for dispute resolution:
 *   - issueCompensationVoucher(): issue a marketing voucher as compensation
 *     (and optionally a partial cash refund — "mixed mode")
 *   - suspendCompensationVoucher(): temporarily deactivate the voucher's
 *     discount code (reversible)
 *   - reactivateCompensationVoucher(): re-activate a suspended voucher
 *   - removeCompensationVoucher(): permanently revoke the voucher (delegates
 *     to the existing revokeVoucher in voucher-engine.ts)
 *
 * CRITICAL CONTRACT:
 *   - This module MUST NOT modify processRefund() or restoreVoucherOnCancellation().
 *   - It reuses issueVoucher() + createCampaign() + revokeVoucher() as-is.
 *   - The resolve_voucher action in the escrow API route is a 5th action ADDED
 *     to the existing enum; the existing 4 actions (release, resolve_dismiss,
 *     resolve_refund, partial_refund) are unchanged.
 *
 * 2x CAP RULE:
 *   voucherAmountCents + (refundAmountCents || 0) <= 2 * orderTotalCents.
 *   Enforced both here (RefundError-style) and in the route handler (422).
 */

import { db } from "@/lib/db";
import { RefundError } from "@/lib/payments/refund-service";
import { processRefund } from "@/lib/payments/refund-service";
import { issueVoucher, revokeVoucher } from "@/lib/marketing/voucher-engine";
import { createCampaign } from "@/lib/marketing/campaign-service";

// ── Types ──

export interface IssueCompensationVoucherParams {
  householdId: string;
  taskId: string;
  escrowLedgerId: string;
  voucherAmountCents: number; // required, > 0
  refundAmountCents?: number; // optional, for mixed mode (cash portion)
  reason: string;
  issuedById: string;
  issuedByName: string;
  expiryDays?: number; // default 90
  idempotencyKey: string;
  orderTotalCents: number; // sum of all escrow entries' amountCents (for 2x cap)
}

export interface IssueCompensationVoucherResult {
  voucherId: string;
  code: string;
  campaignId: string;
  expiresAt: Date;
  cashRefundId?: string;
  isDuplicate: boolean;
}

// ── Helpers ──

function computeExpiry(expiryDays?: number): Date {
  const days = Math.max(1, Math.min(365, expiryDays ?? 90));
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

// ── Main: issue a compensation voucher (and optionally a partial cash refund) ──

export async function issueCompensationVoucher(
  params: IssueCompensationVoucherParams
): Promise<IssueCompensationVoucherResult> {
  // ── 1. Validate amounts ──
  if (!params.voucherAmountCents || params.voucherAmountCents <= 0) {
    throw new RefundError(
      "Voucher amount must be greater than 0",
      400,
      "INVALID_VOUCHER_AMOUNT"
    );
  }

  // ── 2. Validate 2× cap ──
  const cash = params.refundAmountCents || 0;
  const totalCompensation = params.voucherAmountCents + cash;
  const cap = 2 * params.orderTotalCents;
  if (totalCompensation > cap) {
    throw new RefundError(
      `Total compensation (voucher $${(params.voucherAmountCents / 100).toFixed(2)} + cash $${(cash / 100).toFixed(2)}) exceeds the 2× order value cap ($${(cap / 100).toFixed(2)})`,
      422,
      "COMPENSATION_CAP_EXCEEDED"
    );
  }

  // ── 3. Idempotency: look for an existing voucher issued from this escrow
  // with a matching idempotency key. We don't have a dedicated column for the
  // idempotency key, so we encode it in the campaign name (deterministic).
  // A campaign name match + issuedFromEscrowId match → this is a replay.
  const idempotencyMarker = `[idem:${params.idempotencyKey}]`;
  const existingVoucher = await db.voucher.findFirst({
    where: {
      issuedFromEscrowId: params.escrowLedgerId,
      campaign: {
        name: { contains: idempotencyMarker },
      },
    },
    include: {
      discountCode: { select: { code: true } },
      campaign: { select: { id: true, name: true } },
    },
  });
  if (existingVoucher) {
    return {
      voucherId: existingVoucher.id,
      code: existingVoucher.discountCode.code,
      campaignId: existingVoucher.campaignId,
      expiresAt: existingVoucher.expiresAt ?? new Date(),
      isDuplicate: true,
    };
  }

  // ── 4. Mixed mode: optional cash refund FIRST ──
  // Reuse processRefund as-is (NOT modified). Capture the refundId.
  let cashRefundId: string | undefined;
  if (cash > 0) {
    const refundResult = await processRefund({
      escrowLedgerId: params.escrowLedgerId,
      refundAmountCents: cash,
      reason: `${params.reason} (mixed mode — cash portion)`,
      issuedById: params.issuedById,
      issuedByName: params.issuedByName,
      idempotencyKey: `${params.idempotencyKey}-cash`,
    });
    cashRefundId = refundResult.refundId;
  }

  // ── 5. Look up the task to get jobNo (for campaign name) ──
  const task = await db.task.findUnique({
    where: { id: params.taskId },
    select: { jobNo: true, category: true },
  });
  const jobNoLabel = task?.jobNo ?? "AI-????????";
  const voucherDollarsNum = params.voucherAmountCents / 100;
  const voucherDollars = voucherDollarsNum.toFixed(2);
  const campaignName = `Service Recovery — #${jobNoLabel} — $${voucherDollars} ${idempotencyMarker}`;

  // ── 6. Create the SERVICE_RECOVERY campaign ──
  // status: ACTIVE so the voucher is immediately redeemable at checkout.
  // maxRedemptions: 1 (single-use). discountValue: voucher amount in dollars.
  const expiresAt = computeExpiry(params.expiryDays);
  const campaign = await createCampaign({
    name: campaignName,
    description: `Compensation voucher issued for task #${jobNoLabel}. Reason: ${params.reason}`,
    type: "SERVICE_RECOVERY",
    appliesTo: "JOB_COMMISSION",
    maxRedemptions: 1,
    discountType: "FIXED_AMOUNT",
    discountValue: voucherDollarsNum,
    eligibility: "ANY",
    createdById: params.issuedById,
    createdByName: params.issuedByName,
  });
  // createCampaign accepts status via default (DRAFT). For service-recovery
  // campaigns we want them ACTIVE immediately so the voucher can be redeemed.
  // Use transitionCampaignStatus to flip DRAFT → ACTIVE.
  if (campaign.status !== "ACTIVE") {
    const { transitionCampaignStatus } = await import("@/lib/marketing/campaign-service");
    await transitionCampaignStatus(campaign.id, "ACTIVE");
  }

  // ── 7. Issue the voucher via the existing voucher-engine ──
  const issued = await issueVoucher({
    householdId: params.householdId,
    campaignId: campaign.id,
    customExpiry: expiresAt,
  });

  // ── 8. Update the Voucher row with the 4 audit fields ──
  await db.voucher.update({
    where: { id: issued.voucherId },
    data: {
      issuedFromEscrowId: params.escrowLedgerId,
      issuedFromTaskId: params.taskId,
      issuedById: params.issuedById,
      issuedByName: params.issuedByName,
      compensationReason: params.reason,
    },
  });

  // ── 9. Update EscrowLedger (voucherCompensationCents + disputeResolution note) ──
  const existingResolution = await db.escrowLedger.findUnique({
    where: { id: params.escrowLedgerId },
    select: { disputeResolution: true, voucherCompensationCents: true },
  });
  const priorResolution = existingResolution?.disputeResolution ?? "";
  const priorVoucherCents = existingResolution?.voucherCompensationCents ?? 0;
  const newResolutionAppendix = `Compensated by voucher $${voucherDollars} (code ${issued.code})${cash > 0 ? ` + cash $${(cash / 100).toFixed(2)}` : ""}`;
  const mergedResolution = priorResolution
    ? `${priorResolution} | ${newResolutionAppendix}`
    : newResolutionAppendix;

  await db.escrowLedger.update({
    where: { id: params.escrowLedgerId },
    data: {
      voucherCompensationCents: priorVoucherCents + params.voucherAmountCents,
      disputeResolution: mergedResolution,
    },
  });

  // ── 10. Write audit log ──
  await db.auditLog.create({
    data: {
      userId: params.issuedById,
      userName: params.issuedByName,
      action: "DISPUTE_COMPENSATED_VOUCHER",
      entityType: "escrow_ledger",
      entityId: params.escrowLedgerId,
      metadata: {
        voucherId: issued.voucherId,
        code: issued.code,
        campaignId: campaign.id,
        voucherAmountCents: params.voucherAmountCents,
        refundAmountCents: cash,
        cashRefundId: cashRefundId ?? null,
        taskId: params.taskId,
        orderTotalCents: params.orderTotalCents,
        reason: params.reason,
        expiresAt: expiresAt.toISOString(),
      },
    },
  });

  return {
    voucherId: issued.voucherId,
    code: issued.code,
    campaignId: campaign.id,
    expiresAt,
    cashRefundId,
    isDuplicate: false,
  };
}

// ── Suspend a compensation voucher (reversible) ──

export async function suspendCompensationVoucher(
  voucherId: string,
  reason: string
): Promise<void> {
  const voucher = await db.voucher.findUnique({
    where: { id: voucherId },
    select: { discountCodeId: true, issuedFromEscrowId: true, issuedById: true, issuedByName: true },
  });
  if (!voucher) throw new RefundError("Voucher not found", 404, "VOUCHER_NOT_FOUND");
  if (!voucher.issuedFromEscrowId) {
    throw new RefundError(
      "Voucher is not a compensation voucher — cannot suspend",
      400,
      "NOT_A_COMPENSATION_VOUCHER"
    );
  }

  await db.$transaction(async (tx) => {
    // Deactivate the discount code so it won't validate at checkout
    await tx.discountCode.update({
      where: { id: voucher.discountCodeId },
      data: { isActive: false },
    });

    await tx.auditLog.create({
      data: {
        userId: voucher.issuedById,
        userName: voucher.issuedByName ?? "ops",
        action: "VOUCHER_SUSPENDED",
        entityType: "voucher",
        entityId: voucherId,
        metadata: {
          voucherId,
          reason,
          issuedFromEscrowId: voucher.issuedFromEscrowId,
        },
      },
    });
  });
}

// ── Reactivate a suspended voucher ──

export async function reactivateCompensationVoucher(
  voucherId: string
): Promise<void> {
  const voucher = await db.voucher.findUnique({
    where: { id: voucherId },
    select: { discountCodeId: true, issuedFromEscrowId: true, issuedById: true, issuedByName: true, status: true },
  });
  if (!voucher) throw new RefundError("Voucher not found", 404, "VOUCHER_NOT_FOUND");
  if (!voucher.issuedFromEscrowId) {
    throw new RefundError(
      "Voucher is not a compensation voucher — cannot reactivate",
      400,
      "NOT_A_COMPENSATION_VOUCHER"
    );
  }
  if (voucher.status === "REVOKED") {
    throw new RefundError(
      "Cannot reactivate a permanently revoked voucher",
      400,
      "VOUCHER_ALREADY_REVOKED"
    );
  }

  await db.$transaction(async (tx) => {
    await tx.discountCode.update({
      where: { id: voucher.discountCodeId },
      data: { isActive: true },
    });

    await tx.auditLog.create({
      data: {
        userId: voucher.issuedById,
        userName: voucher.issuedByName ?? "ops",
        action: "VOUCHER_REACTIVATED",
        entityType: "voucher",
        entityId: voucherId,
        metadata: {
          voucherId,
          issuedFromEscrowId: voucher.issuedFromEscrowId,
        },
      },
    });
  });
}

// ── Permanently revoke (reuse existing revokeVoucher + write audit) ──

export async function removeCompensationVoucher(
  voucherId: string,
  reason: string
): Promise<void> {
  const voucher = await db.voucher.findUnique({
    where: { id: voucherId },
    select: { issuedFromEscrowId: true, issuedById: true, issuedByName: true },
  });
  if (!voucher) throw new RefundError("Voucher not found", 404, "VOUCHER_NOT_FOUND");
  if (!voucher.issuedFromEscrowId) {
    throw new RefundError(
      "Voucher is not a compensation voucher — use the standard revoke flow instead",
      400,
      "NOT_A_COMPENSATION_VOUCHER"
    );
  }

  // Reuse the existing revokeVoucher (does NOT modify it).
  // revokeVoucher sets Voucher.status = REVOKED + DiscountCode.isActive = false
  // + writes a VOUCHER_REVOKED campaign event.
  await revokeVoucher(voucherId, reason);

  // Append our service-recovery-specific audit row
  await db.auditLog.create({
    data: {
      userId: voucher.issuedById,
      userName: voucher.issuedByName ?? "ops",
      action: "VOUCHER_REMOVED",
      entityType: "voucher",
      entityId: voucherId,
      metadata: {
        voucherId,
        reason,
        issuedFromEscrowId: voucher.issuedFromEscrowId,
      },
    },
  });
}
