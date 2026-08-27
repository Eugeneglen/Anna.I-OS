import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import {
  HOME_TYPE_LABELS,
  OCCUPANT_LABELS,
  MEMBER_LABELS,
  PET_LABELS,
  SCHEDULE_LABELS,
  PAIN_POINT_LABELS,
  FREQUENCY_LABELS,
  ACQUISITION_LABELS,
  getProfileValue,
  resolveLabel,
} from "@/lib/household-labels";

// ──────────────────────────────────────────────────────────
// GET /api/ops/households/export-all?format=csv
// Bulk exports ALL households' intelligence as CSV.
// Requires ops session (auth-gated).
// ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const format = (searchParams.get("format") || "csv").toLowerCase();
    if (format !== "csv") {
      return NextResponse.json(
        { error: `Unsupported format: ${format}. Only 'csv' is supported for bulk export.` },
        { status: 400 }
      );
    }

    const households = await db.household.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        postalCode: true,
        unitNumber: true,
        onboardingStep: true,
        onboardingCompletedAt: true,
        onboardingProfile: true,
        acquisitionSource: true,
        acquisitionCampaignId: true,
        createdAt: true,
        updatedAt: true,
        subscriptions: {
          select: { tier: true, status: true },
          take: 1,
        },
        members: {
          select: { id: true, name: true, email: true, role: true },
        },
        tasks: {
          where: { cancelledAt: null },
          select: { amountCents: true, status: true },
        },
      },
    });

    const headers = [
      "Household ID",
      "Name",
      "Email",
      "Phone",
      "Address",
      "Postal Code",
      "Unit",
      "Subscription Tier",
      "Subscription Status",
      "Acquisition Source",
      "Onboarding Step",
      "Onboarding Completed",
      "Home Type",
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
      "Total Tasks",
      "Total Spent (SGD)",
      "Member Count",
      "Created At",
      "Updated At",
    ];

    const rows: string[] = [headers.map(quoteCsv).join(",")];

    for (const hh of households) {
      const profile = (hh.onboardingProfile as Record<string, unknown>) || {};
      const homeType = getProfileValue(profile, "home", "homeType") as string;
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

      const sub = hh.subscriptions[0] || {};
      const totalSpentCents = hh.tasks
        .filter((t) => t.status === "VERIFIED" || t.status === "ESCROW_RELEASED")
        .reduce((sum, t) => sum + t.amountCents, 0);

      rows.push([
        hh.id,
        hh.name,
        hh.email || "",
        hh.phone || "",
        hh.address || "",
        hh.postalCode || "",
        hh.unitNumber || "",
        sub.tier || "",
        sub.status || "",
        resolveLabel(ACQUISITION_LABELS, hh.acquisitionSource || undefined),
        String(hh.onboardingStep),
        hh.onboardingCompletedAt ? new Date(hh.onboardingCompletedAt).toISOString() : "",
        resolveLabel(HOME_TYPE_LABELS, homeType || undefined),
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
        String(hh.tasks.length),
        (totalSpentCents / 100).toFixed(2),
        String(hh.members.length),
        new Date(hh.createdAt).toISOString(),
        new Date(hh.updatedAt).toISOString(),
      ].map(quoteCsv).join(","));
    }

    const csv = rows.join("\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="all-households-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    console.error("[/api/ops/households/export-all GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function quoteCsv(value: string): string {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
