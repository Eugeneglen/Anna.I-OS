import { db } from "@/lib/db";
import { EscrowState, TaskStatus } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// Phase 2 · Step 2.1 — DETERMINISTIC DISPUTE CASE BUILDER
//
// Assembles the authoritative case context for an ops dispute
// from the actual database. Rules (user spec §1/§3/§10):
//
//   1. The LLM is NEVER responsible for calculating financial
//      values — every number below comes from live DB rows.
//   2. Scope: every query is structurally filtered to the ONE
//      household/task/vendor of the disputed task. The builder
//      takes only a taskId resolved server-side; it never
//      accepts household/vendor hints from any request.
//   3. Output is structured JSON (serialisable into
//      contextSnapshot) — facts only, no narrative.
//
// The case feeds: (a) the policy eligibility engine (policy.ts),
// (b) the LLM prompt (llm.ts), (c) the Ops evidence view (UI).
// ─────────────────────────────────────────────────────────────

export interface CaseEscrowEntry {
  id: string;
  state: string;
  /** Pre-discount job value (payout base when platform-funded). */
  originalAmountCents: number | null;
  /** Current customer cash held (post-discount). */
  amountCents: number;
  discountCents: number | null;
  discountFundedBy: string | null;
  /** Cumulative household-cash refunded so far. */
  refundCents: number | null;
  commissionRate: number;
  commissionCents: number | null;
  vendorPayoutCents: number | null;
  /** Cumulative platform-promo leg reversed so far. */
  subsidyReversedCents: number | null;
  voucherCompensationCents: number | null;
  refundCreditCents: number | null;
  disputeReason: string | null;
  disputedAt: string | null;
  heldAt: string | null;
}

export interface CaseRefundEvent {
  refundId: string;
  /** Household CASH leg for this event. */
  amountCents: number;
  /** PLATFORM promo leg reversed by this event. */
  platformDiscountCents: number | null;
  reason: string;
  issuedByName: string | null;
  createdAt: string;
  paymentStatus: string | null;
}

export interface DisputeCaseData {
  caseBuiltAt: string;
  taskId: string;
  jobNo: string | null;
  householdId: string;
  householdName: string;
  vendorId: string | null;
  vendorName: string | null;
  primaryEscrowId: string | null;
  /** ── Task timeline ── */
  task: {
    category: string;
    status: string;
    instructions: string | null;
    amountCents: number;
    discountCents: number;
    timeline: {
      createdAt: string | null;
      dispatchedAt: string | null;
      acceptedAt: string | null;
      scheduledAt: string | null;
      inProgressAt: string | null;
      completedAt: string | null;
      verifiedAt: string | null;
      disputedAt: string | null;
    };
    photoVerification: {
      totalPhotos: number;
      verifiedPhotos: number;
      rejectedWithReason: number;
      latestUploadedAt: string | null;
    };
  };
  /** ── Escrow + refund ledger (all entries for the task) ── */
  escrow: {
    entries: CaseEscrowEntry[];
    totals: {
      orderTotalCashCents: number;
      totalRefundedCents: number;
      totalSubsidyReversedCents: number;
      remainingCashCents: number;
    };
  };
  /** ── Refund history (event-level, two-way split legs) ── */
  refundHistory: CaseRefundEvent[];
  /** ── Vendor history + dispute rate ── */
  vendorHistory: {
    name: string;
    vendorType: string | null;
    status: string;
    totalJobs: number;
    disputedJobs: number;
    disputeRate: number;
    avgRatingContext: string; // kept textual — ratings not on the Vendor row
  } | null;
  /** ── Household history + dispute history ── */
  householdHistory: {
    name: string;
    totalTasks: number;
    disputedTasks: number;
    disputeRate: number;
    totalSpentCents: number | null;
    marketingConsent: boolean;
    memberCount: number;
  };
}

/**
 * Build the deterministic case for a disputed task. Returns null when the
 * task does not exist or is not (any more) in a qualifying disputed state.
 *
 * "Qualifying dispute" (Phase 2 definition, §8): task.status = DISPUTED AND
 * at least one escrow entry is in DISPUTED state — i.e. a dispute awaiting
 * an ops resolution decision.
 */
