import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "ACTIVE";
    const severity = searchParams.get("severity") || "";
    const type = searchParams.get("type") || "";
    const search = searchParams.get("search") || "";
    const cursor = searchParams.get("cursor") || "";
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

    const where: Record<string, unknown> = {};
    if (status && status !== "ALL") where.status = status;
    if (severity) where.severity = severity;
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { message: { contains: search } },
        { household: { name: { contains: search } } },
        { vendor: { name: { contains: search } } },
      ];
    }
    if (cursor) {
      where.createdAt = { lt: new Date(cursor) };
    }

    const [anomalies, severityCounts, typeCounts, statusCounts] =
      await Promise.all([
        db.anomaly.findMany({
          where,
          orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
          take: limit,
          include: {
            household: { select: { id: true, name: true, postalCode: true } },
            vendor: { select: { id: true, name: true } },
            task: {
              select: {
                id: true,
                category: true,
                amountCents: true,
                status: true,
              },
            },
          },
        }),
        db.anomaly.groupBy({
          by: ["severity"],
          where: { status: "ACTIVE" },
          _count: true,
        }),
        db.anomaly.groupBy({
          by: ["type"],
          _count: true,
        }),
        db.anomaly.groupBy({
          by: ["status"],
          _count: true,
        }),
      ]);

    const nextCursor =
      anomalies.length === limit
        ? anomalies[anomalies.length - 1].createdAt.toISOString()
        : null;

    const severityMap = Object.fromEntries(
      severityCounts.map((c) => [c.severity, c._count])
    );
    const typeMap = Object.fromEntries(
      typeCounts.map((c) => [c.type, c._count])
    );
    const statusMap = Object.fromEntries(
      statusCounts.map((c) => [c.status, c._count])
    );

    return NextResponse.json({
      anomalies,
      nextCursor,
      severityCounts: severityMap,
      typeCounts: typeMap,
      statusCounts: statusMap,
    });
  } catch (error) {
    console.error("GET /api/ops/anomalies error:", error);
    return NextResponse.json(
      { error: "Failed to fetch anomalies" },
      { status: 500 }
    );
  }
}

const patchSchema = z.object({
  ids: z.array(z.string()).min(1),
  status: z.enum(["ACKNOWLEDGED", "RESOLVED", "DISMISSED"]),
});

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const parsed = patchSchema.parse(body);

    const updateData: Record<string, unknown> = { status: parsed.status };
    if (parsed.status === "ACKNOWLEDGED") updateData.acknowledgedAt = new Date();
    if (parsed.status === "RESOLVED") updateData.resolvedAt = new Date();

    const result = await db.anomaly.updateMany({
      where: { id: { in: parsed.ids } },
      data: updateData,
    });

    return NextResponse.json({ updated: result.count });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    console.error("PATCH /api/ops/anomalies error:", error);
    return NextResponse.json(
      { error: "Failed to update anomalies" },
      { status: 500 }
    );
  }
}