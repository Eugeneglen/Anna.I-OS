import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { NotificationEventType, NotificationStatus } from "@prisma/client"
import { getHouseholdSession } from "@/lib/household-auth"

// F2 (audit C2): every query/mutation is scoped to the household SESSION.
// A householdId query/body param is accepted only when it matches the
// session (else ignored) — cross-household reads (IDOR) are impossible.
// Unauthenticated callers get 401.

const ANOMALY_EVENT_TYPES: NotificationEventType[] = [
  NotificationEventType.ANOMALY_VENDOR_LATE,
  NotificationEventType.ANOMALY_TASK_OVERDUE,
  NotificationEventType.ANOMALY_VERIFICATION_MISSING,
  NotificationEventType.ANOMALY_RATING_DROP,
  NotificationEventType.ANOMALY_ESCROW_DISPUTED,
]

export async function GET(request: Request) {
  try {
    // ── F2 auth gate ──
    const session = await getHouseholdSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    // Query householdId is accepted only when it matches the session; a
    // mismatched id is ignored (the session wins — no cross-household reads).
    const requestedHouseholdId = searchParams.get("householdId")
    const householdId =
      requestedHouseholdId === session.householdId ? requestedHouseholdId : session.householdId

    const status = searchParams.get("status")
    const unreadOnly = searchParams.get("unreadOnly") === "true"

    // If no memberId provided, default to first household member to avoid duplicates
    let memberId = searchParams.get("memberId")
    if (memberId) {
      // F2: a memberId from another household must never scope the query.
      const member = await db.familyMember.findFirst({
        where: { id: memberId, householdId },
        select: { id: true },
      })
      if (!member) memberId = null
    }
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
    const [unreadCount, anomalyUnreadCount] = await Promise.all([
      db.notification.count({ where: unreadWhere }),
      db.notification.count({
        where: {
          ...unreadWhere,
          eventType: { in: ANOMALY_EVENT_TYPES },
        },
      }),
    ])

    return NextResponse.json({ notifications, unreadCount, anomalyUnreadCount })
  } catch (error) {
    console.error("GET /api/notifications error:", error)
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    // ── F2 auth gate ──
    const session = await getHouseholdSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { action } = body

    if (action === "read-all") {
      // F2: scope unconditionally to the SESSION household — any body
      // householdId is ignored (never trust client-supplied scope).
      const householdId = session.householdId

      // Also accept optional memberId for targeted mark-read — but only if
      // the member belongs to the session household.
      let memberId: string | null = body.memberId ?? null
      if (memberId) {
        const member = await db.familyMember.findFirst({
          where: { id: memberId, householdId },
          select: { id: true },
        })
        if (!member) memberId = null
      }

      const markWhere: Record<string, any> = { householdId, status: NotificationStatus.PENDING }
      if (memberId) {
        markWhere.memberId = memberId
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