export async function buildDisputeCase(taskId: string): Promise<DisputeCaseData | null> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      jobNo: true,
      householdId: true,
      category: true,
      status: true,
      instructions: true,
      amountCents: true,
      discountCents: true,
      createdAt: true,
      dispatchedAt: true,
      acceptedAt: true,
      scheduledAt: true,
      inProgressAt: true,
      completedAt: true,
      verifiedAt: true,
      disputedAt: true,
      household: { select: { id: true, name: true, totalSpentCents: true, marketingConsent: true } },
    },
  });
  if (!task) return null;

  // Escrow entries for THIS task only (base + add-ons).
  const escrowEntries = await db.escrowLedger.findMany({
    where: { taskId: task.id },
    orderBy: { createdAt: "asc" },
  });
  const disputedEntries = escrowEntries.filter((e) => e.state === EscrowState.DISPUTED);

  // Qualifying check: DISPUTED task with at least one DISPUTED escrow entry.
  if (task.status !== TaskStatus.DISPUTED || disputedEntries.length === 0) {
    return null;
  }

  // Primary entry = first DISPUTED entry (the one the existing ops dialog
  // opens on; release/dispute operate task-wide).
  const primary = disputedEntries[0];

  // Vendor: raising a dispute CANCELS the booking, so a "non-cancelled"
  // query returns nothing for disputed tasks. Resolve the vendor through
  // the authoritative link chain instead: primary escrow → bookingId →
  // vendor; fall back to the latest booking (any status). Structurally
  // scoped to THIS task either way.
  let vendor: { id: string; name: string; vendorType: string | null; status: string } | null = null;
  if (primary.bookingId) {
    const escrowBooking = await db.booking.findUnique({
      where: { id: primary.bookingId },
      select: { vendor: { select: { id: true, name: true, vendorType: true, status: true } } },
    });
    vendor = escrowBooking?.vendor ?? null;
  }
  if (!vendor) {
    const latestBooking = await db.booking.findFirst({
      where: { taskId: task.id },
      orderBy: { createdAt: "desc" },
      select: { vendor: { select: { id: true, name: true, vendorType: true, status: true } } },
    });
    vendor = latestBooking?.vendor ?? null;
  }

  // Refund history for THIS task's escrow entries (event-level rows).
  const refundRows = await db.refund.findMany({
    where: { escrowLedger: { taskId: task.id } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      amountCents: true,
      platformDiscountCents: true,
      reason: true,
      issuedByName: true,
      createdAt: true,
      stripeStatus: true,
    },
  });

  // Verification photos for THIS task.
  const photos = await db.verificationPhoto.findMany({
    where: { taskId: task.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, isVerified: true, verifiedAt: true, rejectionReason: true, createdAt: true },
  });

  // Vendor dispute rate — computed from the vendor's own booking→task joins.
  let vendorHistory: DisputeCaseData["vendorHistory"] = null;
  if (vendor) {
    const vendorBookings = await db.booking.findMany({
      where: { vendorId: vendor.id },
      select: { taskId: true, task: { select: { id: true, disputedAt: true, status: true } } },
    });
    const vendorTaskRows = vendorBookings
      .filter((b) => b.taskId !== null && b.task !== null)
      .map((b) => b.task as NonNullable<typeof b.task>);
    const totalJobs = vendorTaskRows.length;
    const disputedJobs = vendorTaskRows.filter((t) => t.disputedAt !== null).length;
    vendorHistory = {
      name: vendor.name,
      vendorType: vendor.vendorType ?? null,
      status: vendor.status,
      totalJobs,
      disputedJobs,
      disputeRate: totalJobs > 0 ? Number((disputedJobs / totalJobs).toFixed(4)) : 0,
      avgRatingContext: "ratings not stored on vendor rows",
    };
  }

  // Household dispute history — THIS household only.
  const [householdTaskAgg, memberCount] = await Promise.all([
    db.task.aggregate({
      where: { householdId: task.householdId },
      _count: { _all: true },
    }),
    db.familyMember.count({ where: { householdId: task.householdId } }),
  ]);
  const householdDisputedCount = await db.task.count({
    where: { householdId: task.householdId, disputedAt: { not: null } },
  });
  const householdTotalTasks = householdTaskAgg._count._all;

  const entries: CaseEscrowEntry[] = escrowEntries.map((e) => ({
    id: e.id,
    state: e.state,
    originalAmountCents: e.originalAmountCents ?? null,
    amountCents: e.amountCents,
    discountCents: e.discountCents ?? null,
    discountFundedBy: e.discountFundedBy ?? null,
    refundCents: e.refundCents ?? null,
    commissionRate: e.commissionRate,
    commissionCents: e.commissionCents ?? null,
    vendorPayoutCents: e.vendorPayoutCents ?? null,
    subsidyReversedCents: e.subsidyReversedCents ?? null,
    voucherCompensationCents: e.voucherCompensationCents ?? null,
    refundCreditCents: e.refundCreditCents ?? null,
    disputeReason: e.disputeReason ?? null,
    disputedAt: e.disputedAt?.toISOString() ?? null,
    heldAt: e.heldAt?.toISOString() ?? null,
  }));

  // ── Carry-forward #3 remediation (Phase 9, Section C) ──
  // VOIDED entries (e.g. the stale leg after cancel → rematch) were never
  // collected — including their amountCents in the ORDER TOTAL inflated the
  // AI advisory's refund bounds (policy.ts caps partial refunds against
  // orderTotalCashCents). Sum only LIVE money: exclude VOIDED. (REFUNDED
  // entries stay in the total: their cash WAS collected, and their
  // refundCents already nets out via totalRefundedCents → remainingCash.)
  const liveEscrowEntries = escrowEntries.filter((e) => e.state !== "VOIDED");
  const orderTotalCashCents = liveEscrowEntries.reduce((s, e) => s + e.amountCents, 0);
  const totalRefundedCents = escrowEntries.reduce((s, e) => s + (e.refundCents || 0), 0);
  const totalSubsidyReversedCents = escrowEntries.reduce(
    (s, e) => s + (e.subsidyReversedCents || 0),
    0
  );

  return {
    caseBuiltAt: new Date().toISOString(),
    taskId: task.id,
    jobNo: task.jobNo,
    householdId: task.householdId,
    householdName: task.household.name,
    vendorId: vendor?.id ?? null,
    vendorName: vendor?.name ?? null,
    primaryEscrowId: primary?.id ?? null,
    task: {
      category: task.category,
      status: task.status,
      instructions: task.instructions,
      amountCents: task.amountCents,
      discountCents: task.discountCents,
      timeline: {
        createdAt: task.createdAt?.toISOString() ?? null,
        dispatchedAt: task.dispatchedAt?.toISOString() ?? null,
        acceptedAt: task.acceptedAt?.toISOString() ?? null,
        scheduledAt: task.scheduledAt?.toISOString() ?? null,
        inProgressAt: task.inProgressAt?.toISOString() ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
        verifiedAt: task.verifiedAt?.toISOString() ?? null,
        disputedAt: task.disputedAt?.toISOString() ?? null,
      },
      photoVerification: {
        totalPhotos: photos.length,
        verifiedPhotos: photos.filter((p) => p.isVerified).length,
        rejectedWithReason: photos.filter((p) => p.rejectionReason).length,
        latestUploadedAt:
          photos.length > 0 ? photos[photos.length - 1].createdAt.toISOString() : null,
      },
    },
    escrow: {
      entries,
      totals: {
        orderTotalCashCents,
        totalRefundedCents,
        totalSubsidyReversedCents,
        remainingCashCents: Math.max(0, orderTotalCashCents - totalRefundedCents),
      },
    },
    refundHistory: refundRows.map((r) => ({
      refundId: r.id,
      amountCents: r.amountCents,
      platformDiscountCents: r.platformDiscountCents ?? null,
      reason: r.reason,
      issuedByName: r.issuedByName,
      createdAt: r.createdAt.toISOString(),
      paymentStatus: r.stripeStatus ?? null,
    })),
    vendorHistory,
    householdHistory: {
      name: task.household.name,
      totalTasks: householdTotalTasks,
      disputedTasks: householdDisputedCount,
      disputeRate:
        householdTotalTasks > 0
          ? Number((householdDisputedCount / householdTotalTasks).toFixed(4))
          : 0,
      totalSpentCents: task.household.totalSpentCents ?? null,
      marketingConsent: task.household.marketingConsent,
      memberCount,
    },
  };
}
