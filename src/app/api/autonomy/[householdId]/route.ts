import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { AUTONOMY_LEVEL_NAMES, MAX_AUTONOMY_LEVEL } from "@/lib/constants"

const ALL_CATEGORIES = ["CLEANING", "LAUNDRY", "AIRCON", "HANDYMAN"] as const

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ householdId: string }> }
) {
  try {
    const { householdId } = await params

    // Ensure all 4 categories have an autonomy record (upsert missing ones)
    await db.$transaction(
      ALL_CATEGORIES.map((category) =>
        db.householdCategoryAutonomy.upsert({
          where: {
            householdId_category: { householdId, category },
          },
          create: {
            householdId,
            category,
            currentLevel: 1,
            verifiedCyclesAtLevel: 0,
            totalVerifiedCycles: 0,
          },
          update: {}, // no-op if exists
        })
      )
    )

    const [autonomy, thresholds] = await Promise.all([
      db.householdCategoryAutonomy.findMany({
        where: { householdId },
      }),
      db.autonomyLevelThreshold.findMany({
        orderBy: [{ category: "asc" }, { level: "asc" }],
      }),
    ])

    // Build a quick lookup for thresholds: category -> level -> cyclesRequired
    const thresholdMap = new Map<string, Map<number, number>>()
    for (const t of thresholds) {
      if (!thresholdMap.has(t.category)) {
        thresholdMap.set(t.category, new Map())
      }
      thresholdMap.get(t.category)!.set(t.level, t.cyclesRequired)
    }

    // Enrich autonomy records with computed fields
    const enrichedAutonomy = autonomy.map((a) => {
      const catThresholds = thresholdMap.get(a.category)
      const currentLevel = a.currentLevel
      const nextLevel = currentLevel < MAX_AUTONOMY_LEVEL ? currentLevel + 1 : null

      let cyclesRemaining: number | null = null
      let nextLevelName: string | null = null

      if (nextLevel !== null && catThresholds) {
        const required = catThresholds.get(nextLevel) ?? 0
        cyclesRemaining = Math.max(0, required - a.verifiedCyclesAtLevel)
        nextLevelName = AUTONOMY_LEVEL_NAMES[nextLevel - 1] ?? `Level ${nextLevel}`
      }

      return {
        ...a,
        nextLevel,
        cyclesRemaining,
        nextLevelName,
        currentLevelName: AUTONOMY_LEVEL_NAMES[currentLevel - 1] ?? `Level ${currentLevel}`,
      }
    })

    return NextResponse.json({
      autonomy: enrichedAutonomy,
      thresholds,
    })
  } catch (error) {
    console.error("GET /api/autonomy/[householdId] error:", error)
    return NextResponse.json(
      { error: "Failed to fetch autonomy data" },
      { status: 500 }
    )
  }
}