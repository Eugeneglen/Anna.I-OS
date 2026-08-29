import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { TaskStatus, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client";

// POST /api/j/share/[token]/collect
// No-auth — the shareToken IS the auth. Driver clicks "Collect Laundry".
// Sets booking.status = "collected" (laundry-specific step between accepted and completed).
const collectSchema = z.object({
  notes: z.string().max(1000).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const booking = await db.booking.findUnique({
      where: { shareToken: token },
      include: {
        task: { select: { id: true, status: true, category: true, householdId: true } },
      },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    // Only LAUNDRY tasks use the collect step
    if (booking.task.category !== "LAUNDRY") {
      return NextResponse.json({ error: "Collect is only available for laundry tasks" }, { status: 400 });
    }

    // Only accepted bookings can be collected
    if (booking.status !== "accepted") {
      return NextResponse.json(
        { error: `Cannot collect — current status is "${booking.status}"` },
        { status: 409 }
      );
    }

    const now = new Date();
    const body = await request.json().catch(() => ({}));
    const parsed = collectSchema.safeParse(body);

    const updated = await db.$transaction(async (tx) => {
      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: "collected",
          actualStart: now,
          completionNotes: parsed.success ? parsed.data.notes : undefined,
        },
      });

      // Notify household members
      const members = await tx.familyMember.findMany({
        where: { householdId: booking.task.householdId },
        select: { id: true },
      });

      for (const member of members) {
        await tx.notification.create({
          data: {
            householdId: booking.task.householdId,
            recipientType: RecipientType.HOUSEHOLD_MEMBER,
            memberId: member.id,
            channel: NotificationChannel.WHATSAPP,
            eventType: NotificationEventType.VENDOR_ACCEPTED,
            title: "Laundry Collected",
            body: `Your laundry has been collected by the driver and is on its way to the facility.`,
            status: NotificationStatus.PENDING,
            referenceType: "task",
            referenceId: booking.task.id,
          },
        });
      }

      return updatedBooking;
    });

    return NextResponse.json({ booking: updated });
  } catch (error) {
    console.error("POST /api/j/share/[token]/collect error:", error);
    return NextResponse.json({ error: "Failed to collect laundry" }, { status: 500 });
  }
}
