import { NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { MAX_AUTONOMY_LEVEL } from "@/lib/constants"
import { getHouseholdSession } from "@/lib/household-auth"
import { getOpsSession } from "@/lib/ops-auth"

const patchSchema = z.object({
  promotionPaused: z.boolean().optional(),
  currentLevel: z.number().int().min(1).max(MAX_AUTONOMY_LEVEL).optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ householdId: string; category: string }> }
) {
  try {
    const { householdId, category } = await params

    // FIX-1a: previously fully unauthenticated — anyone could set any
    // autonomy level on any household. The household autonomy panel edits
    // its OWN record; ops may act on any household.
    const [hhSession, opsSession] = await Promise.all([
      getHouseholdSession(),
      getOpsSession(),
    ])
    if (!hhSession && !opsSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    if (hhSession && !opsSession && hhSession.householdId !== householdId) {
      return NextResponse.json(
        { error: "Forbidden — you can only manage autonomy for your own household" },
        { status: 403 }
      )
    }

    const body = await request.json()
    const parsed = patchSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      )
    }

    const { promotionPaused, currentLevel } = parsed.data

    // Ensure record exists
    const existing = await db.householdCategoryAutonomy.findUnique({
      where: { householdId_category: { householdId, category } },
    })

    if (!existing) {
      return NextResponse.json(
        { error: "No autonomy record for this household+category" },
        { status: 404 }
      )
    }

    const updateData: Record<string, unknown> = {}
    if (promotionPaused !== undefined) updateData.promotionPaused = promotionPaused
    if (currentLevel !== undefined) {
      updateData.currentLevel = currentLevel
      // Reset cycle counter when manually changing level
      if (currentLevel !== existing.currentLevel) {
        updateData.verifiedCyclesAtLevel = 0
      }
    }

    const updated = await db.householdCategoryAutonomy.update({
      where: { householdId_category: { householdId, category } },
      data: updateData,
    })

    return NextResponse.json({ autonomy: updated })
  } catch (error) {
    console.error("PATCH /api/autonomy/[householdId]/[category] error:", error)
    return NextResponse.json(
      { error: "Failed to update autonomy settings" },
      { status: 500 }
    )
  }
}