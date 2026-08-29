import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import {
  HOME_TYPE_LABELS,
  HDB_SIZE_LABELS,
  OCCUPANT_LABELS,
  MEMBER_LABELS,
  PET_LABELS,
  SCHEDULE_LABELS,
  PAIN_POINT_LABELS,
  FREQUENCY_LABELS,
  DAY_LABELS,
  TIME_LABELS,
  AUTONOMY_LABELS,
  ACQUISITION_LABELS,
  getProfileValue,
  resolveLabel,
} from "@/lib/household-labels";

// ──────────────────────────────────────────────────────────
// GET /api/ops/households/[id]/export?format=csv|json
// Exports a single household's full profile + intelligence.
// Requires ops session (auth-gated).
// ──────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const format = (searchParams.get("format") || "csv").toLowerCase();

    // Fetch the household + relations
    const household = await db.household.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        fullName: true,
        email: true,
        phone: true,
        address: true,
        postalCode: true,
        unitNumber: true,
        activeCategories: true,
        preferences: true,
        onboardingStep: true,
        onboardingCompletedAt: true,
        onboardingProfile: true,
        acquisitionSource: true,
        acquisitionCampaignId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!household) {
      return NextResponse.json({ error: "Household not found" }, { status: 404 });
    }

    const [members, tasks, subscriptions, categoryAutonomy] = await Promise.all([
      db.familyMember.findMany({
        where: { householdId: id },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, email: true, phone: true, role: true },
      }),
      db.task.findMany({
        where: { householdId: id, cancelledAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, jobNo: true, category: true, status: true,
          amountCents: true, discountCents: true, finalAmountCents: true,
          createdAt: true, completedAt: true, verifiedAt: true,
        },
        take: 50,
      }),
      db.subscription.findMany({
        where: { householdId: id },
        select: { id: true, tier: true, status: true, priceCents: true, billingCycleStart: true },
      }),
      db.householdCategoryAutonomy.findMany({
        where: { householdId: id },
        select: { category: true, currentLevel: true, totalVerifiedCycles: true },
      }),
    ]);

    const profile = (household.onboardingProfile as Record<string, unknown>) || {};

    // ── JSON format ──
    if (format === "json") {
      const exportData = {
        exportedAt: new Date().toISOString(),
        exportedBy: session.name,
        household: {
          ...household,
          onboardingProfile: profile,
        },
        members,
        tasks,
        subscriptions,
        categoryAutonomy,
        stats: {
          totalTasks: tasks.length,
          totalSpentCents: tasks
            .filter((t) => t.status === "VERIFIED" || t.status === "ESCROW_RELEASED")
            .reduce((sum, t) => sum + (t.amountCents || 0), 0),
          memberCount: members.length,
        },
      };

      return new NextResponse(JSON.stringify(exportData, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="household-${household.name.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json"`,
        },
      });
    }

    // ── CSV format ──
    const rows: string[] = [];

    // Header
    const headers = [
      "Household ID",
      "Household Name",
      "Email",
      "Phone",
      "Address",
      "Postal Code",
      "Unit Number",
      "Subscription Tier",
      "Subscription Status",
      "Acquisition Source",
      "Acquisition Campaign ID",
      "Onboarding Step",
      "Onboarding Completed At",
      "Home Type",
      "HDB Size",
      "Occupants",
      "Members",
      "Pets",
      "Schedule",
      "Room Count",
      "Pain Points",
      "Cleaning Frequency",
      "Aircon Frequency",
      "Repairs Frequency",
      "Laundry Frequency",
      "Preferred Day",
      "Preferred Time",
      "Autonomy Preference",
      "Total Tasks",
      "Total Spent (SGD)",
      "Member Count",
      "Updated At",
    ];
    rows.push(headers.map(quoteCsv).join(","));

    // Build the data row
    const homeType = getProfileValue(profile, "home", "homeType") as string;
    const homeSize = getProfileValue(profile, "home", "homeSize") as string;
    const occupants = getProfileValue(profile, "home", "occupants") as string;
    const memberTypes = (getProfileValue(profile, "people", "members") as string[]) || [];
    const petTypes = (getProfileValue(profile, "people", "petTypes") as string[]) ||
      (getProfileValue(profile, "people", "pets") as string[]) || [];
    const schedule = getProfileValue(profile, "people", "schedule") as string;
    const roomCount = getProfileValue(profile, "people", "roomCount") as string;
    const painPoints = (getProfileValue(profile, "painPoints", "tasks") as string[]) ||
      (getProfileValue(profile, "painPoints", "timeConsumingTasks") as string[]) || [];
    const serviceHabits = (getProfileValue(profile, "serviceHabits", "categoryFrequency") as Record<string, string>) ||
      (getProfileValue(profile, "serviceHabits") as Record<string, string>) || {};
    const preferredDay = getProfileValue(profile, "preferences", "preferredDay") as string;
    const preferredTime = getProfileValue(profile, "preferences", "preferredTime") as string;
    const autonomyPref = (getProfileValue(profile, "preferences", "autonomyLevel") as string) ||
      (getProfileValue(profile, "preferences", "autonomyPreference") as string);

    const sub = subscriptions[0] || {};
    const totalSpentCents = tasks
      .filter((t) => t.status === "VERIFIED" || t.status === "ESCROW_RELEASED")
      .reduce((sum, t) => sum + (t.amountCents || 0), 0);

    const row = [
      household.id,
      household.name,
      household.email || "",
      household.phone || "",
      household.address || "",
      household.postalCode || "",
      household.unitNumber || "",
      sub.tier || "",
      sub.status || "",
      resolveLabel(ACQUISITION_LABELS, household.acquisitionSource || undefined),
      household.acquisitionCampaignId || "",
      String(household.onboardingStep),
      household.onboardingCompletedAt ? new Date(household.onboardingCompletedAt).toISOString() : "",
      resolveLabel(HOME_TYPE_LABELS, homeType || undefined),
      resolveLabel(HDB_SIZE_LABELS, homeSize || undefined),
      resolveLabel(OCCUPANT_LABELS, occupants || undefined),
      memberTypes.map((m) => resolveLabel(MEMBER_LABELS, m)).join("; "),
      petTypes.map((p) => resolveLabel(PET_LABELS, p)).join("; "),
      resolveLabel(SCHEDULE_LABELS, schedule || undefined),
      roomCount ? `${roomCount} rooms` : "",
      painPoints.map((p) => resolveLabel(PAIN_POINT_LABELS, p)).join("; "),
      resolveLabel(FREQUENCY_LABELS, serviceHabits.CLEANING || undefined),
      resolveLabel(FREQUENCY_LABELS, serviceHabits.AIRCON || undefined),
      resolveLabel(FREQUENCY_LABELS, serviceHabits.REPAIRS || undefined),
      resolveLabel(FREQUENCY_LABELS, serviceHabits.LAUNDRY || undefined),
      resolveLabel(DAY_LABELS, preferredDay || undefined),
      resolveLabel(TIME_LABELS, preferredTime || undefined),
      resolveLabel(AUTONOMY_LABELS, autonomyPref || undefined),
      String(tasks.length),
      (totalSpentCents / 100).toFixed(2),
      String(members.length),
      household.updatedAt ? new Date(household.updatedAt).toISOString() : "",
    ];
    rows.push(row.map(quoteCsv).join(","));

    const csv = rows.join("\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="household-${household.name.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    console.error("[/api/ops/households/[id]/export GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

/** CSV field quoting — wraps in double quotes, escapes internal quotes. */
function quoteCsv(value: string): string {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
