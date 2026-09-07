import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getHouseholdSession } from "@/lib/household-auth";
import { getOpsSession } from "@/lib/ops-auth";

export async function GET(request: Request) {
  try {
    // FIX-1a: previously fully unauthenticated. The household portal's
    // anomaly banner fetches its OWN anomalies (householdId query param);
    // ops may query any household. Household sessions are pinned to their
    // own householdId — a foreign householdId param yields 403.
    const [hhSession, opsSession] = await Promise.all([
      getHouseholdSession(),
      getOpsSession(),
    ]);
    if (!hhSession && !opsSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    let householdId = searchParams.get("householdId");
    if (hhSession && !opsSession) {
      if (householdId && householdId !== hhSession.householdId) {
        return NextResponse.json(
          { error: "Forbidden — you can only view your own household's anomalies" },
          { status: 403 }
        );
      }
      householdId = hhSession.householdId;
    }

    const status = searchParams.get("status") || "ACTIVE";
    const severity = searchParams.get("severity");

    const where: Record<string, unknown> = {};
    if (householdId) where.householdId = householdId;
    if (status && status !== "ALL") where.status = status;
    if (severity) where.severity = severity;

    const anomalies = await db.anomaly.findMany({
      where,
      orderBy: [
        { severity: "desc" }, // CRITICAL first
        { createdAt: "desc" },
      ],
      include: {
        household: { select: { id: true, name: true } },
      },
      take: 50,
    });

    // Count active by severity
    const counts = await db.anomaly.groupBy({
      by: ["severity"],
      where: { status: "ACTIVE", ...(householdId ? { householdId } : {}) },
      _count: true,
    });

    const severityCounts = Object.fromEntries(
      counts.map((c) => [c.severity, c._count])
    );

    return NextResponse.json({ anomalies, severityCounts });
  } catch (error) {
    console.error("GET /api/anomalies error:", error);
    return NextResponse.json(
      { error: "Failed to fetch anomalies" },
      { status: 500 }
    );
  }
}
