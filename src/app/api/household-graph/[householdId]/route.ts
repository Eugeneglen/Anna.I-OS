import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import {
  AUTONOMY_LEVEL_NAMES,
  MAX_AUTONOMY_LEVEL,
  ACTIVE_CATEGORIES,
} from "@/lib/constants"
import { ServiceCategory } from "@prisma/client"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AutonomyInfo {
  currentLevel: number
  currentLevelName: string
  verifiedCyclesAtLevel: number
  totalVerifiedCycles: number
  nextLevel: number | null
  nextLevelName: string | null
  cyclesRemaining: number | null
  promotionPaused: boolean
  lastPromotedAt: string | null
}

interface VendorAffinityItem {
  vendorId: string
  vendorName: string
  bookingCount: number
  completedCount: number
  avgRating: number | null
  disputeCount: number
}

interface BookingStats {
  total: number
  completed: number
  verified: number
  disputed: number
  avgCycleDays: number | null
  totalSpendCents: number
}

interface RecentTask {
  id: string
  status: string
  amountCents: number
  verifiedAt: string | null
  scheduledStart: string | null
}

interface CategoryGraph {
  category: ServiceCategory
  autonomy: AutonomyInfo
  vendorAffinity: VendorAffinityItem[]
  bookingStats: BookingStats
  recentTasks: RecentTask[]
}

interface GraphSummary {
  totalVerifiedCycles: number
  totalSpendCents: number
  activeCategories: number
  totalBookings: number
}

