import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"

const querySchema = z.object({
  isActive: z
    .string()
    .transform((v) => {
      if (v === "false") return false
      return true
    })
    .optional(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)

    const isActiveParam = searchParams.get("isActive")
    const parsed = querySchema.safeParse({ isActive: isActiveParam ?? "true" })

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      )
    }

    // Verify vendor exists
    const vendor = await db.vendor.findUnique({
      where: { id },
      select: { id: true },
    })

    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 })
    }

    const where: Record<string, unknown> = { vendorId: id }
    if (parsed.data.isActive !== undefined) {
      where.isActive = parsed.data.isActive
    }

    const staff = await db.vendorStaff.findMany({
      where,
      orderBy: { createdAt: "asc" },
    })

    return NextResponse.json({ staff })
  } catch (error) {
    console.error("GET /api/vendors/[id]/staff error:", error)
    return NextResponse.json(
      { error: "Failed to fetch vendor staff" },
      { status: 500 }
    )
  }
}