import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // ── Authenticate via shareToken ──
    const booking = await db.booking.findUnique({
      where: { shareToken: token },
      select: { id: true },
    });

    if (!booking) {
      return NextResponse.json(
        { error: "Invalid or expired share link" },
        { status: 404 }
      );
    }

    // ── Fetch addons for this booking ──
    const addons = await db.bookingAddon.findMany({
      where: { bookingId: booking.id },
      select: {
        id: true,
        description: true,
        amountCents: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ addons });
  } catch (error) {
    console.error("GET /api/j/share/[token]/addons error:", error);
    return NextResponse.json(
      { error: "Failed to load addons" },
      { status: 500 }
    );
  }
}
