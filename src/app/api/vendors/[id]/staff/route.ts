import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { requireVendorOwnership, vendorJson } from "@/lib/vendor-guard"

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

    // ── IDOR protection: verify authenticated vendor owns this resource ──
    const auth = await requireVendorOwnership(id)
    if (!auth.success) return auth.response

    const { searchParams } = new URL(request.url)

    const isActiveParam = searchParams.get("isActive")
    const parsed = querySchema.safeParse({ isActive: isActiveParam ?? "true" })

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      )
    }

    const where: Record<string, unknown> = { vendorId: auth.vendorId }
    if (parsed.data.isActive !== undefined) {
      where.isActive = parsed.data.isActive
    }

    const staff = await db.vendorStaff.findMany({
      where,
      orderBy: { createdAt: "asc" },
    })

    return vendorJson({ staff }, auth.vendorId)
  } catch (error) {
    console.error("GET /api/vendors/[id]/staff error:", error)
    return NextResponse.json(
      { error: "Failed to fetch vendor staff" },
      { status: 500 }
    )
  }
}