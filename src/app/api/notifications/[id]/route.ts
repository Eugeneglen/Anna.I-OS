import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { NotificationStatus } from "@prisma/client"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action } = body

    if (action === "read") {
      const notification = await db.notification.update({
        where: { id },
        data: {
          status: NotificationStatus.READ,
          readAt: new Date(),
        },
      })
      return NextResponse.json({ notification })
    }

    if (action === "read-all") {
      // body should include householdId
      const { householdId } = body
      if (!householdId) {
        return NextResponse.json({ error: "householdId required for read-all" }, { status: 400 })
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

    return NextResponse.json({ error: "Invalid action. Use 'read' or 'read-all'." }, { status: 400 })
  } catch (error) {
    console.error("PATCH /api/notifications/[id] error:", error)
    return NextResponse.json({ error: "Failed to update notification" }, { status: 500 })
  }
}