import { NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import { join } from "path"
import crypto from "crypto"
import { db } from "@/lib/db"
import { getVendorSession } from "@/lib/vendor-auth"

const MAX_SIZE = 5 * 1024 * 1024 // 5 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
const MAX_PHOTOS = 10

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; bookingId: string }> }
) {
  try {
    // ── Auth check ──
    const session = await getVendorSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: vendorId, bookingId } = await params

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

    // ── Parse multipart form data ──
    const formData = await request.formData()
    const type = formData.get("type") as string | null

    if (!type || !["before", "after"].includes(type)) {
      return NextResponse.json(
        { error: "type must be 'before' or 'after'" },
        { status: 400 }
      )
    }

    // Collect all file entries
    const files: File[] = []
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("file") && value instanceof File) {
        files.push(value)
      }
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 })
    }

    if (files.length > MAX_PHOTOS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_PHOTOS} photos per upload` },
        { status: 400 }
      )
    }

    // Validate and save each file
    const savedPhotos: { fileUrl: string; uploadedBy: string }[] = []
    const uploadDir = join(process.cwd(), "public", "attachments", "verification")
    await mkdir(uploadDir, { recursive: true })

    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json(
          { error: `Invalid file type: ${file.name}. Only JPEG, PNG, WebP, GIF allowed.` },
          { status: 400 }
        )
      }

      if (file.size > MAX_SIZE) {
        return NextResponse.json(
          { error: `File too large: ${file.name}. Max 5 MB.` },
          { status: 400 }
        )
      }

      const ext = file.type === "image/jpeg" ? "jpg"
        : file.type === "image/png" ? "png"
        : file.type === "image/webp" ? "webp"
        : "gif"

      const filename = `${bookingId}-${crypto.randomBytes(8).toString("hex")}.${ext}`
      const bytes = await file.arrayBuffer()
      await writeFile(join(uploadDir, filename), Buffer.from(bytes))

      savedPhotos.push({
        fileUrl: `/attachments/verification/${filename}`,
        uploadedBy: `vendor:${type}`,
      })
    }

    // Create verification photo records
    await db.verificationPhoto.createMany({
      data: savedPhotos.map((photo) => ({
        taskId: booking.taskId,
        bookingId,
        fileUrl: photo.fileUrl,
        uploadedBy: photo.uploadedBy,
      })),
    })

    return NextResponse.json({
      count: savedPhotos.length,
      type,
      photos: savedPhotos.map((p) => ({ fileUrl: p.fileUrl })),
    })
  } catch (error) {
    console.error("POST /api/vendors/[id]/bookings/[bookingId]/photos error:", error)
    return NextResponse.json(
      { error: "Failed to upload photos" },
      { status: 500 }
    )
  }
}
