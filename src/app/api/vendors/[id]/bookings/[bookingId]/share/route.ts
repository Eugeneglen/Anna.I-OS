import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import crypto from "crypto";
import { requireVendorOwnership, vendorJson } from "@/lib/vendor-guard";
import { shareLinkExpiresAt } from "@/lib/share-link";

/**
 * POST /api/vendors/[id]/bookings/[bookingId]/share
 *
 * Generates (or renews) the share token for the public staff job page
 * (/j/<token>).
 *
 * Behaviour:
 *  • No token yet            → mint a new one (sharedAt = now).
 *  • Token exists, still live → return the SAME token (no surprise
 *    revocations — the WhatsApp message the vendor already sent keeps
 *    working).
 *  • Token exists, EXPIRED   → ROTATE: mint a fresh token with a fresh
 *    sharedAt. The old (dead) link's token is replaced, so renewal is
 *    one click for the vendor and the leaked/expired link stays dead.
 *  • ?rotate=1 (or body {rotate:true}) → force rotation even when the
 *    current link is still live (explicit revoke + reissue).
 *
 * The response always includes `expiresAt` so the vendor UI can show
 * when the link dies. See src/lib/share-link.ts for the expiry model.
 */
export async function POST(
  request: Request,
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
      select: { id: true, vendorId: true, shareToken: true, sharedAt: true, scheduledEnd: true },
    });

    if (!booking || booking.vendorId !== auth.vendorId) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    // Rotation controls: ?rotate=1 query param or { rotate: true } body
    let forceRotate = false;
    try {
      const url = new URL(request.url);
      forceRotate = url.searchParams.get("rotate") === "1";
    } catch {
      // relative/proxied URL parse failure — fall back to body flag only
    }
    if (!forceRotate) {
      const body = await request.json().catch(() => ({} as Record<string, unknown>));
      if (body && typeof body === "object" && (body as { rotate?: unknown }).rotate === true) {
        forceRotate = true;
      }
    }

    const expiresAtOf = (sharedAt: Date | null, scheduledEnd: Date | null) =>
      shareLinkExpiresAt({ sharedAt, scheduledEnd });

    // Existing live token — return it as-is (unless force-rotate requested)
    if (booking.shareToken && !forceRotate) {
      const live = expiresAtOf(booking.sharedAt, booking.scheduledEnd);
      if (live === null || live.getTime() >= Date.now()) {
        const existing = await db.booking.findUnique({
          where: { id: bookingId },
          include: {
            assignedStaff: { select: { id: true, name: true, role: true, contact: true } },
            task: { select: { id: true, category: true } },
          },
        });

        return NextResponse.json({
          token: booking.shareToken,
          expiresAt: live ? live.toISOString() : null,
          rotated: false,
          booking: existing,
        });
      }
      // else: token exists but is expired → fall through and rotate below
    }

    // Mint a (new) token — first issue, renewal of an expired link, or
    // forced rotation. The old token (if any) is overwritten, which
    // revokes it: an expired/leaked link stops resolving even if someone
    // kept a copy.
    const token = crypto.randomBytes(9).toString("base64url");
    const now = new Date();

    const updated = await db.booking.update({
      where: { id: bookingId },
      data: {
        shareToken: token,
        sharedAt: now,
      },
      include: {
        assignedStaff: { select: { id: true, name: true, role: true, contact: true } },
        task: { select: { id: true, category: true } },
      },
    });

    return NextResponse.json({
      token,
      expiresAt: expiresAtOf(now, booking.scheduledEnd)?.toISOString() ?? null,
      rotated: Boolean(booking.shareToken), // true when this replaced an older token
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
