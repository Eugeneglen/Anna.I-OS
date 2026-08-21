import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireVendorOwnership, vendorJson } from "@/lib/vendor-guard"

// PATCH — mark a single notification as read, or bulk mark-all as read
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; notificationId: string }> }
) {
  try {
    const { id, notificationId } = await params

    // ── IDOR protection: verify authenticated vendor owns this resource ──
    const auth = await requireVendorOwnership(id)
    if (!auth.success) return auth.response

    const body = await request.json()
    const { markAll } = body

    if (markAll) {
      // Bulk mark all vendor notifications as read
      const result = await db.notification.updateMany({
        where: {
          recipientType: "VENDOR",
          vendorId: auth.vendorId,
          status: "PENDING",
        },
        data: {
          status: "READ",
          readAt: new Date(),
        },
      })

      return vendorJson({ updated: result.count }, auth.vendorId)
    }

    // Mark single notification as read
    const notification = await db.notification.findFirst({
      where: {
        id: notificationId,
        recipientType: "VENDOR",
        vendorId: auth.vendorId,
      },
    })

    if (!notification) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 })
    }

    const updated = await db.notification.update({
      where: { id: notificationId },
      data: {
        status: "READ",
        readAt: new Date(),
      },
    })

    return vendorJson({ notification: updated }, auth.vendorId)
  } catch (error) {
    console.error("PATCH /api/vendors/[id]/notifications/[notificationId] error:", error)
    return NextResponse.json(
      { error: "Failed to update notification" },
      { status: 500 }
    )
  }
}
