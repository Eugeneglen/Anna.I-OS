import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { TaskStatus, NotificationChannel, NotificationEventType, NotificationStatus, RecipientType } from "@prisma/client"
import { BOOKING_STATUS_TRANSITIONS } from "@/lib/constants"

// C-7 FIX: Extend schema to accept rating and ratingComment
const patchBookingSchema = z.object({
  status: z.string().min(1),
  rating: z.number().int().min(1).max(5).optional(),
  ratingComment: z.string().max(500).optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const parsed = patchBookingSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      )
    }

    const { status: newStatus, rating, ratingComment } = parsed.data

    // Fetch booking with task
    const booking = await db.booking.findUnique({
      where: { id },
      include: { task: true, vendor: true },
    })

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 })
    }

    // Validate state machine transition
    const allowedTransitions = BOOKING_STATUS_TRANSITIONS[booking.status] ?? []
    if (!allowedTransitions.includes(newStatus)) {
      return NextResponse.json(
        { error: `Cannot transition from "${booking.status}" to "${newStatus}"` },
        { status: 409 }
      )
    }

    const now = new Date()
    const updateData: Record<string, unknown> = { status: newStatus }

    if (newStatus === "in_progress") {
      updateData.actualStart = now
      updateData.acceptedAt = booking.acceptedAt ?? now
    }
    if (newStatus === "completed") {
      updateData.completedAt = now
      updateData.actualEnd = now
      // C-7 FIX: Persist rating and ratingComment on the booking
      if (rating !== undefined) {
        updateData.rating = rating
        updateData.ratingComment = ratingComment ?? null
      }
    }
    if (newStatus === "cancelled") {
      updateData.cancelledAt = now
    }

    const updatedBooking = await db.booking.update({
      where: { id },
      data: updateData,
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            categories: true,
            status: true,
          },
        },
      },
    })

    // Update parent task status based on booking state
    if (newStatus === "in_progress") {
      await db.task.update({
        where: { id: booking.taskId },
        data: { status: TaskStatus.IN_PROGRESS, inProgressAt: now },
      })

      // Notify household members that vendor is en route
      const members = await db.familyMember.findMany({
        where: { householdId: booking.task.householdId },
        select: { id: true },
      })

      for (const member of members) {
        await db.notification.create({
          data: {
            householdId: booking.task.householdId,
            recipientType: RecipientType.HOUSEHOLD_MEMBER,
            memberId: member.id,
            channel: NotificationChannel.WHATSAPP,
            eventType: NotificationEventType.VENDOR_EN_ROUTE,
            title: "Vendor En Route",
            body: `${booking.vendor.name} has started working on your ${booking.task.category.toLowerCase()} task.`,
            status: NotificationStatus.PENDING,
            referenceType: "booking",
            referenceId: booking.id,
          },
        })
      }
    }

    if (newStatus === "completed") {
      await db.task.update({
        where: { id: booking.taskId },
        data: { status: TaskStatus.COMPLETED, completedAt: now },
      })
    }

    // C-5 FIX: Reset task status on booking cancellation
    if (newStatus === "cancelled") {
      // Check if the task has any other non-cancelled bookings
      const otherActiveBookings = await db.booking.count({
        where: {
          taskId: booking.taskId,
          id: { not: id },
          status: { notIn: ["cancelled"] },
        },
      })

      // If no other active bookings, reset task to CREATED so it can be re-dispatched
      if (otherActiveBookings === 0) {
        await db.task.update({
          where: { id: booking.taskId },
          data: {
            status: TaskStatus.CREATED,
            dispatchedAt: null,
            inProgressAt: null,
          },
        })
      }
    }

    return NextResponse.json({ booking: updatedBooking })
  } catch (error) {
    console.error("PATCH /api/bookings/[id] error:", error)
    return NextResponse.json(
      { error: "Failed to update booking" },
      { status: 500 }
    )
  }
}