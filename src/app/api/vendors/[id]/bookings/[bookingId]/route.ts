import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { TaskStatus } from "@prisma/client"
import { BOOKING_STATUS_TRANSITIONS } from "@/lib/constants"
import { triggerAnomalyDetection } from "@/lib/notify"

const ACTION_STATUS_MAP: Record<string, string> = {
  accept: "accepted",
  start: "in_progress",
  complete: "completed",
  reject: "cancelled",
}

const patchVendorBookingSchema = z.object({
  action: z.enum(["accept", "start", "complete", "reject"]),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; bookingId: string }> }
) {
  try {
    const { id: vendorId, bookingId } = await params

    const body = await request.json()
    const parsed = patchVendorBookingSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      )
    }

    const { action } = parsed.data
    const newStatus = ACTION_STATUS_MAP[action]

    // Fetch booking with task
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      include: { task: true },
    })

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 })
    }

    // Verify booking belongs to this vendor
    if (booking.vendorId !== vendorId) {
      return NextResponse.json(
        { error: "Booking does not belong to this vendor" },
        { status: 403 }
      )
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

    if (action === "accept") {
      updateData.acceptedAt = now
    }

    if (action === "start") {
      updateData.actualStart = now
      updateData.acceptedAt = booking.acceptedAt ?? now
    }

    if (action === "complete") {
      updateData.actualEnd = now
      updateData.completedAt = now
    }

    if (action === "reject") {
      updateData.cancelledAt = now
    }

    const updatedBooking = await db.booking.update({
      where: { id: bookingId },
      data: updateData,
      include: {
        task: {
          select: {
            id: true,
            category: true,
            householdId: true,
          },
        },
        assignedStaff: {
          select: { id: true, name: true, role: true },
        },
      },
    })

    // Update parent task status
    if (action === "start") {
      await db.task.update({
        where: { id: booking.taskId },
        data: { status: TaskStatus.IN_PROGRESS, inProgressAt: now },
      })
    }

    if (action === "complete") {
      await db.task.update({
        where: { id: booking.taskId },
        data: { status: TaskStatus.COMPLETED, completedAt: now },
      })

      // Trigger anomaly detection (fire-and-forget)
      triggerAnomalyDetection(booking.task.householdId)
    }

    if (action === "reject") {
      // Check if the task has any other non-cancelled bookings
      const otherActiveBookings = await db.booking.count({
        where: {
          taskId: booking.taskId,
          id: { not: bookingId },
          status: { notIn: ["cancelled"] },
        },
      })

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
    console.error("PATCH /api/vendors/[id]/bookings/[bookingId] error:", error)
    return NextResponse.json(
      { error: "Failed to update booking" },
      { status: 500 }
    )
  }
}