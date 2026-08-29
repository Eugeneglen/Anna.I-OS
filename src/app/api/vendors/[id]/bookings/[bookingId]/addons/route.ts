import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getVendorSession } from "@/lib/vendor-auth";
import {
  NotificationChannel,
  NotificationEventType,
  NotificationStatus,
  RecipientType,
} from "@prisma/client";

const createAddonSchema = z.object({
  description: z.string().min(1).max(500),
  amountCents: z.number().int().positive().max(10000000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; bookingId: string }> }
) {
  try {
    // ── Auth check ──
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: vendorId, bookingId } = await params;

    // Verify vendor matches session
    if (session.vendorId !== vendorId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    // ── Parse body ──
    const body = await request.json();
    const parsed = createAddonSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const { description, amountCents } = parsed.data;

    // ── Validate booking ──
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: {
        task: {
          select: {
            id: true,
            category: true,
            householdId: true,
          },
        },
        vendor: {
          select: { id: true, name: true, companyName: true },
        },
      },
    });

    if (!booking) {
      return NextResponse.json(
        { error: "Booking not found" },
        { status: 404 }
      );
    }

    if (booking.vendorId !== vendorId) {
      return NextResponse.json(
        { error: "Booking does not belong to this vendor" },
        { status: 403 }
      );
    }

    if (booking.status !== "accepted" && booking.status !== "in_progress") {
      return NextResponse.json(
        {
          error: `Cannot add charges to a booking with status "${booking.status}". Booking must be accepted or in_progress.`,
        },
        { status: 409 }
      );
    }

    // ── Create addon ──
    const addon = await db.bookingAddon.create({
      data: {
        bookingId,
        description,
        amountCents,
        status: "pending",
        addedById: vendorId,
      },
    });

    // ── Notify household members ──
    const vendorName = booking.vendor.companyName || booking.vendor.name;
    const amountStr = `SGD $${(amountCents / 100).toFixed(2)}`;
    const notifTitle = `Additional Charge — ${amountStr}`;
    const notifBody = `${vendorName}: ${description}`;

    const members = await db.familyMember.findMany({
      where: { householdId: booking.task.householdId },
      select: { id: true },
    });

    if (members.length > 0) {
      await db.notification.createMany({
        data: members.map((member) => ({
          householdId: booking.task.householdId,
          recipientType: RecipientType.HOUSEHOLD_MEMBER,
          memberId: member.id,
          channel: NotificationChannel.WEB_PUSH,
          eventType: NotificationEventType.ADDON_REQUESTED,
          title: notifTitle,
          body: notifBody,
          status: NotificationStatus.PENDING,
          referenceType: "task",
          referenceId: booking.task.id,
        })),
      });
    }

    return NextResponse.json({ addon }, { status: 201 });
  } catch (error) {
    console.error(
      "POST /api/vendors/[id]/bookings/[bookingId]/addons error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to create addon" },
      { status: 500 }
    );
  }
}
