import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const householdId = searchParams.get("householdId");
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