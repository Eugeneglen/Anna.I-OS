import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { requireVendorOwnership, vendorJson } from "@/lib/vendor-guard"

const assignStaffSchema = z.object({
  staffId: z.string().min(1),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; bookingId: string }> }
) {
  try {
    const { id: vendorId, bookingId } = await params

    // ── IDOR protection: verify authenticated vendor owns this resource ──
    const auth = await requireVendorOwnership(vendorId)
    if (!auth.success) return auth.response

    const body = await request.json()
    const parsed = assignStaffSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      )
    }

    const { staffId } = parsed.data

    // Verify booking belongs to this vendor
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, vendorId: true, status: true },
    })

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 })
    }

    if (booking.vendorId !== auth.vendorId) {
      return NextResponse.json(
        { error: "Booking does not belong to this vendor" },
        { status: 403 }
      )
    }

    // Allow staff assignment on assigned, accepted, or in_progress bookings
    const allowedStatuses = ["assigned", "accepted", "in_progress"]
    if (!allowedStatuses.includes(booking.status)) {
      return NextResponse.json(
        { error: "Cannot assign staff to a completed or cancelled booking" },
        { status: 409 }
      )
    }

    // Verify staff belongs to this vendor and is active
    const staff = await db.vendorStaff.findUnique({
      where: { id: staffId },
      select: { id: true, vendorId: true, name: true, role: true, contact: true, isActive: true },
    })

    if (!staff || staff.vendorId !== auth.vendorId) {
      return NextResponse.json(
        { error: "Staff member not found or does not belong to this vendor" },
        { status: 404 }
      )
    }

    if (!staff.isActive) {
      return NextResponse.json(
        { error: "Staff member is not active" },
        { status: 409 }
      )
    }

    // Assign staff to booking
    const updatedBooking = await db.booking.update({
      where: { id: bookingId },
      data: { assignedStaffId: staffId },
      include: {
        assignedStaff: {
          select: { id: true, name: true, role: true, contact: true },
        },
        task: {
          select: { id: true, category: true },
        },
      },
    })

    return vendorJson({ booking: updatedBooking }, auth.vendorId)
  } catch (error) {
    console.error("PATCH /api/vendors/[id]/bookings/[bookingId]/assign-staff error:", error)
    return NextResponse.json(
      { error: "Failed to assign staff" },
      { status: 500 }
    )
  }
}
