/**
 * Refund Credit Engine (F18 / policy R3 — "Refund-as-Credit + Reissue")
 * =====================================================================
 *
 * R3 hard rule: **No cash refunds to households. Ever.** Any refund owed
 * (cancellation, dispute upheld, partial refund, resolve_voucher cash
 * portion) converts to a REFUND_CREDIT voucher for the owed amount.
 *
 * Machinery (policy §4 — deliberately mirrors the SERVICE_RECOVERY
 * container pattern in service-recovery.ts, the best-tested issuance
 * path in this codebase):
 *   1. Idempotency: deterministic marker `[idem:<key>]` embedded in the
 *      container campaign name; a replay returns the ORIGINAL voucher.
 *   2. createCampaign type=REFUND_CREDIT (system-only type — the ops
 *      manual-create zod intentionally omits it) + ACTIVE transition.
 *   3. issueVoucher() — origin derives to REFUND_CREDIT (consent-exempt,
 *      attribution-exempt, 12-month default expiry; F22).
 *   4. Stamp the Voucher audit fields + the EscrowLedger credit link
 *      (refundCreditCents += amount, refundCreditVoucherId).
 *   5. Audit log REFUND_CREDIT_ISSUED.
 *
 * Notifications: issueVoucher already notifies every household member
 * (VOUCHER_ISSUED, PDPA-safe — transactional). The container campaign
 * name carries the human context ("Refund Credit — #AI-… — $45.00").
 *
 * CRITICAL CONTRACT (same as service-recovery):
 *   - MUST NOT modify processRefund() or restoreVoucherOnCancellation().
 *   - Reuses issueVoucher() + createCampaign() as-is.
 */

import { db } from "@/lib/db";
import { issueVoucher } from "@/lib/marketing/voucher-engine";
import { createCampaign } from "@/lib/marketing/campaign-service";

export interface IssueRefundCreditParams {
  householdId: string;
  taskId: string;
  creditAmountCents: number; // required, > 0
  reason: string;
  idempotencyKey: string;
  // Escrow link — the entry (or entries) whose refund became this credit.
  // `escrowLedgerId` is the primary link stamped on the Voucher row;
  // every entry in `escrowEntries` gets refundCreditCents/refundCreditVoucherId.
  escrowLedgerId?: string;
  escrowEntries?: { id: string; amountCents: number }[];
  issuedById?: string; // ops actor when resolution is ops-driven
  issuedByName?: string;
}

export interface IssueRefundCreditResult {
  voucherId: string;
  code: string;
  campaignId: string;
  expiresAt: Date;
  isDuplicate: boolean;
}

