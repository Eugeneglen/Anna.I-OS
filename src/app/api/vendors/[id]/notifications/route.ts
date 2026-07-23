import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const unreadOnly = searchParams.get("unread") === "true"

    // Verify vendor exists
    const vendor = await db.vendor.findUnique({
      where: { id },
      select: { id: true },
    })

    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
    }

    // Build where clause
    const where: Record<string, unknown> = {
      recipientType: "VENDOR",
      vendorId: id,
    }

    if (unreadOnly) {
      where.status = "PENDING"
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
    const unreadCount = await db.notification.count({
      where: {
        recipientType: "VENDOR",
        vendorId: id,
        status: "PENDING",
      },
    })

    return NextResponse.json({
      notifications,
      unreadCount,
    })
  } catch (error) {
    console.error("GET /api/vendors/[id]/notifications error:", error)
    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 }
    )
  }
}
