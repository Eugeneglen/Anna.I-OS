import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getHouseholdSession } from "@/lib/household-auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: bookingId } = await params;

    // ── Verify booking belongs to user's household ──
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        taskId: true,
        task: {
          select: { householdId: true },
        },
      },
    });

    if (!booking) {
      return NextResponse.json(
        { error: "Booking not found" },
        { status: 404 }
      );
    }

    if (booking.task.householdId !== session.householdId) {
      return NextResponse.json(
        { error: "You do not have permission to view these addons" },
        { status: 403 }
      );
    }

    // ── Fetch addons ──
    const addons = await db.bookingAddon.findMany({
      where: { bookingId },
      select: {
        id: true,
        description: true,
        amountCents: true,
        status: true,
        createdAt: true,
        approvedAt: true,
        rejectedAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ addons });
  } catch (error) {
    console.error("GET /api/bookings/[id]/addons error:", error);
    return NextResponse.json(
      { error: "Failed to load addons" },
      { status: 500 }
    );
  }
}
