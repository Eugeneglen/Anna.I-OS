import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getHouseholdSession } from "@/lib/household-auth";
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

    const updatedAddon = await db.bookingAddon.update({
      where: { id: addonId },
      data: {
        status: isApproved ? "approved" : "rejected",
        approvedById: session.memberId,
        approvedAt: isApproved ? now : null,
        rejectedAt: !isApproved ? now : null,
      },
    });

    // ── When approved: create addon escrow entry ──
    let newTotalCents = addon.booking.task.amountCents;
    if (isApproved) {
      // Sum all approved addons for this booking
      const approvedAddons = await db.bookingAddon.findMany({
        where: {
          bookingId,
          status: "approved",
        },
        select: { amountCents: true },
      });

      const addonTotalCents = approvedAddons.reduce((sum, a) => sum + a.amountCents, 0);
      const baseAmountCents = addon.booking.task.amountCents;
      newTotalCents = baseAmountCents + addonTotalCents;

      // Create a new EscrowLedger entry for the addon amount
      const commissionRate = 10.0;
      const addonCommissionCents = Math.round(addon.amountCents * commissionRate / 100);
      const addonVendorPayoutCents = addon.amountCents - addonCommissionCents;

      await db.escrowLedger.create({
        data: {
          taskId: addon.booking.taskId,
          bookingId,
          amountCents: addon.amountCents,
          state: "HELD",
          commissionRate,
          commissionCents: addonCommissionCents,
          vendorPayoutCents: addonVendorPayoutCents,
        },
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
