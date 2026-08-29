import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { TaskStatus, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client";
import { updateHouseholdCachedStats } from "@/lib/marketing/behaviour-engine";

// POST /api/j/share/[token]/deliver
// No-auth — the shareToken IS the auth. Driver clicks "Deliver Laundry".
// Sets booking.status = "delivered", task.status = COMPLETED.
const deliverSchema = z.object({
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

    // Only LAUNDRY tasks use the deliver step
    if (booking.task.category !== "LAUNDRY") {
      return NextResponse.json({ error: "Deliver is only available for laundry tasks" }, { status: 400 });
    }

    // Only collected bookings can be delivered
    if (booking.status !== "collected") {
      return NextResponse.json(
        { error: `Cannot deliver — current status is "${booking.status}". Laundry must be collected first.` },
        { status: 409 }
      );
    }

    const now = new Date();
    const body = await request.json().catch(() => ({}));
    const parsed = deliverSchema.safeParse(body);

    const updated = await db.$transaction(async (tx) => {
      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: "delivered",
          actualEnd: now,
          completedAt: now,
          completionNotes: parsed.success ? parsed.data.notes : undefined,
        },
      });

      // Set task to COMPLETED (triggers verification flow for household)
      await tx.task.update({
        where: { id: booking.task.id },
        data: { status: TaskStatus.COMPLETED, completedAt: now },
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
            title: "Laundry Delivered",
            body: `Your laundry has been delivered. Please verify the service to release payment.`,
            status: NotificationStatus.PENDING,
            referenceType: "task",
            referenceId: booking.task.id,
          },
        });
      }

      return updatedBooking;
    });

    // Phase 1 P1-4 fix: refresh cached household marketing stats (post-commit,
    // non-fatal — task completion must succeed even if the stats refresh fails).
    try {
      await updateHouseholdCachedStats(booking.task.householdId);
    } catch (statsErr) {
      console.error("[share/deliver] updateHouseholdCachedStats failed:", statsErr);
    }

    return NextResponse.json({ booking: updated });
  } catch (error) {
    console.error("POST /api/j/share/[token]/deliver error:", error);
    return NextResponse.json({ error: "Failed to deliver laundry" }, { status: 500 });
  }
}
