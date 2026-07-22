import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { AUTONOMY_LEVEL_NAMES, MAX_AUTONOMY_LEVEL } from "@/lib/constants";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const category = searchParams.get("category") || "";

    // Fetch all households with their autonomy records
    const households = await db.household.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search } },
              { email: { contains: search } },
            ],
          }
        : undefined,
      select: {
        id: true,
        name: true,
        email: true,
        categoryAutonomy: {
          select: {
            id: true,
            category: true,
            currentLevel: true,
            verifiedCyclesAtLevel: true,
            totalVerifiedCycles: true,
            promotionPaused: true,
            lastPromotedAt: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Fetch all thresholds
    const thresholds = await db.autonomyLevelThreshold.findMany({
      orderBy: [{ category: "asc" }, { level: "asc" }],
    });

    // Build threshold lookup
    const thresholdMap = new Map<string, Map<number, number>>();
    for (const t of thresholds) {
      if (!thresholdMap.has(t.category)) {
        thresholdMap.set(t.category, new Map());
      }
      thresholdMap.get(t.category)!.set(t.level, t.cyclesRequired);
    }

    // Compute unique categories from autonomy data
    const allCategories = new Set<string>();
    for (const h of households) {
      for (const a of h.categoryAutonomy) {
        allCategories.add(a.category);
      }
    }

    // Enrich autonomy records
    let totalLevel = 0;
    let totalRecords = 0;
    let atMaxLevel = 0;
    const levelDistribution: Record<number, number> = {};

    const enrichedHouseholds = households.map((h) => {
      const levels = h.categoryAutonomy
        .filter((a) => !category || a.category === category)
        .map((a) => {
          const catThresholds = thresholdMap.get(a.category);
          const nextLevel =
            a.currentLevel < MAX_AUTONOMY_LEVEL ? a.currentLevel + 1 : null;
          let cyclesRemaining: number | null = null;
          let nextLevelName: string | null = null;

          if (nextLevel !== null && catThresholds) {
            const required = catThresholds.get(nextLevel) ?? 0;
            cyclesRemaining = Math.max(0, required - a.verifiedCyclesAtLevel);
            nextLevelName =
              AUTONOMY_LEVEL_NAMES[nextLevel - 1] ?? `Level ${nextLevel}`;
          }

          // Stats
          totalLevel += a.currentLevel;
          totalRecords++;
          if (a.currentLevel === MAX_AUTONOMY_LEVEL) atMaxLevel++;
          levelDistribution[a.currentLevel] =
            (levelDistribution[a.currentLevel] || 0) + 1;

          return {
            ...a,
            nextLevel,
            cyclesRemaining,
            nextLevelName,
            currentLevelName:
              AUTONOMY_LEVEL_NAMES[a.currentLevel - 1] ??
              `Level ${a.currentLevel}`,
          };
        });

      // Compute average level for this household
      const avgLevel =
        levels.length > 0
          ? levels.reduce((sum, l) => sum + l.currentLevel, 0) / levels.length
          : 0;

      return {
        ...h,
        autonomyLevels: levels,
        avgLevel: Math.round(avgLevel * 10) / 10,
      };
    });

    // Promotion pipeline: how many households are within 1 cycle of leveling up per category
    const pipeline: { category: string; ready: number; inProgress: number }[] =
      [];
    for (const cat of allCategories) {
      if (category && cat !== category) continue;
      let ready = 0;
      let inProgress = 0;
      for (const h of enrichedHouseholds) {
        const a = h.autonomyLevels.find((l) => l.category === cat);
        if (!a || a.promotionPaused || a.nextLevel === null) continue;
        if (a.cyclesRemaining !== null && a.cyclesRemaining <= 1) ready++;
        else inProgress++;
      }
      pipeline.push({ category: cat, ready, inProgress });
    }

    // Summary stats
    const avgLevel =
      totalRecords > 0 ? Math.round((totalLevel / totalRecords) * 10) / 10 : 0;

    const summary = {
      totalHouseholds: households.length,
      avgLevel,
      atMaxLevel,
      levelDistribution,
      pipeline,
    };

    return NextResponse.json({ households: enrichedHouseholds, summary });
  } catch (error) {
    console.error("GET /api/ops/autonomy error:", error);
    return NextResponse.json(
      { error: "Failed to fetch autonomy data" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { householdId, category, promotionPaused } = body;

    if (!householdId || !category || promotionPaused === undefined) {
      return NextResponse.json(
        { error: "householdId, category, and promotionPaused required" },
        { status: 400 }
      );
    }

    const updated = await db.householdCategoryAutonomy.upsert({
      where: {
        householdId_category: { householdId, category },
      },
      create: {
        householdId,
        category,
        currentLevel: 1,
        verifiedCyclesAtLevel: 0,
        totalVerifiedCycles: 0,
        promotionPaused,
      },
      update: { promotionPaused },
    });

    return NextResponse.json({ autonomy: updated });
  } catch (error) {
    console.error("PATCH /api/ops/autonomy error:", error);
    return NextResponse.json(
      { error: "Failed to update autonomy" },
      { status: 500 }
    );
  }
}