interface HouseholdGraphResponse {
  summary: GraphSummary
  categories: CategoryGraph[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildThresholdMap(
  thresholds: { category: string; level: number; cyclesRequired: number }[]
): Map<string, Map<number, number>> {
  const map = new Map<string, Map<number, number>>()
  for (const t of thresholds) {
    if (!map.has(t.category)) {
      map.set(t.category, new Map())
    }
    map.get(t.category)!.set(t.level, t.cyclesRequired)
  }
  return map
}

function buildAutonomyInfo(
  record: {
    currentLevel: number
    verifiedCyclesAtLevel: number
    totalVerifiedCycles: number
    promotionPaused: boolean
    lastPromotedAt: Date | null
    category: ServiceCategory
  },
  thresholdMap: Map<string, Map<number, number>>
): AutonomyInfo {
  const catThresholds = thresholdMap.get(record.category)
  const currentLevel = record.currentLevel
  const nextLevel =
    currentLevel < MAX_AUTONOMY_LEVEL ? currentLevel + 1 : null

  let cyclesRemaining: number | null = null
  let nextLevelName: string | null = null

  if (nextLevel !== null && catThresholds) {
    const required = catThresholds.get(nextLevel) ?? 0
    cyclesRemaining = Math.max(0, required - record.verifiedCyclesAtLevel)
    nextLevelName = AUTONOMY_LEVEL_NAMES[nextLevel - 1] ?? `Level ${nextLevel}`
  }

  return {
    currentLevel,
    currentLevelName:
      AUTONOMY_LEVEL_NAMES[currentLevel - 1] ?? `Level ${currentLevel}`,
    verifiedCyclesAtLevel: record.verifiedCyclesAtLevel,
    totalVerifiedCycles: record.totalVerifiedCycles,
    nextLevel,
    nextLevelName,
    cyclesRemaining,
    promotionPaused: record.promotionPaused,
    lastPromotedAt: record.lastPromotedAt?.toISOString() ?? null,
  }
}

function computeAvgCycleDays(
  bookings: { scheduledStart: Date | null }[]
): number | null {
  // We need at least 2 bookings with scheduledStart to compute a cycle
  const withDates = bookings
    .map((b) => b.scheduledStart?.getTime())
    .filter((d): d is number => d !== undefined && !isNaN(d))
    .sort((a, b) => a - b)

  if (withDates.length < 2) return null

  const diffs: number[] = []
  for (let i = 1; i < withDates.length; i++) {
    const diffMs = withDates[i] - withDates[i - 1]
    const diffDays = diffMs / (1000 * 60 * 60 * 24)
    if (diffDays > 0) {
      diffs.push(diffDays)
    }
  }

  if (diffs.length === 0) return null

  const avg = diffs.reduce((sum, d) => sum + d, 0) / diffs.length
  return Math.round(avg)
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ householdId: string }> }
) {
  try {
    const { householdId } = await params

    // Run all independent queries in parallel
    const [autonomyRecords, thresholds, vendorAffinities, tasks] =
      await Promise.all([
        // 1. Autonomy records for this household (all categories that have a record)
        db.householdCategoryAutonomy.findMany({
          where: { householdId },
        }),

        // 2. Autonomy level thresholds for all categories
        db.autonomyLevelThreshold.findMany({
          orderBy: [{ category: "asc" }, { level: "asc" }],
        }),

        // 3. Vendor affinity records with vendor names
        db.vendorHouseholdAffinity.findMany({
          where: { householdId },
          include: {
            vendor: {
              select: { name: true },
            },
          },
          orderBy: [{ category: "asc" }, { bookingCount: "desc" }],
        }),

        // 4. All tasks for the household with their bookings (for stats + recent + cycle calc)
        db.task.findMany({
          where: { householdId },
          include: {
            bookings: {
              select: {
                scheduledStart: true,
                completedAt: true,
              },
            },
          },
          orderBy: [{ createdAt: "desc" }],
        }),
      ])

    // Build threshold lookup map
    const thresholdMap = buildThresholdMap(thresholds)

    // Group vendor affinities by category
    const affinityByCategory = new Map<
      ServiceCategory,
      (typeof vendorAffinities)[number][]
    >()
    for (const affinity of vendorAffinities) {
      if (!affinityByCategory.has(affinity.category)) {
        affinityByCategory.set(affinity.category, [])
      }
      affinityByCategory.get(affinity.category)!.push(affinity)
    }

    // Group tasks by category
    const tasksByCategory = new Map<ServiceCategory, (typeof tasks)[number][]>()
    for (const task of tasks) {
      if (!tasksByCategory.has(task.category)) {
        tasksByCategory.set(task.category, [])
      }
      tasksByCategory.get(task.category)!.push(task)
    }

    // Build a map of autonomy records by category
    const autonomyByCategory = new Map<
      ServiceCategory,
      (typeof autonomyRecords)[number]
    >()
    for (const record of autonomyRecords) {
      autonomyByCategory.set(record.category, record)
    }

    // Determine which categories to include: those with autonomy records OR with tasks
    const relevantCategories = new Set<ServiceCategory>()
    for (const record of autonomyRecords) {
      relevantCategories.add(record.category)
    }
    for (const task of tasks) {
      relevantCategories.add(task.category)
    }

    // Sort categories according to ACTIVE_CATEGORIES order
    const activeOrder = ACTIVE_CATEGORIES as readonly string[]
    const sortedCategories = Array.from(relevantCategories).sort((a, b) => {
      const aIdx = activeOrder.indexOf(a)
      const bIdx = activeOrder.indexOf(b)
      // Categories in ACTIVE_CATEGORIES come first, in order; others after
      if (aIdx === -1 && bIdx === -1) return a.localeCompare(b)
      if (aIdx === -1) return 1
      if (bIdx === -1) return -1
      return aIdx - bIdx
    })

    // Build category data
    let totalVerifiedCycles = 0
    let totalSpendCents = 0
    let totalBookings = 0

    const categories: CategoryGraph[] = []

    for (const category of sortedCategories) {
      const autonomyRecord = autonomyByCategory.get(category)
      const categoryTasks = tasksByCategory.get(category) ?? []
      const categoryAffinities = affinityByCategory.get(category) ?? []

      // --- Autonomy info ---
      // If no autonomy record exists, create a default one for display
      const autonomyInfo: AutonomyInfo = autonomyRecord
        ? buildAutonomyInfo(autonomyRecord, thresholdMap)
        : {
            currentLevel: 1,
            currentLevelName: AUTONOMY_LEVEL_NAMES[0] ?? "Manual",
            verifiedCyclesAtLevel: 0,
            totalVerifiedCycles: 0,
            nextLevel: 2,
            nextLevelName: AUTONOMY_LEVEL_NAMES[1] ?? "Guided Suggestions",
            cyclesRemaining: thresholdMap.get(category)?.get(2) ?? 2,
            promotionPaused: false,
            lastPromotedAt: null,
          }

      totalVerifiedCycles += autonomyInfo.totalVerifiedCycles

      // --- Vendor affinity ---
      const vendorAffinity: VendorAffinityItem[] = categoryAffinities.map(
        (a) => ({
          vendorId: a.vendorId,
          vendorName: a.vendor.name,
          bookingCount: a.bookingCount,
          completedCount: a.completedCount,
          avgRating: a.avgRating,
          disputeCount: a.disputeCount,
        })
      )

      // --- Booking / Task stats ---
      const completedTasks = categoryTasks.filter(
        (t) =>
          t.status === "COMPLETED" ||
          t.status === "VERIFIED" ||
          t.status === "ESCROW_RELEASED"
      )
      const verifiedTasks = categoryTasks.filter(
        (t) => t.status === "VERIFIED" || t.status === "ESCROW_RELEASED"
      )
      const disputedTasks = categoryTasks.filter(
        (t) => t.status === "DISPUTED"
      )

      // Count bookings: each task may have bookings
      let bookingCount = 0
      const allBookingDates: { scheduledStart: Date | null }[] = []
      for (const task of categoryTasks) {
        bookingCount += task.bookings.length
        for (const b of task.bookings) {
          allBookingDates.push({ scheduledStart: b.scheduledStart })
        }
      }

      const totalSpend = categoryTasks.reduce(
        (sum, t) => sum + t.amountCents,
        0
      )

      // Only count completed bookings (those linked to completed/verified tasks)
      let completedBookingCount = 0
      for (const task of completedTasks) {
        completedBookingCount += task.bookings.length
      }

      const avgCycleDays = computeAvgCycleDays(allBookingDates)

      const bookingStats: BookingStats = {
        total: bookingCount,
        completed: completedBookingCount,
        verified: verifiedTasks.length,
        disputed: disputedTasks.length,
        avgCycleDays,
        totalSpendCents: totalSpend,
      }

      totalSpendCents += totalSpend
      totalBookings += bookingCount

      // --- Recent tasks (last 5 completed/verified) ---
      const recentCompleted = categoryTasks
        .filter(
          (t) =>
            t.status === "COMPLETED" ||
            t.status === "VERIFIED" ||
            t.status === "ESCROW_RELEASED"
        )
        .slice(0, 5)

      const recentTasks: RecentTask[] = recentCompleted.map((t) => ({
        id: t.id,
        status: t.status,
        amountCents: t.amountCents,
        verifiedAt: t.verifiedAt?.toISOString() ?? null,
        scheduledStart: t.scheduledStart?.toISOString() ?? null,
      }))

      categories.push({
        category,
        autonomy: autonomyInfo,
        vendorAffinity,
        bookingStats,
        recentTasks,
      })
    }

    const summary: GraphSummary = {
      totalVerifiedCycles,
      totalSpendCents,
      activeCategories: categories.length,
      totalBookings,
    }

    const response: HouseholdGraphResponse = {
      summary,
      categories,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error("GET /api/household-graph/[householdId] error:", error)
    return NextResponse.json(
      { error: "Failed to fetch household graph data" },
      { status: 500 }
    )
  }
}
