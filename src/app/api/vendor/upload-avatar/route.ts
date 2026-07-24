import { NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import { join } from "path"
import crypto from "crypto"
import { db } from "@/lib/db"
import { getVendorSession } from "@/lib/vendor-auth"

// UPLOAD_DIR: writable root for file storage.
// - Local dev: defaults to public/ (backward compatible)
// - Railway: set UPLOAD_DIR env var to a persistent directory (e.g. /data/uploads)
const UPLOAD_DIR = process.env.UPLOAD_DIR || join(process.cwd(), "public")

// 2 MB max
const MAX_SIZE = 2 * 1024 * 1024
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]

export async function POST(request: Request) {
  try {
    // Verify vendor is logged in
    const session = await getVendorSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Only JPEG, PNG, WebP, and GIF images are allowed" },
        { status: 400 }
      )
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "Image must be under 2 MB" },
        { status: 400 }
      )
    }

    // Generate unique filename
    const ext = file.type === "image/jpeg" ? "jpg"
      : file.type === "image/png" ? "png"
      : file.type === "image/webp" ? "webp"
      : "gif"

    const filename = `vendor-${session.vendorId}-${crypto.randomBytes(8).toString("hex")}.${ext}`
    const publicDir = join(UPLOAD_DIR, "avatars", "vendors")
    await mkdir(publicDir, { recursive: true })

    const bytes = await file.arrayBuffer()
    await writeFile(join(publicDir, filename), Buffer.from(bytes))

    const avatarUrl = `/api/serve/avatars/vendors/${filename}`

    // Update vendor record
    await db.vendor.update({
      where: { id: session.vendorId },
      data: { avatarUrl },
    })

    return NextResponse.json({ avatarUrl })
  } catch (error) {
    console.error("POST /api/vendor/upload-avatar error:", error)
    return NextResponse.json(
      { error: "Failed to upload avatar" },
      { status: 500 }
    )
  }
}
