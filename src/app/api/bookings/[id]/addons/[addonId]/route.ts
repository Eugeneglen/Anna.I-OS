import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getHouseholdSession } from "@/lib/household-auth";
import { getCommissionRate } from "@/lib/commission";
import { recordEscrowHoldEffect } from "@/lib/payments/escrow-effects";
import { calculateOrderTotal } from "@/lib/payments/calculations";
import {
  NotificationChannel,
  NotificationEventType,
  NotificationStatus,
  RecipientType,
} from "@prisma/client";

const patchAddonSchema = z.object({
  action: z.enum(["approve", "reject"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; addonId: string }> }
) {
  try {
    // ── Auth: household session ──
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: bookingId, addonId } = await params;

    // ── Parse body ──
    const body = await request.json();
    const parsed = patchAddonSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const { action } = parsed.data;

    // ── Validate addon exists and belongs to the right booking ──
    const addon = await db.bookingAddon.findUnique({
      where: { id: addonId },
      include: {
        booking: {
          select: {
            id: true,
            taskId: true,
            vendorId: true,
            task: {
              select: {
                id: true,
                householdId: true,
                category: true,
                amountCents: true,
                discountCents: true,
                finalAmountCents: true,
              },
            },
          },
        },
      },
    });

    if (!addon) {
      return NextResponse.json(
        { error: "Addon not found" },
        { status: 404 }
      );
    }

    // Verify addon belongs to the specified booking
    if (addon.bookingId !== bookingId) {
      return NextResponse.json(
        { error: "Addon does not belong to this booking" },
        { status: 400 }
      );
    }

    // Verify the booking belongs to the user's household
    if (addon.booking.task.householdId !== session.householdId) {
      return NextResponse.json(
        { error: "You do not have permission to manage this addon" },
        { status: 403 }
      );
    }

    // Only pending addons can be approved/rejected
    if (addon.status !== "pending") {
      return NextResponse.json(
        { error: `Addon is already "${addon.status}" and cannot be ${action}d` },
        { status: 409 }
      );
    }

    // ── Update addon ──
    const now = new Date();
    const isApproved = action === "approve";

    // ── P9B-F04 (Phase 9, Section B): guarded transition ──
    // The `addon.status !== "pending"` check above is check-then-write: two
    // parallel approvals both pass it and both create an escrow entry
    // (verified live: 200/200, two HELD rows — a double charge). The fix is
    // the same F19 pattern the escrow core uses: the state transition itself
    // is the guard — an atomic updateMany conditioned on status:"pending".
    // Exactly one racer transitions (count=1) and proceeds to create the
    // escrow entry; the loser gets count=0 → 409, no charge.
    const transitioned = await db.bookingAddon.updateMany({
      where: { id: addonId, status: "pending" },
      data: {
        status: isApproved ? "approved" : "rejected",
        approvedById: session.memberId,
        approvedAt: isApproved ? now : null,
        rejectedAt: !isApproved ? now : null,
      },
    });
    if (transitioned.count === 0) {
      return NextResponse.json(
        { error: `Addon is already processed and cannot be ${action}d (a concurrent request won)` },
        { status: 409 }
      );
    }
    const updatedAddon = await db.bookingAddon.findUnique({ where: { id: addonId } });

    // ── When approved: create addon escrow entry ──
    //
    // Add-on money model (Service/Pricing/Availability Authority):
    //   Vendor proposes → household approves → SERVER composes the final
    //   total through calculateOrderTotal() (payments/calculations.ts —
    //   "the authoritative figure all 4 roles should display"). The base
    //   is the customer-approved task amount (finalAmountCents, falling
    //   back to amountCents only for legacy rows), NOT the pre-discount
    //   amount — so the quoted total matches what the household actually
    //   approved and what escrow holds. The add-on itself remains a
    //   separately attributable escrow event: the vendor never
    //   overwrites the original service price or the approved booking
    //   amount; each approved add-on adds its own ledger row.
    let newTotalCents = addon.booking.task.finalAmountCents || addon.booking.task.amountCents;
    if (isApproved) {
      // Sum all approved addons for this booking
      const approvedAddons = await db.bookingAddon.findMany({
        where: {
          bookingId,
          status: "approved",
        },
        select: { amountCents: true },
      });

      const orderTotal = calculateOrderTotal({
        baseAmountCents: addon.booking.task.finalAmountCents || addon.booking.task.amountCents,
        addonAmountsCents: approvedAddons.map((a) => a.amountCents),
      });
      newTotalCents = orderTotal.orderTotalCents;

      // Create a new EscrowLedger entry for the addon amount
      // ── Commission single source of truth (FIX-1c) ──
      // Previously hard-coded 10.0 here, duplicating PLATFORM_COMMISSION_RATE
      // and ignoring the Ops-controlled PlatformConfig "commission_rate".
      // Now sourced from getCommissionRate() (60s-cached, falls back to the
      // compiled constant).
      const commissionRate = await getCommissionRate();
      const addonCommissionCents = Math.round(addon.amountCents * commissionRate / 100);
      const addonVendorPayoutCents = addon.amountCents - addonCommissionCents;

      const addonEscrowEntry = await db.escrowLedger.create({
        data: {
          taskId: addon.booking.taskId,
          bookingId,
          amountCents: addon.amountCents,
          originalAmountCents: 0,     // addons don't have discounts — 0 = no discount
          discountCents: 0,
          discountFundedBy: "PLATFORM",
          state: "HELD",
          commissionRate,
          commissionCents: addonCommissionCents,
          vendorPayoutCents: addonVendorPayoutCents,
        },
      });

      // ── Payment adapter effect (FIX-1c wiring) ──
      // Hold/authorize the add-on charge through the provider-agnostic
      // PaymentService (NoOp today — Pending Payment Gateway Decision).
      // Ledger-authoritative: called after the row is committed, never
      // throws, adapter failures are logged as reconciliation cases.
      await recordEscrowHoldEffect({
        escrowLedgerId: addonEscrowEntry.id,
        taskId: addon.booking.taskId,
        bookingId,
        amountCents: addon.amountCents,
      });
    }

    // ── Notify vendor about the approval/rejection ──
    const amountStr = `SGD $${(addon.amountCents / 100).toFixed(2)}`;

    // Fetch household name for vendor notification context
    const household = await db.household.findUnique({
      where: { id: addon.booking.task.householdId },
      select: { name: true },
    });

    const householdName = household?.name || "Customer";

    await db.notification.create({
      data: {
        householdId: addon.booking.task.householdId,
        vendorId: addon.booking.vendorId,
        recipientType: RecipientType.VENDOR,
        channel: NotificationChannel.WEB_PUSH,
        eventType: isApproved
          ? NotificationEventType.ADDON_APPROVED
          : NotificationEventType.ADDON_REJECTED,
        title: isApproved
          ? `Addon Approved — ${amountStr}`
          : `Addon Rejected — ${amountStr}`,
        body: isApproved
          ? `${householdName} has approved the additional charge: "${addon.description}". New total: SGD $${(newTotalCents / 100).toFixed(2)}`
          : `${householdName} has rejected the additional charge: "${addon.description}"`,
        status: NotificationStatus.PENDING,
        referenceType: "booking",
        referenceId: bookingId,
      },
    });

    // Also update the member's original addon notification status to READ
    await db.notification.updateMany({
      where: {
        householdId: addon.booking.task.householdId,
        recipientType: RecipientType.HOUSEHOLD_MEMBER,
        eventType: NotificationEventType.ADDON_REQUESTED,
        referenceType: "task",
        referenceId: addon.booking.taskId,
        status: NotificationStatus.PENDING,
      },
      data: {
        status: NotificationStatus.READ,
        readAt: now,
      },
    });

    return NextResponse.json({
      addon: updatedAddon,
      newTotalCents: isApproved ? newTotalCents : undefined,
    });
  } catch (error) {
    console.error(
      "PATCH /api/bookings/[id]/addons/[addonId] error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to update addon" },
      { status: 500 }
    );
  }
}
