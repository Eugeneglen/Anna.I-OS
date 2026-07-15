// ============================================================
// Anna.I — Routing Engine (Phase 2A)
// Weighted scoring algorithm for vendor selection
// ============================================================

import { db } from "@/lib/db"
import { VendorSuggestion, ScoreBreakdown } from "@/lib/types"
import { VendorStatus } from "@prisma/client"

/** Base score every vendor starts with */
const BASE_SCORE = 100

/** Affinity: +15 if has prior bookings, +5 per additional (cap +30 total) */
function calcAffinityBonus(bookingCount: number): number {
  if (bookingCount <= 0) return 0
  // First booking gives +15, each additional gives +5, capped at +30
  return Math.min(15 + Math.max(0, bookingCount - 1) * 5, 30)
}

/** Rating: avgRating * 3, capped at +15 */
function calcRatingBonus(avgRating: number | null): number {
  if (avgRating === null || avgRating === undefined) return 0
  return Math.min(avgRating * 3, 15)
}

/** Dispute: -20 per dispute */
function calcDisputePenalty(disputeCount: number): number {
  return -20 * disputeCount
}

/** Reassignment: -5 per reassignment */
function calcReassignmentPenalty(reassignmentCount: number): number {
  return -5 * reassignmentCount
}

/** Utilisation: penalise if >50% capacity, -(todayBookings / maxTasksPerDay * 10) */
function calcUtilisationPenalty(
  todayBookings: number,
  maxTasksPerDay: number
): number {
  const utilisation = todayBookings / maxTasksPerDay
  if (utilisation <= 0.5) return 0
  return -(utilisation * 10)
}

/** Zone match: +10 if vendor zones overlap with household postal code prefix */
function calcZoneMatchBonus(
  vendorZones: string[],
  householdPostalCode: string | null
): number {
  if (!householdPostalCode || vendorZones.length === 0) return 0
  // Singapore postal codes: first 2 digits = district
  const prefix = householdPostalCode.trim().slice(0, 2)
  if (!prefix) return 0
  // Check if any vendor zone matches the prefix
  const matched = vendorZones.some(
    (zone) => zone.trim().slice(0, 2) === prefix
  )
  return matched ? 10 : 0
}

/** Recent completion: +5 if last completed within 7 days */
function calcRecentCompletionBonus(lastCompletedAt: Date | null): number {
  if (!lastCompletedAt) return 0
  const now = new Date()
  const diffMs = now.getTime() - lastCompletedAt.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  return diffDays <= 7 ? 5 : 0
}

/** Build a human-readable reason string from the score breakdown */
function buildReason(
  vendorName: string,
  score: number,
  breakdown: ScoreBreakdown
): string {
  const reasons: string[] = []

  if (breakdown.affinityBonus > 0) {
    reasons.push(`familiar with this household (+${breakdown.affinityBonus})`)
  }
  if (breakdown.ratingBonus > 0) {
    reasons.push(`strong ratings (+${breakdown.ratingBonus})`)
  }
  if (breakdown.disputePenalty < 0) {
    reasons.push(`${Math.abs(breakdown.disputePenalty) / 20} past dispute(s) (${breakdown.disputePenalty})`)
  }
  if (breakdown.reassignmentPenalty < 0) {
    reasons.push(`${Math.abs(breakdown.reassignmentPenalty) / 5} reassignment(s) (${breakdown.reassignmentPenalty})`)
  }
  if (breakdown.utilisationPenalty < 0) {
    reasons.push(`high workload today (${breakdown.utilisationPenalty})`)
  }
  if (breakdown.zoneMatchBonus > 0) {
    reasons.push(`nearby zone match (+${breakdown.zoneMatchBonus})`)
  }
  if (breakdown.recentCompletionBonus > 0) {
    reasons.push(`recently completed a job (+${breakdown.recentCompletionBonus})`)
  }

  if (reasons.length === 0) {
    return `${vendorName} — score ${score} (baseline, no special factors)`
  }

  return `${vendorName} — score ${score}: ${reasons.join(", ")}`
}

/**
 * Get ranked vendor suggestions for a task.
 * Filters by category match and ACTIVE status, then scores using weighted factors.
 */
