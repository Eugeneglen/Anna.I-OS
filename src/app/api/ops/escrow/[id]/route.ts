import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOpsSession, hasMinRole } from "@/lib/ops-auth";
import { TaskStatus, EscrowState, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client";
import { emitEscrowStateChanged, emitDisputeResolved } from "@/lib/events";
import { processRefund, RefundError } from "@/lib/payments/refund-service";
import { issueCompensationVoucher } from "@/lib/marketing/service-recovery";
import { isPlatformFundedDiscount, payoutBaseCents } from "@/lib/payments/calculations";

const escrowActionSchema = z.object({
  action: z.enum(["release", "resolve_dismiss", "resolve_refund", "partial_refund", "resolve_voucher"]),
  resolution: z.string().max(500).optional(),
  // For partial_refund: the amount to refund (cents). Required for partial_refund.
  refundAmountCents: z.number().int().positive().optional(),
  // Idempotency key for refund operations (client-supplied, prevents duplicates).
  idempotencyKey: z.string().min(1).max(200).optional(),
  // For resolve_voucher: the voucher amount (cents). Required for resolve_voucher.
  voucherAmountCents: z.number().int().positive().optional(),
  // For resolve_voucher: optional refund amount (mixed mode) — issued
  // as REFUND_CREDIT store credit per policy R3 §3.4.
  voucherRefundAmountCents: z.number().int().nonnegative().optional(),
  // For resolve_voucher: voucher expiry in days (default 90, min 1, max 365).
  voucherExpiryDays: z.number().int().min(1).max(365).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only ADMIN and COORDINATOR can manage escrow
    if (!hasMinRole(session.role, "COORDINATOR")) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const parsed = escrowActionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const { action, resolution, refundAmountCents, idempotencyKey,
            voucherAmountCents, voucherRefundAmountCents, voucherExpiryDays } = parsed.data;

    // Fetch escrow with task and household
    const escrow = await db.escrowLedger.findUnique({
      where: { id },
      include: {
        task: {
          include: {
            household: { select: { id: true, name: true } },
          },
        },
        booking: {
          include: {
            vendor: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!escrow) {
      return NextResponse.json({ error: "Escrow entry not found" }, { status: 404 });
    }

    const task = escrow.task;
    if (!task) {
      return NextResponse.json({ error: "Associated task not found" }, { status: 404 });
    }

    const now = new Date();

    // ── ACTION: Release Escrow ──
    if (action === "release") {
      if (escrow.state !== EscrowState.HELD) {
        return NextResponse.json(
          { error: `Escrow cannot be released — current state is ${escrow.state}` },
          { status: 409 }
        );
      }

      if (task.status !== TaskStatus.VERIFIED && task.status !== TaskStatus.COMPLETED && task.status !== TaskStatus.ESCROW_RELEASED) {
        return NextResponse.json(
          { error: `Task must be VERIFIED, COMPLETED, or ESCROW_RELEASED to release escrow — current status is ${task.status}` },
          { status: 409 }
        );
      }

      const result = await db.$transaction(async (tx) => {
        // Fix: Release ALL HELD escrow entries for this task (base + add-ons),
        // not just the one identified by `id`. Same pattern as the dispute
        // action — all entries must be released together.
        //
        // F19: each entry update is GUARDED on state=HELD — a concurrent
        // release/dispute on the same entry can't double-transition or
        // double-notify (B15). Zero entries claimed → someone else won.
        const allHeldEntries = await tx.escrowLedger.findMany({
          where: { taskId: task.id, state: EscrowState.HELD },
          select: {
            id: true, amountCents: true, vendorPayoutCents: true,
            discountCents: true, originalAmountCents: true,
            commissionRate: true, refundCents: true, discountFundedBy: true,
            commissionCents: true,
          },
        });
        let claimedCount = 0;
        // ── Payout-base heal (platform-funded discounts) ──
        // Entries created before the payout-base business rule carry
        // commission/payout computed on the post-discount cash. They haven't
        // been paid yet (still HELD), so recompute them on the payout base
        // at release — honoring the rule immediately without a data
        // migration. No-op for entries already on the new math (identical
        // values), and never applied to non-discounted entries.
        let subsidyDrawnCents = 0;
        let payoutBaseTotalCents = 0;
        let payoutTotalCents = 0;
        let commissionTotalCents = 0;
        // f3-family (police-payout-base-1): audit totals track CLAIMED
        // entries only — a partial claim (concurrent winner on an entry)
        // must not inflate the subsidy bookkeeping.
        let escrowCashTotalCents = 0;
        let discountTotalCents = 0;
        let originalTotalCents = 0;
        const claimedEntryIds: string[] = [];
        for (const entry of allHeldEntries) {
          // Shared predicate (was hand-inlined — police INFO).
          const platformFunded = isPlatformFundedDiscount(entry);
          const payoutBase = payoutBaseCents(entry);
          let commissionCents = entry.commissionCents;
          let vendorPayoutCents = entry.vendorPayoutCents;
          if (platformFunded) {
            const effectiveBase = Math.max(0, payoutBase - (entry.refundCents || 0));
            commissionCents = Math.round((effectiveBase * entry.commissionRate) / 100);
            vendorPayoutCents = effectiveBase - commissionCents;
          }
          const claimed = await tx.escrowLedger.updateMany({
            where: { id: entry.id, state: EscrowState.HELD },
            data: {
              state: EscrowState.RELEASED, releasedAt: now,
              ...(platformFunded ? { commissionCents, vendorPayoutCents } : {}),
            },
          });
          if (claimed.count > 0) {
            claimedCount += claimed.count;
            claimedEntryIds.push(entry.id);
            subsidyDrawnCents += Math.max(0, payoutBase - entry.amountCents);
            payoutBaseTotalCents += payoutBase;
            payoutTotalCents += vendorPayoutCents;
            commissionTotalCents += commissionCents;
            escrowCashTotalCents += entry.amountCents;
            discountTotalCents += entry.discountCents || 0;
            originalTotalCents += entry.originalAmountCents || 0;
          }
        }
        if (claimedCount === 0) {
          throw new Error("ESCROW_ALREADY_RESOLVED");
        }
        const updatedEscrow = await tx.escrowLedger.findUnique({ where: { id } });

        const updatedTask = await tx.task.update({
          where: { id: task.id },
          data: { status: TaskStatus.ESCROW_RELEASED, escrowReleasedAt: now },
        });

        // Create audit log (figures = claimed entries only)
        await tx.auditLog.create({
          data: {
            userId: session.userId,
            userName: session.name,
            action: "ESCROW_RELEASE",
            entityType: "EscrowLedger",
            entityId: id,
            metadata: {
              taskId: task.id,
              amountCents: escrowCashTotalCents,
              originalAmountCents: originalTotalCents,
              discountCents: discountTotalCents,
              entriesReleased: claimedCount,
              resolution: resolution || "Released by ops",
              // Payout-base context (platform-funded discount bookkeeping)
              payoutBaseCents: payoutBaseTotalCents,
              vendorPayoutTotalCents: payoutTotalCents,
              commissionTotalCents,
              platformSubsidyDrawnCents: subsidyDrawnCents,
            },
          },
        });

        // ── PLATFORM_SUBSIDY_DRAWN: first-class ledger event ──
        // Every release that pays a vendor more than the escrow held (the
        // platform-funded discount portion) must be auditable, otherwise
        // the ledger reconciliation Σ releases ≠ Σ held breaks with no
        // explanation. Only written when a subsidy was actually drawn.
        if (subsidyDrawnCents > 0) {
          await tx.auditLog.create({
            data: {
              userId: session.userId,
              userName: session.name,
              action: "PLATFORM_SUBSIDY_DRAWN",
              entityType: "EscrowLedger",
              entityId: id,
              metadata: {
                taskId: task.id,
                entryIds: claimedEntryIds,
                platformSubsidyDrawnCents: subsidyDrawnCents,
                escrowCashReleasedCents: escrowCashTotalCents,
                payoutBaseCents: payoutBaseTotalCents,
                vendorPayoutTotalCents: payoutTotalCents,
                commissionTotalCents,
                reason: "Platform-funded discount paid out at release (vendor paid on full job value)",
              },
            },
          });
        }

        // Notify household members
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
              eventType: NotificationEventType.ESCROW_RELEASED,
              title: "Payment Released",
              // f5 (police-payout-base-1): POST-heal total payout across the
              // released entries (the pre-tx escrow row carries the stale,
              // lower old-math figure on healed rows) — same semantics as the
              // household release route's notification.
              body: `Payment of SGD $${(payoutTotalCents / 100).toFixed(2)} has been released to the vendor for your ${task.category.toLowerCase()} task.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          });
        }

        return { updatedTask, updatedEscrow };
      });

      // Fire-and-forget: push real-time event to household
      // f5 (police-payout-base-1): emit the POST-heal payout for this entry.
      emitEscrowStateChanged({
        id,
        state: "RELEASED",
        previousState: "HELD",
        amountCents: escrow.amountCents,
        category: task.category,
        householdId: task.householdId,
        householdName: task.household?.name,
        vendorPayoutCents: result.updatedEscrow?.vendorPayoutCents ?? escrow.vendorPayoutCents,
      }).catch(() => {});

      return NextResponse.json({ task: result.updatedTask, escrow: result.updatedEscrow });
    }

    // ── ACTION: Resolve Dispute (Dismiss) — reset to HELD, task back to COMPLETED ──
    if (action === "resolve_dismiss") {
      if (escrow.state !== EscrowState.DISPUTED) {
        return NextResponse.json(
          { error: `Escrow is not in DISPUTED state — current state is ${escrow.state}` },
          { status: 409 }
        );
      }

      if (task.status !== TaskStatus.DISPUTED) {
        return NextResponse.json(
          { error: `Task is not DISPUTED — current status is ${task.status}` },
          { status: 409 }
        );
      }

      const result = await db.$transaction(async (tx) => {
        // Fix: Reset ALL escrow entries for this task to HELD (not just
        // the one identified by `id`). The dispute action disputes ALL
        // entries (base + add-ons), so dismiss must reset ALL of them.
        // Otherwise the add-on entries stay DISPUTED and can never be
        // released.
        //
        // F19: guarded on state=DISPUTED (B15) — zero claims → concurrent
        // resolution won; nothing written, clean 409.
        const dismissed = await tx.escrowLedger.updateMany({
          where: { taskId: task.id, state: EscrowState.DISPUTED },
          data: {
            state: EscrowState.HELD,
            disputeResolution: resolution || "Dispute dismissed by ops",
            disputeResolvedBy: session.name,
            disputeResolvedAt: now,
          },
        });
        if (dismissed.count === 0) {
          throw new Error("ESCROW_ALREADY_RESOLVED");
        }
        const updatedEscrow = await tx.escrowLedger.findUnique({ where: { id } });

        // Unpause autonomy
        await tx.householdCategoryAutonomy.updateMany({
          where: {
            householdId: task.householdId,
            category: task.category,
            promotionPaused: true,
          },
          data: { promotionPaused: false },
        });

        // Reset task to COMPLETED (allowing re-verification)
        const updatedTask = await tx.task.update({
          where: { id: task.id },
          data: { status: TaskStatus.COMPLETED },
        });

        // Audit log
        await tx.auditLog.create({
          data: {
            userId: session.userId,
            userName: session.name,
            action: "DISPUTE_DISMISSED",
            entityType: "EscrowLedger",
            entityId: id,
            metadata: {
              taskId: task.id,
              disputeReason: escrow.disputeReason,
              resolution: resolution || "Dispute dismissed by ops",
            },
          },
        });

        // Notify household members
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
              eventType: NotificationEventType.DISPUTE_RESOLVED,
              title: "Dispute Resolved",
              body: `The dispute on your ${task.category.toLowerCase()} task has been reviewed and dismissed. The task is now pending verification.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          });
        }

        return { updatedTask, updatedEscrow };
      });

      // Fire-and-forget: push real-time event to household
      emitDisputeResolved({
        taskId: task.id,
        householdId: task.householdId,
        householdName: task.household?.name,
        category: task.category,
        resolution: "dismissed",
        escrowAmountCents: escrow.amountCents,
      }).catch(() => {});
      emitEscrowStateChanged({
        id,
        state: "HELD",
        previousState: "DISPUTED",
        amountCents: escrow.amountCents,
        category: task.category,
        householdId: task.householdId,
        householdName: task.household?.name,
        disputeResolution: resolution || "Dispute dismissed by ops",
      }).catch(() => {});

      return NextResponse.json({ task: result.updatedTask, escrow: result.updatedEscrow });
    }

    // ── ACTION: Resolve Dispute (Refund) — set escrow to REFUNDED ──
    if (action === "resolve_refund") {
      if (escrow.state !== EscrowState.DISPUTED) {
        return NextResponse.json(
          { error: `Escrow is not in DISPUTED state — current state is ${escrow.state}` },
          { status: 409 }
        );
      }

      if (task.status !== TaskStatus.DISPUTED) {
        return NextResponse.json(
          { error: `Task is not DISPUTED — current status is ${task.status}` },
          { status: 409 }
        );
      }

      // IMPORTANT #1 (police review): delegate to processRefund for the FULL
      // remaining amount. This ensures resolve_refund produces the SAME state
      // as partial_refund-with-full-amount: refundCents set, commission/payout
      // recalculated to 0, Refund audit row created, task → DISPUTE_CLOSED.
      // A server-generated idempotency key makes this call idempotent per
      // escrow+timestamp (but the old "Refund" button is a one-shot action —
      // retrying it after success is blocked by the state guard above).
      const fullRemainingCents = escrow.amountCents - escrow.refundCents;

      // ── f6a (police-payout-base-1): zero-cash entries ──
      // A 100% platform-funded discount holds amountCents = 0, so the "full
      // remaining refund" is 0 — processRefund rejects amounts ≤ 0, which
      // dead-ended resolve_refund on these disputes (400 INVALID_AMOUNT).
      // Terminalize directly instead: full-refund semantics with no cash
      // movement (commission/payout → 0, vendor paid nothing, no Refund row
      // and no refund credit — the household paid no cash). The consumed
      // promo voucher is restored below, exactly like the normal full-refund
      // path, so the household is made whole.
      if (fullRemainingCents <= 0) {
        const zeroCash = await db.$transaction(async (tx) => {
          const claimed = await tx.escrowLedger.updateMany({
            where: { id, state: EscrowState.DISPUTED },
            data: {
              state: EscrowState.REFUNDED,
              refundedAt: now,
              commissionCents: 0,
              vendorPayoutCents: 0,
              disputeResolution: resolution || "Dispute upheld — full refund (no cash held)",
              disputeResolvedBy: session.name,
              disputeResolvedAt: now,
            },
          });
          if (claimed.count === 0) {
            throw new Error("ESCROW_ALREADY_RESOLVED");
          }

          // Close the task only when every OTHER entry is also resolved
          // (same rule as processRefund's add-on handling).
          const unresolved = await tx.escrowLedger.findMany({
            where: { taskId: task.id, state: EscrowState.DISPUTED, id: { not: id } },
            select: { id: true },
          });
          let taskClosed = false;
          if (unresolved.length === 0) {
            await tx.task.update({
              where: { id: task.id },
              data: { status: TaskStatus.DISPUTE_CLOSED },
            });
            taskClosed = true;
            // Unpause autonomy (household shouldn't be penalised)
            await tx.householdCategoryAutonomy.updateMany({
              where: {
                householdId: task.householdId,
                category: task.category,
                promotionPaused: true,
              },
              data: { promotionPaused: false },
            });
          }

          await tx.auditLog.create({
            data: {
              userId: session.userId,
              userName: session.name,
              action: "DISPUTE_REFUNDED",
              entityType: "EscrowLedger",
              entityId: id,
              metadata: {
                taskId: task.id,
                refundId: null,
                zeroCashEntry: true,
                amountCents: escrow.amountCents,
                payoutBaseCents: escrow.originalAmountCents || escrow.amountCents,
                commissionZeroedCents: escrow.commissionCents,
                payoutZeroedCents: escrow.vendorPayoutCents,
                taskClosed,
                resolution: resolution || "Dispute upheld — full refund (no cash held)",
              },
            },
          });

          return { taskClosed };
        });

        // Notify household members (no credit — no cash was ever held)
        const members = await db.familyMember.findMany({
          where: { householdId: task.householdId },
          select: { id: true },
        });
        for (const member of members) {
          await db.notification.create({
            data: {
              householdId: task.householdId,
              recipientType: RecipientType.HOUSEHOLD_MEMBER,
              memberId: member.id,
              channel: NotificationChannel.WHATSAPP,
              eventType: NotificationEventType.DISPUTE_RESOLVED,
              title: "Refund Issued",
              body: `Your dispute on the ${task.category.toLowerCase()} task has been upheld. No cash payment was held for this booking${task.discountCodeId ? " — your original promo voucher has been restored" : ""}.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          }).catch(() => {});
        }

        emitDisputeResolved({
          taskId: task.id,
          householdId: task.householdId,
          householdName: task.household?.name,
          category: task.category,
          resolution: "refunded",
          escrowAmountCents: escrow.amountCents,
        }).catch(() => {});
        emitEscrowStateChanged({
          id,
          state: "REFUNDED",
          previousState: "DISPUTED",
          amountCents: escrow.amountCents,
          category: task.category,
          householdId: task.householdId,
          householdName: task.household?.name,
          disputeResolution: resolution || "Dispute upheld — refund issued",
        }).catch(() => {});

        // Restore the consumed promo voucher (same as the normal full-refund
        // path — non-fatal; ops can restore manually on failure)
        if (task.discountCodeId) {
          try {
            const { restoreVoucherOnCancellation } = await import("@/lib/marketing/voucher-engine");
            await restoreVoucherOnCancellation(task.id);
          } catch (restoreError) {
            console.error("[escrow resolve_refund zero-cash] Failed to restore voucher:", restoreError);
          }
        }

        return NextResponse.json({
          refund: {
            refundId: null, // no Refund row — no cash was moved
            refundedCents: 0,
            cumulativeRefundCents: escrow.refundCents,
            effectiveAmountCents: 0,
            remainingCashCents: 0,
            newCommissionCents: 0,
            newVendorPayoutCents: 0,
            escrowState: EscrowState.REFUNDED,
            taskStatus: zeroCash.taskClosed ? TaskStatus.DISPUTE_CLOSED : TaskStatus.DISPUTED,
            paymentProviderRefundId: "",
            paymentStatus: "succeeded",
            isFullyRefunded: true,
            isDuplicate: false,
            zeroCashEntry: true,
          },
          creditCode: null,
          escrow: await db.escrowLedger.findUnique({ where: { id } }),
        });
      }

      try {
        const refundResult = await processRefund({
          escrowLedgerId: id,
          refundAmountCents: fullRemainingCents,
          reason: resolution || "Dispute upheld — full refund issued by ops",
          issuedById: session.userId,
          issuedByName: session.name,
          idempotencyKey: `resolve-refund-${id}-${Date.now()}`,
        });

        // ── F18 (R3): the refund converts to store credit — no cash path.
        // Keyed on the Refund row id (unique per refund event) so a retry
        // after a partial failure can never double-issue.
        let creditCode: string | null = null;
        try {
          const { issueRefundCreditVoucher } = await import("@/lib/marketing/refund-credit");
          const credit = await issueRefundCreditVoucher({
            householdId: task.householdId,
            taskId: task.id,
            creditAmountCents: refundResult.refundedCents,
            reason: resolution || "Dispute upheld — refunded as credit",
            idempotencyKey: `refund-credit-${refundResult.refundId}`,
            escrowLedgerId: id,
            issuedById: session.userId,
            issuedByName: session.name,
          });
          creditCode = credit.code;
        } catch (creditError) {
          // Refund itself succeeded; credit issuance is retry-safe (unique
          // Refund id in the key) — surface loudly for ops follow-up.
          console.error("[escrow resolve_refund] refund-credit issuance failed:", creditError);
        }

        // Notify household members of the refund
        const members = await db.familyMember.findMany({
          where: { householdId: task.householdId },
          select: { id: true },
        });
        for (const member of members) {
          await db.notification.create({
            data: {
              householdId: task.householdId,
              recipientType: RecipientType.HOUSEHOLD_MEMBER,
              memberId: member.id,
              channel: NotificationChannel.WHATSAPP,
              eventType: NotificationEventType.DISPUTE_RESOLVED,
              title: "Refund Issued as Credit",
              body: `Your dispute on the ${task.category.toLowerCase()} task has been upheld. SGD $${(refundResult.cumulativeRefundCents / 100).toFixed(2)} has been refunded as Anna.I credit${creditCode ? ` (code ${creditCode})` : ""} — it's in your wallet, valid for 12 months.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          }).catch(() => {});
        }

        // Fire-and-forget: push real-time event to household
        emitDisputeResolved({
          taskId: task.id,
          householdId: task.householdId,
          householdName: task.household?.name,
          category: task.category,
          resolution: "refunded",
          escrowAmountCents: escrow.amountCents,
        }).catch(() => {});
        emitEscrowStateChanged({
          id,
          state: "REFUNDED",
          previousState: "DISPUTED",
          amountCents: escrow.amountCents,
          category: task.category,
          householdId: task.householdId,
          householdName: task.household?.name,
          disputeResolution: resolution || "Dispute upheld — refund issued",
        }).catch(() => {});

        // Phase 3: Restore voucher if the task had a discount code applied
        // This is non-fatal — if the restore fails, the voucher stays USED
        // (the household can contact ops to restore it manually)
        if (task.discountCodeId) {
          try {
            const { restoreVoucherOnCancellation } = await import("@/lib/marketing/voucher-engine");
            await restoreVoucherOnCancellation(task.id);
          } catch (restoreError) {
            console.error("[escrow resolve_refund] Failed to restore voucher:", restoreError);
          }
        }

        return NextResponse.json({
          refund: refundResult,
          creditCode,
          escrow: await db.escrowLedger.findUnique({ where: { id } }),
        });
      } catch (e) {
        if (e instanceof RefundError) {
          return NextResponse.json(
            { error: e.message, code: e.code },
            { status: e.statusCode }
          );
        }
        throw e;
      }
    }

    // ── ACTION: Partial Refund — refund a portion of the held amount ──
    // Recalculates commission/payout on the adjusted (remaining) amount.
    // Idempotent: same idempotencyKey returns the original result (no double refund).
    // F18 (R3, sub-decision 3.1): partials ALSO convert to credit — prorated.
    if (action === "partial_refund") {
      // Validate required params
      if (!refundAmountCents) {
        return NextResponse.json(
          { error: "refundAmountCents is required for partial_refund" },
          { status: 400 }
        );
      }
      if (!idempotencyKey) {
        return NextResponse.json(
          { error: "idempotencyKey is required for partial_refund" },
          { status: 400 }
        );
      }

      try {
        const refundResult = await processRefund({
          escrowLedgerId: id,
          refundAmountCents,
          reason: resolution || "Partial refund issued by ops",
          issuedById: session.userId,
          issuedByName: session.name,
          idempotencyKey,
        });

        // F18 (R3 §3.1): partial refunds convert to prorated credit.
        // Same Refund-row-id idempotency key as resolve_refund.
        let creditCode: string | null = null;
        try {
          const { issueRefundCreditVoucher } = await import("@/lib/marketing/refund-credit");
          const credit = await issueRefundCreditVoucher({
            householdId: task.householdId,
            taskId: task.id,
            creditAmountCents: refundAmountCents,
            reason: resolution || "Partial refund — credited",
            idempotencyKey: `refund-credit-${refundResult.refundId}`,
            escrowLedgerId: id,
            issuedById: session.userId,
            issuedByName: session.name,
          });
          creditCode = credit.code;
        } catch (creditError) {
          console.error("[escrow partial_refund] refund-credit issuance failed:", creditError);
        }

        // Notify household members of the refund
        const members = await db.familyMember.findMany({
          where: { householdId: task.householdId },
          select: { id: true },
        });
        for (const member of members) {
          await db.notification.create({
            data: {
              householdId: task.householdId,
              recipientType: RecipientType.HOUSEHOLD_MEMBER,
              memberId: member.id,
              channel: NotificationChannel.WHATSAPP,
              eventType: NotificationEventType.DISPUTE_RESOLVED,
              title: refundResult.isFullyRefunded ? "Refund Issued as Credit" : "Partial Refund Issued as Credit",
              body: refundResult.isFullyRefunded
                ? `Your dispute on the ${task.category.toLowerCase()} task has been upheld. SGD $${(refundResult.cumulativeRefundCents / 100).toFixed(2)} has been refunded as Anna.I credit${creditCode ? ` (code ${creditCode})` : ""}.`
                // remainingCashCents = the household's remaining stake in escrow
                // (NOT the effective payout base, which is the vendor-side view)
                : `A partial refund of SGD $${(refundResult.refundedCents / 100).toFixed(2)} has been credited to your wallet${creditCode ? ` (code ${creditCode})` : ""} for your ${task.category.toLowerCase()} task. Remaining payable: SGD $${(refundResult.remainingCashCents / 100).toFixed(2)}.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          }).catch(() => {}); // non-critical
        }

        return NextResponse.json({
          refund: refundResult,
          creditCode,
          escrow: await db.escrowLedger.findUnique({ where: { id } }),
        });
      } catch (e) {
        if (e instanceof RefundError) {
          return NextResponse.json(
            { error: e.message, code: e.code },
            { status: e.statusCode }
          );
        }
        throw e;
      }
    }

    // ── ACTION: Resolve Dispute (Voucher) — issue a marketing voucher as
    // compensation, then release the escrow to the vendor (vendor gets paid).
    // Optionally also issues a partial refund (mixed mode) — F18/R3 §3.4:
    // the refund portion converts to REFUND_CREDIT store credit (no cash path).
    // Does NOT modify the existing 4 actions — this is a 5th action added to the enum.
    if (action === "resolve_voucher") {
      // Validate required params for resolve_voucher
      if (!voucherAmountCents) {
        return NextResponse.json(
          { error: "voucherAmountCents is required for resolve_voucher" },
          { status: 400 }
        );
      }
      if (!idempotencyKey) {
        return NextResponse.json(
          { error: "idempotencyKey is required for resolve_voucher" },
          { status: 400 }
        );
      }
      if (!resolution || resolution.trim().length === 0) {
        return NextResponse.json(
          { error: "resolution (reason) is required for resolve_voucher" },
          { status: 400 }
        );
      }

      // Validate escrow + task state
      if (escrow.state !== EscrowState.DISPUTED) {
        return NextResponse.json(
          { error: `Escrow is not in DISPUTED state — current state is ${escrow.state}` },
          { status: 409 }
        );
      }
      if (task.status !== TaskStatus.DISPUTED) {
        return NextResponse.json(
          { error: `Task is not DISPUTED — current status is ${task.status}` },
          { status: 409 }
        );
      }

      // Compute orderTotal = sum of ALL escrow entries' amountCents for this task
      // (base + add-ons, NOT just this entry).
      const allEscrowEntries = await db.escrowLedger.findMany({
        where: { taskId: task.id },
        select: { id: true, amountCents: true, state: true },
      });
      const orderTotalCents = allEscrowEntries.reduce(
        (s, e) => s + e.amountCents, 0
      );

      // 2x cap validation (also enforced in the service layer, but we do it
      // here to give a clean 422 before any state changes).
      // F19/E7: CUMULATIVE — includes prior compensation vouchers AND refund
      // credits already granted on this escrow (sequential calls with fresh
      // idempotency keys can no longer each grant the full 2×).
      const cash = voucherRefundAmountCents || 0;
      const priorGranted = (escrow.voucherCompensationCents || 0) + (escrow.refundCreditCents || 0);
      if (priorGranted + voucherAmountCents + cash > 2 * orderTotalCents) {
        return NextResponse.json(
          {
            error: `Total compensation would exceed the 2× order value cap ($${((2 * orderTotalCents) / 100).toFixed(2)}): already granted $${(priorGranted / 100).toFixed(2)}, requesting $${(((voucherAmountCents + cash) / 100)).toFixed(2)}.`,
            code: "COMPENSATION_CAP_EXCEEDED",
          },
          { status: 422 }
        );
      }

      // police-2b f6: consent pre-check — a consent-OFF household cannot
      // receive SERVICE_RECOVERY vouchers (policy "keep as-is"), and without
      // this check the whole action would 500 mid-issuance. Offer the
      // policy-clean alternative up-front: resolve_refund (credit is
      // transactional and consent-exempt).
      const consentRow = await db.household.findUnique({
        where: { id: task.householdId },
        select: { marketingConsent: true },
      });
      if (consentRow?.marketingConsent === false) {
        return NextResponse.json(
          {
            error:
              "This household has opted out of marketing communications, so a compensation (service-recovery) voucher cannot be issued. Use Full refund instead — refunds convert to refund credit, which is the household's own money and is not gated by consent.",
            code: "HOUSEHOLD_CONSENT_OFF",
          },
          { status: 422 }
        );
      }

      // ── police-2c f1: claim-first concurrency guard ──
      //
      // Live-proven hole: two PARALLEL resolve_voucher calls both passed the
      // read-only state checks, both issued vouchers (E7 cap bypassed via
      // read-then-write counter, double notifications). Fix: atomically
      // claim the resolution BEFORE any issuance — updateMany with a
      // state=DISPUTED + disputeResolvedAt=null precondition. Exactly one
      // parallel caller wins; the loser gets a clean 409 with zero writes.
      //
      // Failure semantics: if issuance fails AFTER the claim, the entry
      // stays DISPUTED (resolvable via dismiss / refund paths — those don't
      // require disputeResolvedAt=null) but resolve_voucher retries 409.
      // Safe-by-construction: no double issuance is possible.
      const claim = await db.escrowLedger.updateMany({
        where: { id, state: EscrowState.DISPUTED, disputeResolvedAt: null },
        data: { disputeResolvedAt: now },
      });
      if (claim.count === 0) {
        return NextResponse.json(
          {
            error: "This dispute was already resolved (or is being resolved right now) — refresh to see the current state.",
            code: "ESCROW_ALREADY_RESOLVED",
          },
          { status: 409 }
        );
      }

      try {
        const result = await issueCompensationVoucher({
          householdId: task.householdId,
          taskId: task.id,
          escrowLedgerId: id,
          voucherAmountCents,
          refundAmountCents: cash > 0 ? cash : undefined,
          reason: resolution,
          issuedById: session.userId,
          issuedByName: session.name,
          expiryDays: voucherExpiryDays,
          idempotencyKey,
          orderTotalCents,
        });

        // After success: set ALL DISPUTED escrow entries → RELEASED (vendor paid).
        // F19: guarded per-entry on state=DISPUTED (B15), and E5 terminal
        // guard — if ANY entry for this task is REFUNDED (cannot happen on
        // the current credit-only path, but defensively), the task must end
        // DISPUTE_CLOSED, not ESCROW_RELEASED (inconsistent terminal state:
        // "released" task with vendor paid 0).
        //
        // Payout-base heal (same rule as the release action): platform-
        // discounted entries are recomputed on the full pre-discount value
        // so the vendor is paid in full. No-op for entries already on the
        // new math; non-discounted entries are never touched.
        await db.$transaction(async (tx) => {
          const disputedEntries = await tx.escrowLedger.findMany({
            where: { taskId: task.id, state: EscrowState.DISPUTED },
            select: {
              id: true, amountCents: true, discountCents: true,
              originalAmountCents: true, commissionRate: true,
              refundCents: true, discountFundedBy: true,
              commissionCents: true, vendorPayoutCents: true,
            },
          });
          const now = new Date();
          let subsidyDrawnCents = 0;
          let subsidyPayoutTotalCents = 0;
          const subsidyEntryIds: string[] = [];
          for (const entry of disputedEntries) {
            // Shared predicate (was hand-inlined — police INFO).
            const platformFunded = isPlatformFundedDiscount(entry);
            const payoutBase = payoutBaseCents(entry);
            let commissionCents = entry.commissionCents;
            let vendorPayoutCents = entry.vendorPayoutCents;
            if (platformFunded) {
              const effectiveBase = Math.max(0, payoutBase - (entry.refundCents || 0));
              commissionCents = Math.round((effectiveBase * entry.commissionRate) / 100);
              vendorPayoutCents = effectiveBase - commissionCents;
            }
            const claimed = await tx.escrowLedger.updateMany({
              where: { id: entry.id, state: EscrowState.DISPUTED },
              data: {
                state: EscrowState.RELEASED,
                releasedAt: now,
                disputeResolvedBy: session.name,
                disputeResolvedAt: now,
                ...(platformFunded ? { commissionCents, vendorPayoutCents } : {}),
              },
            });
            // f3-family (police-payout-base-1): subsidy bookkeeping counts
            // only entries actually claimed.
            if (claimed.count > 0) {
              const draw = Math.max(0, payoutBase - entry.amountCents);
              if (draw > 0) {
                subsidyDrawnCents += draw;
                subsidyPayoutTotalCents += vendorPayoutCents;
                subsidyEntryIds.push(entry.id);
              }
            }
          }
          // PLATFORM_SUBSIDY_DRAWN ledger event (see release action)
          if (subsidyDrawnCents > 0) {
            await tx.auditLog.create({
              data: {
                userId: session.userId,
                userName: session.name,
                action: "PLATFORM_SUBSIDY_DRAWN",
                entityType: "EscrowLedger",
                entityId: id,
                metadata: {
                  taskId: task.id,
                  entryIds: subsidyEntryIds,
                  platformSubsidyDrawnCents: subsidyDrawnCents,
                  vendorPayoutTotalCents: subsidyPayoutTotalCents,
                  reason: "Platform-funded discount paid out at dispute resolution (vendor paid on full job value)",
                },
              },
            });
          }
          const allEntries = await tx.escrowLedger.findMany({
            where: { taskId: task.id },
            select: { id: true, state: true },
          });
          const hasRefunded = allEntries.some((e) => e.state === EscrowState.REFUNDED);
          await tx.task.update({
            where: { id: task.id },
            data: {
              status: hasRefunded ? TaskStatus.DISPUTE_CLOSED : TaskStatus.ESCROW_RELEASED,
              escrowReleasedAt: hasRefunded ? undefined : now,
            },
          });
          // Unpause autonomy — household shouldn't be penalised
          await tx.householdCategoryAutonomy.updateMany({
            where: {
              householdId: task.householdId,
              category: task.category,
              promotionPaused: true,
            },
            data: { promotionPaused: false },
          });
        });

        // Create DISPUTE_RESOLVED notification for all household members
        const members = await db.familyMember.findMany({
          where: { householdId: task.householdId },
          select: { id: true },
        });
        const expiryDateStr = result.expiresAt.toLocaleDateString("en-SG", {
          day: "numeric", month: "short", year: "numeric",
        });
        const cashText = cash > 0
          ? ` plus SGD $${(cash / 100).toFixed(2)} refunded as Anna.I credit (code ${result.cashCreditCode ?? "pending"})`
          : "";
        for (const member of members) {
          await db.notification.create({
            data: {
              householdId: task.householdId,
              recipientType: RecipientType.HOUSEHOLD_MEMBER,
              memberId: member.id,
              channel: NotificationChannel.WHATSAPP,
              eventType: NotificationEventType.VOUCHER_COMPENSATION_ISSUED,
              title: "Dispute resolved — voucher issued",
              body: `We've issued you a SGD $${(voucherAmountCents / 100).toFixed(2)} voucher (code ${result.code}) for #${task.jobNo ?? "your task"}${cashText}. Valid until ${expiryDateStr}. Apply it at checkout on your next booking.`,
              status: NotificationStatus.PENDING,
              referenceType: "task",
              referenceId: task.id,
            },
          }).catch(() => {});
        }

        // Emit real-time events
        emitDisputeResolved({
          taskId: task.id,
          householdId: task.householdId,
          householdName: task.household?.name,
          category: task.category,
          resolution: "voucher",
          escrowAmountCents: escrow.amountCents,
        }).catch(() => {});
        emitEscrowStateChanged({
          id,
          state: "RELEASED",
          previousState: "DISPUTED",
          amountCents: escrow.amountCents,
          category: task.category,
          householdId: task.householdId,
          householdName: task.household?.name,
          disputeResolution: `Compensated by voucher ${result.code} ($${(voucherAmountCents / 100).toFixed(2)})`,
        }).catch(() => {});

        return NextResponse.json({
          voucherId: result.voucherId,
          code: result.code,
          campaignId: result.campaignId,
          expiresAt: result.expiresAt,
          cashCreditCode: result.cashCreditCode,
          isDuplicate: result.isDuplicate,
          escrowState: "RELEASED",
          escrow: await db.escrowLedger.findUnique({ where: { id } }),
        });
      } catch (e) {
        if (e instanceof RefundError) {
          return NextResponse.json(
            { error: e.message, code: e.code },
            { status: e.statusCode }
          );
        }
        throw e;
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    // F19 (B15): guarded transitions abort with this sentinel when a
    // concurrent resolution won the race — clean 409, zero side effects.
    if (error instanceof Error && error.message === "ESCROW_ALREADY_RESOLVED") {
      return NextResponse.json(
        {
          error: "Escrow entries were already resolved by a concurrent action — refresh to see the current state.",
          code: "ESCROW_ALREADY_RESOLVED",
        },
        { status: 409 }
      );
    }
    console.error("[/api/ops/escrow/[id] PATCH]", error);
    return NextResponse.json(
      { error: "Failed to process escrow action" },
      { status: 500 }
    );
  }
}
