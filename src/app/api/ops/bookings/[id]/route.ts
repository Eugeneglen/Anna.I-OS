import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { logAction } from "@/lib/audit-log";

const ALLOWED_ACTIONS = ["cancel", "reschedule", "update_notes", "update_rating"] as const;
type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

const TERMINAL_STATUSES = ["completed", "cancelled"];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const { action } = body;

    if (!action || !ALLOWED_ACTIONS.includes(action as AllowedAction)) {
      return NextResponse.json(
        { error: `Invalid action. Allowed: ${ALLOWED_ACTIONS.join(", ")}` },
        { status: 400 }
      );
    }

    // Fetch existing booking with task info
    const booking = await db.booking.findUnique({
      where: { id },
      include: {
        task: { select: { id: true, status: true } },
      },
    });

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const now = new Date();

    // --- ACTION: cancel ---
    if (action === "cancel") {
      if (TERMINAL_STATUSES.includes(booking.status)) {
        return NextResponse.json(
          { error: `Cannot cancel a booking with status "${booking.status}"` },
          { status: 409 }
        );
      }

      const previousStatus = booking.status;

      const [updatedBooking] = await db.$transaction([
        db.booking.update({
          where: { id },
          data: {
            status: "cancelled",
            cancelledAt: now,
          },
        }),
        db.task.update({
          where: { id: booking.taskId },
          data: {
            status: "CANCELLED",
            cancelledAt: now,
            ...(body.reason ? { cancelReason: body.reason as string } : {}),
          },
        }),
      ]);

      await logAction({
        userId: session.userId,
        userName: session.name,
        action: "CANCEL_BOOKING",
        entityType: "BOOKING",
        entityId: id,
        metadata: {
          previousStatus,
          reason: body.reason || null,
          taskId: booking.taskId,
        },
      });

      return NextResponse.json({ success: true, booking: updatedBooking });
    }

    // --- ACTION: reschedule ---
    if (action === "reschedule") {
      if (TERMINAL_STATUSES.includes(booking.status)) {
        return NextResponse.json(
          { error: `Cannot reschedule a booking with status "${booking.status}"` },
          { status: 409 }
        );
      }

      if (!body.scheduledStart) {
        return NextResponse.json(
          { error: "scheduledStart is required for reschedule action" },
          { status: 400 }
        );
      }

      const newStart = new Date(body.scheduledStart);
      const newEnd = body.scheduledEnd ? new Date(body.scheduledEnd) : undefined;

      const previousStart = booking.scheduledStart.toISOString();
      const previousEnd = booking.scheduledEnd?.toISOString() || null;

      const updatedBooking = await db.booking.update({
        where: { id },
        data: {
          scheduledStart: newStart,
          ...(newEnd ? { scheduledEnd: newEnd } : {}),
        },
      });

      await logAction({
        userId: session.userId,
        userName: session.name,
        action: "RESCHEDULE_BOOKING",
        entityType: "BOOKING",
        entityId: id,
        metadata: {
          previousScheduledStart: previousStart,
          previousScheduledEnd: previousEnd,
          newScheduledStart: newStart.toISOString(),
          newScheduledEnd: newEnd?.toISOString() || null,
        },
      });

      return NextResponse.json({ success: true, booking: updatedBooking });
    }

    // --- ACTION: update_notes ---
    if (action === "update_notes") {
      if (typeof body.completionNotes !== "string") {
        return NextResponse.json(
          { error: "completionNotes (string) is required for update_notes action" },
          { status: 400 }
        );
      }

      const previousNotes = booking.completionNotes;

      const updatedBooking = await db.booking.update({
        where: { id },
        data: { completionNotes: body.completionNotes },
      });

      await logAction({
        userId: session.userId,
        userName: session.name,
        action: "UPDATE_BOOKING_NOTES",
        entityType: "BOOKING",
        entityId: id,
        metadata: {
          previousNotes: previousNotes || null,
          newNotes: body.completionNotes,
        },
      });

      return NextResponse.json({ success: true, booking: updatedBooking });
    }

    // --- ACTION: update_rating ---
    if (action === "update_rating") {
      if (typeof body.rating !== "number" || body.rating < 1 || body.rating > 5) {
        return NextResponse.json(
          { error: "rating must be a number between 1 and 5" },
          { status: 400 }
        );
      }

      const previousRating = booking.rating;
      const previousComment = booking.ratingComment;

      const updatedBooking = await db.booking.update({
        where: { id },
        data: {
          rating: body.rating,
          ...(body.ratingComment !== undefined
            ? { ratingComment: body.ratingComment as string }
            : {}),
        },
      });

      await logAction({
        userId: session.userId,
        userName: session.name,
        action: "UPDATE_BOOKING_RATING",
        entityType: "BOOKING",
        entityId: id,
        metadata: {
          previousRating: previousRating || null,
          previousComment: previousComment || null,
          newRating: body.rating,
          newComment: body.ratingComment || null,
        },
      });

      return NextResponse.json({ success: true, booking: updatedBooking });
    }

    // Should never reach here due to action validation above
    return NextResponse.json({ error: "Unhandled action" }, { status: 500 });
  } catch (error) {
    console.error("[/api/ops/bookings/[id] PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
