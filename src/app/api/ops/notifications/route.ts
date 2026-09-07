import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";

export async function GET(request: Request) {
  try {
    // FIX-1a: previously fully unauthenticated (full notification feed
    // with household/member PII). Ops session + notifications:view
    // required, same convention as the other /api/ops/* routes.
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await hasPermission(session, "notifications", "view");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "";
    const channel = searchParams.get("channel") || "";
    const eventType = searchParams.get("eventType") || "";
    const search = searchParams.get("search") || "";
    const cursor = searchParams.get("cursor") || "";
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

    const where: Record<string, unknown> = {};

    if (status) where.status = status;
    if (channel) where.channel = channel;
    if (eventType) where.eventType = eventType;
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { body: { contains: search } },
        { household: { name: { contains: search } } },
      ];
    }

    if (cursor) {
      where.createdAt = { lt: new Date(cursor) };
    }

    const [notifications, statusCounts, channelCounts] = await Promise.all([
      db.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          household: { select: { id: true, name: true } },
          member: { select: { id: true, name: true } },
          vendor: { select: { id: true, name: true } },
        },
      }),
      db.notification.groupBy({
        by: ["status"],
        _count: true,
      }),
      db.notification.groupBy({
        by: ["channel"],
        _count: true,
      }),
    ]);

    const nextCursor =
      notifications.length === limit
        ? notifications[notifications.length - 1].createdAt.toISOString()
        : null;

    return NextResponse.json({
      notifications,
      nextCursor,
      statusCounts,
      channelCounts,
    });
  } catch (error) {
    console.error("GET /api/ops/notifications error:", error);
    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 }
    );
  }
}