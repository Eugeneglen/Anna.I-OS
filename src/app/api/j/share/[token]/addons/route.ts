import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";

const createAddonSchema = z.object({
  description: z
    .string()
    .min(3, "Description must be at least 3 characters")
    .max(500, "Description must be under 500 characters"),
  amountCents: z
    .number()
    .int("Amount must be a whole number")
    .min(50, "Minimum charge is $0.50")
    .max(1_000_000, "Maximum charge is $10,000"),
});

// ── GET: list existing addons ──
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

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

// ── POST: staff creates an ad-hoc additional charge ──
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // ── Authenticate via shareToken ──
    const booking = await db.booking.findUnique({
      where: { shareToken: token },
      select: { id: true, vendorId: true, status: true },
    });

    if (!booking) {
      return NextResponse.json(
        { error: "Invalid or expired share link" },
        { status: 404 }
      );
    }

    // Only allow addons on active bookings
    if (!["assigned", "accepted", "in_progress"].includes(booking.status)) {
      return NextResponse.json(
        {
          error:
            "Cannot add charges to a completed or cancelled booking",
        },
        { status: 409 }
      );
    }

    // ── Validate body ──
    const body = await request.json();
    const parsed = createAddonSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues.map((i) => i.message).join(", "),
        },
        { status: 400 }
      );
    }

    const { description, amountCents } = parsed.data;

    // ── Create addon ──
    const addon = await db.bookingAddon.create({
      data: {
        bookingId: booking.id,
        description,
        amountCents,
        status: "pending",
        addedById: booking.vendorId,
      },
      select: {
        id: true,
        description: true,
        amountCents: true,
        status: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ addon }, { status: 201 });
  } catch (error) {
    console.error("POST /api/j/share/[token]/addons error:", error);
    return NextResponse.json(
      { error: "Failed to create additional charge" },
      { status: 500 }
    );
  }
}
