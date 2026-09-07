import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireVendorOwnership, vendorJson } from "@/lib/vendor-guard"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // ── IDOR protection: verify authenticated vendor owns this resource ──
    const auth = await requireVendorOwnership(id)
    if (!auth.success) return auth.response

    const { searchParams } = new URL(request.url)
    const unreadOnly = searchParams.get("unread") === "true"

    // Build where clause
    const where: Record<string, unknown> = {
      recipientType: "VENDOR",
      vendorId: auth.vendorId,
    }

    // FIX-1d: unread is readAt-based — the delivery layer flips status
    // PENDING → SENT, so status no longer doubles as the unread marker.
    if (unreadOnly) {
      where.readAt = null
    }

    // Fetch notifications, newest first
    const notifications = await db.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        eventType: true,
        title: true,
        body: true,
        status: true,
        referenceType: true,
        referenceId: true,
        createdAt: true,
        readAt: true,
      },
    })

    // Count unread
    // FIX-1d: readAt-based — see note above.
    const unreadCount = await db.notification.count({
      where: {
        recipientType: "VENDOR",
        vendorId: auth.vendorId,
        readAt: null,
      },
    })

    return vendorJson({
      notifications,
      unreadCount,
    }, auth.vendorId)
  } catch (error) {
    console.error("GET /api/vendors/[id]/notifications error:", error)
    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 }
    )
  }
}