export async function issueRefundCreditVoucher(
  params: IssueRefundCreditParams
): Promise<IssueRefundCreditResult> {
  // ── 1. Validate amount ──
  if (!params.creditAmountCents || params.creditAmountCents <= 0) {
    throw new Error("Credit amount must be greater than 0");
  }

  // ── 2. Idempotency: same marker-in-campaign-name pattern as
  // service-recovery (deterministic replay detection).
  const idempotencyMarker = `[idem:${params.idempotencyKey}]`;
  const existingVoucher = await db.voucher.findFirst({
    where: {
      origin: "REFUND_CREDIT",
      issuedFromTaskId: params.taskId,
      campaign: { name: { contains: idempotencyMarker } },
    },
    include: {
      discountCode: { select: { code: true } },
      campaign: { select: { id: true } },
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

  // ── 3. Task context for the campaign name ──
  const task = await db.task.findUnique({
    where: { id: params.taskId },
    select: { jobNo: true },
  });
  const jobNoLabel = task?.jobNo ?? "AI-????????";
  const creditDollarsNum = params.creditAmountCents / 100;
  const creditDollars = creditDollarsNum.toFixed(2);
  const campaignName = `Refund Credit — #${jobNoLabel} — $${creditDollars} ${idempotencyMarker}`;

  // ── 4. Create the REFUND_CREDIT container campaign (ACTIVE, single-use,
  //    FIXED_AMOUNT = owed money). System-only type: not creatable via the
  //    ops manual API. Expiry: issueVoucher applies the 12-month credit
  //    default (policy sub-decision 3.2) when customExpiry is absent.
  //
  //    police-2b f2 (forfeiture guard): minOrderValueCents = credit amount.
  //    Credit is single-use FIXED — without a floor, a $45 credit spent on
  //    a $20 order would burn the whole code and forfeit $25 of the
  //    household's own money. The floor (enforced by validateRedemption +
  //    getEligibleVouchers) means credit can only be spent on an order it
  //    fully covers — no partial spend, no forfeiture (policy §3.3 pilot:
  //    no stacking/split-payment; credit-as-payment-method is roadmap).
  const campaign = await createCampaign({
    name: campaignName,
    description: `Refund credit for task #${jobNoLabel}. Reason: ${params.reason}`,
    type: "REFUND_CREDIT",
    appliesTo: "JOB_COMMISSION",
    maxRedemptions: 1,
    discountType: "FIXED_AMOUNT",
    discountValue: creditDollarsNum,
    minOrderValueCents: params.creditAmountCents,
    eligibility: "ANY",
    createdById: params.issuedById,
    createdByName: params.issuedByName ?? "system (refund-as-credit)",
  });
  if (campaign.status !== "ACTIVE") {
    const { transitionCampaignStatus } = await import("@/lib/marketing/campaign-service");
    await transitionCampaignStatus(campaign.id, "ACTIVE");
  }

  // ── 5. Issue the voucher (origin derives to REFUND_CREDIT → consent-exempt,
  //    attribution-exempt, 12-month expiry; member notifications included) ──
  const issued = await issueVoucher({
    householdId: params.householdId,
    campaignId: campaign.id,
  });

  // ── 6. Stamp the Voucher audit fields (and read back the effective
  //    expiry — issueVoucher applied the 12-month credit default) ──
  const stamped = await db.voucher.update({
    where: { id: issued.voucherId },
    data: {
      issuedFromEscrowId: params.escrowLedgerId ?? null,
      issuedFromTaskId: params.taskId,
      issuedById: params.issuedById ?? null,
      issuedByName: params.issuedByName ?? null,
      compensationReason: params.reason,
    },
    select: { expiresAt: true },
  });

  // ── 7. Escrow credit link: record how much became credit on each entry ──
  const entries = params.escrowEntries?.length
    ? params.escrowEntries
    : params.escrowLedgerId
      ? [{ id: params.escrowLedgerId, amountCents: params.creditAmountCents }]
      : [];
  for (const entry of entries) {
    await db.escrowLedger.update({
      where: { id: entry.id },
      data: {
        refundCreditCents: { increment: entry.amountCents },
        refundCreditVoucherId: issued.voucherId,
      },
    }).catch(() => {}); // non-fatal — the voucher itself is the source of truth
  }

  // ── 8. Audit log (userId is an OpsUser FK — null for system/household
  //    actors; the human label lives in userName) ──
  await db.auditLog.create({
    data: {
      userId: params.issuedById ?? null,
      userName: params.issuedByName ?? "system (refund-as-credit)",
      action: "REFUND_CREDIT_ISSUED",
      entityType: "escrow_ledger",
      entityId: params.escrowLedgerId ?? params.taskId,
      metadata: {
        voucherId: issued.voucherId,
        code: issued.code,
        campaignId: campaign.id,
        creditAmountCents: params.creditAmountCents,
        taskId: params.taskId,
        escrowEntryIds: entries.map((e) => e.id),
        reason: params.reason,
      },
    },
  });

  return {
    voucherId: issued.voucherId,
    code: issued.code,
    campaignId: campaign.id,
    expiresAt: stamped.expiresAt ?? new Date(Date.now() + 365 * 86400000),
    isDuplicate: false,
  };
}
