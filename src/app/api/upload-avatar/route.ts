import { NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import { join } from "path"
import crypto from "crypto"
import { db } from "@/lib/db"

// 2 MB max
const MAX_SIZE = 2 * 1024 * 1024
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const memberId = formData.get("memberId") as string | null

    if (!file || !memberId) {
      return NextResponse.json(
        { error: "file and memberId are required" },
        { status: 400 }
      )
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

    // Verify member exists
    const member = await db.familyMember.findUnique({
      where: { id: memberId },
    })
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 })
    }

    // Generate unique filename
    const ext = file.type === "image/jpeg" ? "jpg"
      : file.type === "image/png" ? "png"
      : file.type === "image/webp" ? "webp"
      : "gif"

    const filename = `${memberId}-${crypto.randomBytes(8).toString("hex")}.${ext}`
    const publicDir = join(process.cwd(), "public", "avatars")
    await mkdir(publicDir, { recursive: true })

    const bytes = await file.arrayBuffer()
    await writeFile(join(publicDir, filename), Buffer.from(bytes))

    const avatarUrl = `/avatars/${filename}`

    // Update member record
    await db.familyMember.update({
      where: { id: memberId },
      data: { avatarUrl },
    })

    return NextResponse.json({ avatarUrl })
  } catch (error) {
    console.error("POST /api/upload-avatar error:", error)
    return NextResponse.json(
      { error: "Failed to upload avatar" },
      { status: 500 }
    )
  }
}