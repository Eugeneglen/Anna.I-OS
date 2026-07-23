import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sp = req.nextUrl.searchParams;
    const search = sp.get("search") || "";
    const status = sp.get("status") || "";
    const category = sp.get("category") || "";
    const from = sp.get("from") || "";
    const to = sp.get("to") || "";
    const cursor = sp.get("cursor") || "";
    const limit = Math.min(parseInt(sp.get("limit") || "20"), 50);

    const where: Prisma.BookingWhereInput = {};

    if (search) {
      where.OR = [
        { task: { household: { name: { contains: search } } } },
        { vendor: { name: { contains: search } } },
        { vendor: { email: { contains: search } } },
        { assignedStaff: { name: { contains: search } } },
      ];
    }

    if (status) {
      where.status = status;
    }

    if (category) {
      where.task = { ...((where.task as Prisma.TaskWhereInput) || {}), category };
    }

    if (from || to) {
      const dateFilter: Prisma.BookingWhereInput = {};
      if (from && !to) {
        dateFilter.scheduledStart = { gte: new Date(from) };
      } else if (to && !from) {
        dateFilter.scheduledStart = { lte: new Date(to) };
      } else if (from && to) {
        dateFilter.scheduledStart = { gte: new Date(from), lte: new Date(to) };
      }
      const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
      where.AND = [...existingAnd, dateFilter];
    }

    const bookings = await db.booking.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        scheduledStart: true,
        scheduledEnd: true,
        actualStart: true,
        actualEnd: true,
        rating: true,
        ratingComment: true,
        createdAt: true,
        task: {
          select: {
            id: true,
            category: true,
            status: true,
            amountCents: true,
            household: {
              select: { id: true, name: true, address: true, postalCode: true },
            },
          },
        },
        vendor: {
          select: { id: true, name: true, vendorType: true },
        },
        assignedStaff: {
          select: { id: true, name: true, role: true },
        },
        escrowEntries: {
          select: { id: true, state: true, amountCents: true },
          take: 1,
        },
      },
    });

    const hasMore = bookings.length > limit;
    if (hasMore) bookings.pop();

    const nextCursor = hasMore && bookings.length > 0 ? bookings[bookings.length - 1].id : null;

    const statusCounts = await db.booking.groupBy({
      by: ["status"],
      _count: { status: true },
    });

    return NextResponse.json({
      bookings,
      nextCursor,
      statusCounts: statusCounts.map((s) => ({
        status: s.status,
        count: s._count.status,
      })),
    });
  } catch (error) {
    console.error("[/api/ops/bookings GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}