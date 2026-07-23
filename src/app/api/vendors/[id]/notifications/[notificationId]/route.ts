import { NextResponse } from "next/server"
import { db } from "@/lib/db"

// PATCH — mark a single notification as read, or bulk mark-all as read
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; notificationId: string }> }
) {
  try {
    const { id, notificationId } = await params
    const body = await request.json()
    const { markAll } = body

    // Verify vendor exists
    const vendor = await db.vendor.findUnique({
      where: { id },
      select: { id: true },
    })

    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
    }

    if (markAll) {
      // Bulk mark all vendor notifications as read
      const result = await db.notification.updateMany({
        where: {
          recipientType: "VENDOR",
          vendorId: id,
          status: "PENDING",
        },
        data: {
          status: "READ",
          readAt: new Date(),
        },
      })

      return NextResponse.json({ updated: result.count })
    }

    // Mark single notification as read
    const notification = await db.notification.findFirst({
      where: {
        id: notificationId,
        recipientType: "VENDOR",
        vendorId: id,
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

    return NextResponse.json({ notification: updated })
  } catch (error) {
    console.error("PATCH /api/vendors/[id]/notifications/[notificationId] error:", error)
    return NextResponse.json(
      { error: "Failed to update notification" },
      { status: 500 }
    )
  }
}
