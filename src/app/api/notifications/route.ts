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

    // If no memberId provided, default to first household member to avoid duplicates
    let memberId = searchParams.get("memberId")
    if (!memberId) {
      const firstMember = await db.familyMember.findFirst({
        where: { householdId },
        select: { id: true },
      })
      memberId = firstMember?.id ?? null
    }

    const where: Record<string, any> = { householdId }
    if (memberId) {
      where.memberId = memberId
    }

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

    // Get unread count (filtered by memberId too)
    const unreadWhere: Record<string, any> = { householdId, status: NotificationStatus.PENDING }
    if (memberId) {
      unreadWhere.memberId = memberId
    }
    const unreadCount = await db.notification.count({ where: unreadWhere })

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

      // Also accept optional memberId for targeted mark-read
      const { memberId: bodyMemberId } = body
      const markWhere: Record<string, any> = { householdId, status: NotificationStatus.PENDING }
      if (bodyMemberId) {
        markWhere.memberId = bodyMemberId
      }

      const result = await db.notification.updateMany({
        where: markWhere,
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