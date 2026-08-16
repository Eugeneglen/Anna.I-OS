import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import crypto from "crypto";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; bookingId: string }> }
) {
  try {
    const { id: vendorId, bookingId } = await params;

    // Derive origin: prefer explicit env var, then fall back to request headers
    // In sandbox/reverse-proxy environments the host header may be an internal
    // hostname that the staff member cannot reach, so NEXT_PUBLIC_APP_URL
    // (or APP_URL for server-only) takes precedence.
    const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
    const proto = request.headers.get("x-forwarded-proto") || "https";
    const host = request.headers.get("host") || "localhost:3000";
    const origin = configured ? configured.replace(/\/$/, "") : `${proto}://${host}`;

    // Verify booking exists and belongs to this vendor
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, vendorId: true, shareToken: true },
    });

    if (!booking || booking.vendorId !== vendorId) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    // If token already exists, return it
    if (booking.shareToken) {
      const existing = await db.booking.findUnique({
        where: { id: bookingId },
        include: {
          assignedStaff: { select: { id: true, name: true, role: true, contact: true } },
          task: { select: { id: true, category: true } },
        },
      });

      return NextResponse.json({
        shareUrl: `${origin}/j/${booking.shareToken}`,
        token: booking.shareToken,
        booking: existing,
      });
    }

    // Generate new token
    const token = crypto.randomBytes(9).toString("base64url");

    const updated = await db.booking.update({
      where: { id: bookingId },
      data: {
        shareToken: token,
        sharedAt: new Date(),
      },
      include: {
        assignedStaff: { select: { id: true, name: true, role: true, contact: true } },
        task: { select: { id: true, category: true } },
      },
    });

    return NextResponse.json({
      shareUrl: `${origin}/j/${token}`,
      token,
      booking: updated,
    });
  } catch (error) {
    console.error(
      "POST /api/vendors/[id]/bookings/[bookingId]/share error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to generate share link" },
      { status: 500 }
    );
  }
}
