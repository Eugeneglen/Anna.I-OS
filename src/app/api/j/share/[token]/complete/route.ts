import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { TaskStatus } from "@prisma/client";
import { triggerAnomalyDetection } from "@/lib/notify";
import { updateHouseholdCachedStats } from "@/lib/marketing/behaviour-engine";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // ── Authenticate via shareToken ──
    const booking = await db.booking.findUnique({
      where: { shareToken: token },
      include: {
        task: {
          select: {
            id: true,
            status: true,
            householdId: true,
            category: true,
          },
        },
      },
    });

    if (!booking) {
      return NextResponse.json(
        { error: "Invalid or expired share link" },
        { status: 404 }
      );
    }

    // Only accepted bookings can be completed by staff
    if (booking.status !== "accepted") {
      return NextResponse.json(
        { error: `Cannot complete booking with status "${booking.status}". Only accepted bookings can be completed.` },
        { status: 409 }
      );
    }

    // ── Parse JSON body ──
    const body = await request.json();
    const { completionNotes } = body as { completionNotes?: string };

    const now = new Date();

    // ── Transition booking: accepted → completed ──
    const updatedBooking = await db.booking.update({
      where: { id: booking.id },
      data: {
        status: "completed",
        actualEnd: now,
        completedAt: now,
        completionNotes: completionNotes || null,
      },
      include: {
        task: {
          select: {
            id: true,
            category: true,
            householdId: true,
          },
        },
        assignedStaff: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    // ── Transition task → COMPLETED ──
    await db.task.update({
      where: { id: booking.task.id },
      data: { status: TaskStatus.COMPLETED, completedAt: now },
    });

    // ── Trigger anomaly detection ──
    triggerAnomalyDetection(booking.task.householdId);

    // Phase 1 P1-4 fix: refresh cached household marketing stats.
    // Non-fatal — task completion must succeed even if the stats refresh fails.
    try {
      await updateHouseholdCachedStats(booking.task.householdId);
    } catch (statsErr) {
      console.error("[share/complete] updateHouseholdCachedStats failed:", statsErr);
    }

    return NextResponse.json({ booking: updatedBooking });
  } catch (error) {
    console.error("POST /api/j/share/[token]/complete error:", error);
    return NextResponse.json(
      { error: "Failed to complete booking" },
      { status: 500 }
    );
  }
}
