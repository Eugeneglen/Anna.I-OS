import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import crypto from "crypto";
import { requireVendorOwnership, vendorJson } from "@/lib/vendor-guard";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; bookingId: string }> }
) {
  try {
    const { id: vendorId, bookingId } = await params;

    // ── IDOR protection: verify authenticated vendor owns this resource ──
    const auth = await requireVendorOwnership(vendorId);
    if (!auth.success) return auth.response;

    // Verify booking exists and belongs to this vendor
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, vendorId: true, shareToken: true },
    });

    if (!booking || booking.vendorId !== auth.vendorId) {
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
