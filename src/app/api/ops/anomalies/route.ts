import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { logAction } from "@/lib/audit-log";

export async function GET(request: Request) {
  try {
    // FIX-1a: previously fully unauthenticated. Ops session +
    // anomalies:view required (same convention as the other /api/ops/*
    // routes).
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await hasPermission(session, "anomalies", "view");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "";
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

    // Manually resolve vendor and task data (no Prisma relations on Anomaly)
    const vendorIds = [
      ...new Set(
        anomalies
          .map((a) => a.vendorId)
          .filter((v): v is string => !!v)
      ),
    ];
    const taskIds = [
      ...new Set(
        anomalies
          .map((a) => a.taskId)
          .filter((v): v is string => !!v)
      ),
    ];

    const [vendors, tasks] = await Promise.all([
      vendorIds.length > 0
        ? db.vendor.findMany({
            where: { id: { in: vendorIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      taskIds.length > 0
        ? db.task.findMany({
            where: { id: { in: taskIds } },
            select: { id: true, category: true, amountCents: true, status: true },
          })
        : Promise.resolve([]),
    ]);

    const vendorMap = Object.fromEntries(vendors.map((v) => [v.id, v]));
    const taskMap = Object.fromEntries(tasks.map((t) => [t.id, t]));

    const enriched = anomalies.map((a) => ({
      ...a,
      vendor: a.vendorId ? vendorMap[a.vendorId] || null : null,
      task: a.taskId ? taskMap[a.taskId] || null : null,
    }));

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
      anomalies: enriched,
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
    // FIX-1a: previously fully unauthenticated — anyone could resolve or
    // dismiss any anomaly. Ops session + anomalies:edit required, and the
    // mutation is now audit-logged.
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await hasPermission(session, "anomalies", "edit");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = patchSchema.parse(body);

    const updateData: Record<string, unknown> = { status: parsed.status };
    if (parsed.status === "ACKNOWLEDGED") updateData.acknowledgedAt = new Date();
    if (parsed.status === "RESOLVED") updateData.resolvedAt = new Date();

    const result = await db.anomaly.updateMany({
      where: { id: { in: parsed.ids } },
      data: updateData,
    });

    // FIX-1a audit coverage: anomaly resolve/dismiss/acknowledge was
    // previously invisible in the audit trail.
    await logAction({
      userId: session.userId,
      userName: session.name,
      action: "anomaly.update",
      entityType: "Anomaly",
      entityId: parsed.ids[0],
      metadata: { ids: parsed.ids, status: parsed.status, updated: result.count },
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
