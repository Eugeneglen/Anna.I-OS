import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getHouseholdSession } from "@/lib/household-auth"

const ALLOWED_SECTIONS = [
  "home",
  "people",
  "painPoints",
  "serviceHabits",
  "preferences",
  "all",
] as const

type AllowedSection = (typeof ALLOWED_SECTIONS)[number]

/** Deep merge source into target (plain objects only, arrays are replaced). */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target }
  for (const key of Object.keys(source) as string[]) {
    const srcVal = source[key]
    const tgtVal = result[key]
    if (
      srcVal &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>
      )
    } else {
      result[key] = srcVal
    }
  }
  return result
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // --- Auth ---
    const session = await getHouseholdSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params

    // Ensure the session matches the requested household
    if (session.householdId !== id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // --- Parse body ---
    let body: { section?: unknown; data?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      )
    }

    const { section, data } = body

    if (!section || typeof section !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'section' field" },
        { status: 400 }
      )
    }

    if (!ALLOWED_SECTIONS.includes(section as AllowedSection)) {
      return NextResponse.json(
        { error: `Invalid section. Allowed: ${ALLOWED_SECTIONS.join(", ")}` },
        { status: 400 }
      )
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return NextResponse.json(
        { error: "Missing or invalid 'data' field (must be an object)" },
        { status: 400 }
      )
    }

    // --- Fetch existing household ---
    const existing = await db.household.findUnique({
      where: { id },
      select: { id: true, onboardingProfile: true, preferences: true },
    })

    if (!existing) {
      return NextResponse.json({ error: "Household not found" }, { status: 404 })
    }

    const currentProfile = (existing.onboardingProfile as Record<string, unknown>) || {}
    const currentPreferences = (existing.preferences as Record<string, unknown>) || {}

    let updatedProfile: Record<string, unknown>
    let updatedPreferences: Record<string, unknown> | null = null

    if (section === "all") {
      // Replace the entire onboardingProfile
      updatedProfile = data as Record<string, unknown>
    } else {
      // Deep merge the section into existing profile
      const sectionData = currentProfile[section] as Record<string, unknown> | undefined
      const mergedSection = sectionData
        ? deepMerge(sectionData, data as Record<string, unknown>)
        : (data as Record<string, unknown>)

      updatedProfile = { ...currentProfile, [section]: mergedSection }

      // Sync preferredDay / preferredTime into household.preferences for backward compat
      if (section === "preferences") {
        const prefData = data as Record<string, unknown>
        const syncKeys = ["preferredDay", "preferredTime"]
        const hasRelevantKey = syncKeys.some((k) => k in prefData)

        if (hasRelevantKey) {
          updatedPreferences = { ...currentPreferences }
          for (const key of syncKeys) {
            if (key in prefData) {
              updatedPreferences[key] = prefData[key]
            }
          }
        }
      }
    }

    // --- Update ---
    const updateData: Record<string, unknown> = {
      onboardingProfile: updatedProfile,
    }
    if (updatedPreferences) {
      updateData.preferences = updatedPreferences
    }

    const household = await db.household.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json({ household })
  } catch (error) {
    console.error("PATCH /api/households/[id]/profile error:", error)
    return NextResponse.json(
      { error: "Failed to update household profile" },
      { status: 500 }
    )
  }
}
