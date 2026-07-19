import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"

const photoSchema = z.object({
  fileUrl: z.string().min(1),
  thumbnailUrl: z.string().optional(),
})

const uploadPhotosSchema = z.object({
  photos: z.array(photoSchema).min(1).max(10),
  type: z.enum(["before", "after"]),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; bookingId: string }> }
) {
  try {
    const { id: vendorId, bookingId } = await params

    const body = await request.json()
    const parsed = uploadPhotosSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      )
    }

    const { photos, type } = parsed.data

    // Verify booking exists and belongs to this vendor
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, vendorId: true, taskId: true },
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

    // Create verification photos
    await db.verificationPhoto.createMany({
      data: photos.map((photo) => ({
        taskId: booking.taskId,
        bookingId,
        fileUrl: photo.fileUrl,
        thumbnailUrl: photo.thumbnailUrl ?? null,
        uploadedBy: `vendor:${type}`,
      })),
    })

    return NextResponse.json({
      count: photos.length,
      type,
    })
  } catch (error) {
    console.error("POST /api/vendors/[id]/bookings/[bookingId]/photos error:", error)
    return NextResponse.json(
      { error: "Failed to upload photos" },
      { status: 500 }
    )
  }
}