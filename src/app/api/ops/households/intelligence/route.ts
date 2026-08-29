import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { getProfileValue } from "@/lib/household-labels";

// ──────────────────────────────────────────────────────────
// GET /api/ops/households/intelligence
// Aggregates onboarding intelligence across all households.
// Used by the Ops Intelligence Dashboard.
// Requires ops session (auth-gated).
// ──────────────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const households = await db.household.findMany({
      select: {
        id: true,
        onboardingProfile: true,
        acquisitionSource: true,
        acquisitionCampaignId: true,
        onboardingStep: true,
        onboardingCompletedAt: true,
        createdAt: true,
        subscriptions: { select: { tier: true, status: true }, take: 1 },
      },
    });

    const total = households.length;
    const activeSubs = households.filter((h) => h.subscriptions[0]?.status === "ACTIVE").length;
    const completedOnboarding = households.filter((h) => (h.onboardingStep || 0) >= 8).length;
    const avgOnboardingStep = total > 0
      ? households.reduce((sum, h) => sum + (h.onboardingStep || 0), 0) / total
      : 0;

    // Aggregate distributions
    const homeTypeDist: Record<string, number> = {};
    const acquisitionDist: Record<string, number> = {};
    const painPointsCount: Record<string, number> = {};
    const petOwnership = { hasPets: 0, noPets: 0, types: {} as Record<string, number> };
    const serviceFreq: Record<string, Record<string, number>> = {};
    const memberTypes: Record<string, number> = {};
    const scheduleDist: Record<string, number> = {};

    for (const hh of households) {
      const profile = (hh.onboardingProfile as Record<string, unknown>) || {};

      // Home type
      const homeType = getProfileValue(profile, "home", "homeType") as string;
      if (homeType) homeTypeDist[homeType] = (homeTypeDist[homeType] || 0) + 1;

      // Acquisition source
      const acqSource = hh.acquisitionSource || "UNKNOWN";
      acquisitionDist[acqSource] = (acquisitionDist[acqSource] || 0) + 1;

      // Pain points
      const painPoints = (getProfileValue(profile, "painPoints", "tasks") as string[]) ||
        (getProfileValue(profile, "painPoints", "timeConsumingTasks") as string[]) || [];
      for (const pp of painPoints) {
        painPointsCount[pp] = (painPointsCount[pp] || 0) + 1;
      }

      // Pets
      const petTypes = (getProfileValue(profile, "people", "petTypes") as string[]) ||
        (getProfileValue(profile, "people", "pets") as string[]) || [];
      if (petTypes.length > 0) {
        petOwnership.hasPets++;
        for (const pt of petTypes) {
          petOwnership.types[pt] = (petOwnership.types[pt] || 0) + 1;
        }
      } else {
        petOwnership.noPets++;
      }

      // Service frequency
      const habits = (getProfileValue(profile, "serviceHabits", "categoryFrequency") as Record<string, string>) ||
        (getProfileValue(profile, "serviceHabits") as Record<string, string>) || {};
      for (const [cat, freq] of Object.entries(habits)) {
        if (!serviceFreq[cat]) serviceFreq[cat] = {};
        serviceFreq[cat][freq] = (serviceFreq[cat][freq] || 0) + 1;
      }

      // Member types
      const members = (getProfileValue(profile, "people", "members") as string[]) || [];
      for (const m of members) {
        memberTypes[m] = (memberTypes[m] || 0) + 1;
      }

      // Schedule
      const schedule = getProfileValue(profile, "people", "schedule") as string;
      if (schedule) scheduleDist[schedule] = (scheduleDist[schedule] || 0) + 1;
    }

    // Sort pain points by count (descending)
    const painPointsRanking = Object.entries(painPointsCount)
      .map(([task, count]) => ({ task, count, percentage: total > 0 ? count / total : 0 }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({
      overview: {
        totalHouseholds: total,
        activeSubscriptions: activeSubs,
        completedOnboarding,
        avgOnboardingStep: Math.round(avgOnboardingStep * 10) / 10,
        completionRate: total > 0 ? completedOnboarding / total : 0,
      },
      homeTypeDistribution: homeTypeDist,
      acquisitionSources: acquisitionDist,
      painPointsRanking,
      petOwnership,
      serviceFrequency: serviceFreq,
      memberTypes,
      scheduleDistribution: scheduleDist,
    });
  } catch (error) {
    console.error("[/api/ops/households/intelligence GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
