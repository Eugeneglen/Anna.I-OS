import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { NotificationStatus } from "@prisma/client"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const householdId = searchParams.get("householdId")
    const status = searchParams.get("status")
    const unreadOnly = searchParams.get("unreadOnly") === "true"

    if (!householdId) {
      return NextResponse.json({ error: "householdId is required" }, { status: 400 })
    }

    const where: Record<string, any> = { householdId }

    if (status && status !== "ALL") {
      where.status = status
    } else if (unreadOnly) {
      where.status = NotificationStatus.PENDING
    }

    const notifications = await db.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
    })

    // Get unread count
    const unreadCount = await db.notification.count({
      where: {
        householdId,
        status: NotificationStatus.PENDING,
      },
    })

    return NextResponse.json({ notifications, unreadCount })
  } catch (error) {
    console.error("GET /api/notifications error:", error)
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { action, householdId } = body

    if (action === "read-all") {
      if (!householdId) {
        return NextResponse.json({ error: "householdId required" }, { status: 400 })
      }

      const result = await db.notification.updateMany({
        where: {
          householdId,
          status: NotificationStatus.PENDING,
        },
        data: {
          status: NotificationStatus.READ,
          readAt: new Date(),
        },
      })

      return NextResponse.json({ updated: result.count })
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("POST /api/notifications error:", error)
    return NextResponse.json({ error: "Failed to update notifications" }, { status: 500 })
  }
}