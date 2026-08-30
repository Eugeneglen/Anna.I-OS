import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { NotificationStatus } from "@prisma/client"
import { getHouseholdSession } from "@/lib/household-auth"

// F2 (audit C2): single-notification mutations verify ownership before
// touching the row — fetch by { id, householdId: session }, 404 on
// mismatch, never update blind.

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // ── F2 auth gate ──
    const session = await getHouseholdSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { action } = body

    if (action === "read") {
      // Ownership check: only the session household's notification may be
      // marked read (findFirst scoped — a foreign id resolves to 404).
      const notification = await db.notification.findFirst({
        where: { id, householdId: session.householdId },
      })
      if (!notification) {
        return NextResponse.json({ error: "Notification not found" }, { status: 404 })
      }

      const updated = await db.notification.update({
        where: { id: notification.id },
        data: {
          status: NotificationStatus.READ,
          readAt: new Date(),
        },
      })
      return NextResponse.json({ notification: updated })
    }

    if (action === "read-all") {
      // F2: scope unconditionally to the SESSION household — any body
      // householdId is ignored.
      const householdId = session.householdId

      // Optional memberId targeting — only if the member belongs to the
      // session household.
      let memberId: string | null = body.memberId ?? null
      if (memberId) {
        const member = await db.familyMember.findFirst({
          where: { id: memberId, householdId },
          select: { id: true },
        })
        if (!member) memberId = null
      }

      const markWhere: Record<string, unknown> = { householdId, status: NotificationStatus.PENDING }
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

    return NextResponse.json({ error: "Invalid action. Use 'read' or 'read-all'." }, { status: 400 })
  } catch (error) {
    console.error("PATCH /api/notifications/[id] error:", error)
    return NextResponse.json({ error: "Failed to update notification" }, { status: 500 })
  }
}