export async function getSuggestedVendors(
  taskId: string
): Promise<VendorSuggestion[]> {
  // 1. Fetch the task with household info
  const task = await db.task.findUnique({
    where: { id: taskId },
    include: { household: { select: { id: true, postalCode: true } } },
  })

  if (!task) {
    throw new Error("Task not found")
  }

  const { category, householdId, household } = task

  // 2. Fetch all ACTIVE vendors with their categories
  const vendors = await db.vendor.findMany({
    where: { status: VendorStatus.ACTIVE },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      categories: true,
      status: true,
      maxTasksPerDay: true,
      zones: true,
    },
  })

  // 3. Filter by category match (must-have, not a score factor)
  const categoryMatched = vendors.filter((v) => {
    try {
      const cats: string[] = JSON.parse(v.categories)
      return cats.includes(category)
    } catch {
      return false
    }
  })

  if (categoryMatched.length === 0) {
    return []
  }

  // 4. Batch-fetch affinity data for this household
  const affinities = await db.vendorHouseholdAffinity.findMany({
    where: { householdId, category },
  })

  // Build a lookup map: vendorId → affinity
  const affinityMap = new Map(
    affinities.map((a) => [a.vendorId, a])
  )

  // 5. Batch-fetch today's active booking counts per vendor
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  const activeStatuses = ["assigned", "accepted", "in_progress"]
  const todayBookings = await db.booking.groupBy({
    by: ["vendorId"],
    where: {
      scheduledStart: { gte: todayStart, lte: todayEnd },
      status: { in: activeStatuses },
      vendorId: { in: categoryMatched.map((v) => v.id) },
    },
    _count: { id: true },
  })

  const bookingCountMap = new Map(
    todayBookings.map((b) => [b.vendorId, b._count.id])
  )

  // 6. Score each vendor
  const suggestions: VendorSuggestion[] = categoryMatched.map((vendor) => {
    const affinity = affinityMap.get(vendor.id)
    const todayCount = bookingCountMap.get(vendor.id) ?? 0

    let vendorZones: string[] = []
    try {
      vendorZones = JSON.parse(vendor.zones)
    } catch {
      // zones not valid JSON, treat as empty
    }

    const affinityBonus = calcAffinityBonus(affinity?.bookingCount ?? 0)
    const ratingBonus = calcRatingBonus(affinity?.avgRating ?? null)
    const disputePenalty = calcDisputePenalty(affinity?.disputeCount ?? 0)
    const reassignmentPenalty = calcReassignmentPenalty(
      affinity?.reassignmentCount ?? 0
    )
    const utilisationPenalty = calcUtilisationPenalty(
      todayCount,
      vendor.maxTasksPerDay
    )
    const zoneMatchBonus = calcZoneMatchBonus(
      vendorZones,
      household.postalCode
    )
    const recentCompletionBonus = calcRecentCompletionBonus(
      affinity?.lastCompletedAt ?? null
    )

    const breakdown: ScoreBreakdown = {
      categoryMatch: true,
      affinityBonus,
      ratingBonus,
      disputePenalty,
      reassignmentPenalty,
      utilisationPenalty,
      zoneMatchBonus,
      recentCompletionBonus,
    }

    const score = Math.round(
      BASE_SCORE +
        affinityBonus +
        ratingBonus +
        disputePenalty +
        reassignmentPenalty +
        utilisationPenalty +
        zoneMatchBonus +
        recentCompletionBonus
    )

    const reason = buildReason(vendor.name, score, breakdown)

    return {
      vendor: {
        id: vendor.id,
        name: vendor.name,
        email: vendor.email,
        phone: vendor.phone,
        categories: vendor.categories,
        status: vendor.status,
        maxTasksPerDay: vendor.maxTasksPerDay,
        zones: vendor.zones,
      },
      score,
      scoreBreakdown: breakdown,
      reason,
    }
  })

  // 7. Sort by score descending
  suggestions.sort((a, b) => b.score - a.score)

  return suggestions
}

/**
 * Auto-select the top-scored vendor for a task.
 * Throws if no vendors are available.
 */
export async function autoSelectVendor(
  taskId: string
): Promise<VendorSuggestion> {
  const suggestions = await getSuggestedVendors(taskId)

  if (suggestions.length === 0) {
    throw new Error("No eligible vendors available for this task")
  }

  return suggestions[0]
}