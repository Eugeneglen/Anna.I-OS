import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)

    const statusParam = searchParams.get("status")
    const fromParam = searchParams.get("from")
    const toParam = searchParams.get("to")

    // Parse comma-separated status filter
    const statuses = statusParam
      ? statusParam.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined

    // Parse date filters
    const from = fromParam ? new Date(fromParam) : undefined
    const to = toParam ? new Date(toParam) : undefined

    // Fetch vendor info
    const vendor = await db.vendor.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        vendorType: true,
        staffCount: true,
      },
    })

    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
    }

    // Build where clause
    const where: Record<string, unknown> = { vendorId: id }

    if (statuses && statuses.length > 0) {
      where.status = { in: statuses }
    }

    if (from || to) {
      const scheduledFilter: Record<string, unknown> = {}
      if (from) scheduledFilter.gte = from
      if (to) scheduledFilter.lte = to
      where.scheduledStart = scheduledFilter
    }

    // Fetch bookings with task details and photo counts
    const bookings = await db.booking.findMany({
      where,
      orderBy: { scheduledStart: "desc" },
      include: {
        task: {
          select: {
            id: true,
            category: true,
            instructions: true,
            amountCents: true,
            household: {
              select: {
                id: true,
                name: true,
                address: true,
              },
            },
          },
        },
        verificationPhotos: {
          select: { id: true, fileUrl: true, thumbnailUrl: true, uploadedBy: true, isVerified: true },
        },
        assignedStaff: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
      },
    })

    // Shape response with photo count
    const schedule = bookings.map((b) => ({
      id: b.id,
      status: b.status,
      scheduledStart: b.scheduledStart,
      scheduledEnd: b.scheduledEnd,
      actualStart: b.actualStart,
      actualEnd: b.actualEnd,
      acceptedAt: b.acceptedAt,
      completedAt: b.completedAt,
      cancelledAt: b.cancelledAt,
      rating: b.rating,
      ratingComment: b.ratingComment,
      category: b.task.category,
      instructions: b.task.instructions,
      amountCents: b.task.amountCents,
      householdName: b.task.household.name,
      address: b.task.household.address,
      verificationPhotoCount: b.verificationPhotos.length,
      verificationPhotos: b.verificationPhotos,
      assignedStaff: b.assignedStaff,
    }))

    return NextResponse.json({
      vendor,
      schedule,
      total: schedule.length,
    })
  } catch (error) {
    console.error("GET /api/vendors/[id]/schedule error:", error)
    return NextResponse.json(
      { error: "Failed to fetch vendor schedule" },
      { status: 500 }
    )
  }
}