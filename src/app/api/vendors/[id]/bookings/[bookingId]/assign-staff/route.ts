import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { VendorType } from "@prisma/client"

const assignStaffSchema = z.object({
  staffId: z.string().min(1),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; bookingId: string }> }
) {
  try {
    const { id: vendorId, bookingId } = await params

    const body = await request.json()
    const parsed = assignStaffSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      )
    }

    const { staffId } = parsed.data

    // Verify vendor is SME
    const vendor = await db.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, vendorType: true },
    })

    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
    }

    if (vendor.vendorType !== VendorType.SME) {
      return NextResponse.json(
        { error: "Staff assignment is only available for SME vendors" },
        { status: 403 }
      )
    }

    // Verify booking belongs to this vendor
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, vendorId: true },
    })

    if (!booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 })
    }

    if (booking.vendorId !== vendorId) {
      return NextResponse.json(
        { error: "Booking does not belong to this vendor" },
        { status: 403 }
      )
    }

    // Verify staff belongs to this vendor
    const staff = await db.vendorStaff.findUnique({
      where: { id: staffId },
      select: { id: true, vendorId: true, name: true, role: true, isActive: true },
    })

    if (!staff || staff.vendorId !== vendorId) {
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

    return NextResponse.json({ booking: updatedBooking })
  } catch (error) {
    console.error("PATCH /api/vendors/[id]/bookings/[bookingId]/assign-staff error:", error)
    return NextResponse.json(
      { error: "Failed to assign staff" },
      { status: 500 }
    )
  }
}