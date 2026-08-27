import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getVendorSession } from "@/lib/vendor-auth";
import { vendorJson } from "@/lib/vendor-guard";

export async function GET(request: NextRequest) {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get("year");
    const monthParam = searchParams.get("month");
    const staffIdParam = searchParams.get("staffId");

    // Validate year & month
    const year = parseInt(yearParam ?? "", 10);
    const month = parseInt(monthParam ?? "", 10);

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return NextResponse.json(
        { error: "Invalid year or month. month must be 1-12." },
        { status: 400 },
      );
    }

    // Month boundaries (UTC)
    const monthStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const vendorId = session.vendorId;

    // Build booking where clause
    const bookingWhere: Record<string, unknown> = {
      vendorId,
      scheduledStart: { gte: monthStart, lte: monthEnd },
    };

    if (staffIdParam) {
      // Validate staff belongs to this vendor
      const staffMember = await db.vendorStaff.findUnique({
        where: { id: staffIdParam },
        select: { vendorId: true, isActive: true },
      });

      if (!staffMember || staffMember.vendorId !== vendorId) {
        return NextResponse.json(
          { error: "Staff member not found." },
          { status: 404 },
        );
      }

      bookingWhere.assignedStaffId = staffIdParam;
    } else {
      bookingWhere.status = { not: "cancelled" };
    }

    // Parallel fetch: bookings + staff list
    const [bookings, staffList] = await Promise.all([
      db.booking.findMany({
        where: bookingWhere,
        include: {
          task: {
            select: {
              id: true,
              category: true,
              status: true,
              amountCents: true,
              discountCents: true,
              finalAmountCents: true,
              instructions: true,
              jobNo: true,
              household: {
                select: {
                  name: true,
                  address: true,
                  unitNumber: true,
                  postalCode: true,
                },
              },
            },
          },
          assignedStaff: {
            select: {
              id: true,
              name: true,
              contact: true,
              role: true,
            },
          },
          addons: {
            select: {
              id: true,
              description: true,
              amountCents: true,
              discountCents: true,
              finalAmountCents: true,
              status: true,
            },
          },
        },
        orderBy: { scheduledStart: "asc" },
      }),

      db.vendorStaff.findMany({
        where: { vendorId, isActive: true },
        select: {
          id: true,
          name: true,
          contact: true,
          role: true,
          isActive: true,
          _count: {
            select: {
              bookings: {
                where: {
                  scheduledStart: { gte: monthStart, lte: monthEnd },
                  status: { not: "cancelled" },
                },
              },
            },
          },
        },
        orderBy: { name: "asc" },
      }),
    ]);

    // Compute summary stats
    const completedBookings = bookings.filter((b) => b.status === "completed").length;
    const cancelledBookings = bookings.filter((b) => b.status === "cancelled").length;
    const activeBookings = bookings.filter((b) =>
      ["assigned", "accepted", "in_progress"].includes(b.status),
    ).length;

    // Total revenue = task.amountCents + approved addon amounts
    const totalRevenueCents = bookings.reduce((sum, b) => {
      let revenue = b.task.amountCents;
      if (b.addons && b.addons.length > 0) {
        revenue += b.addons
          .filter((a) => a.status === "approved")
          .reduce((addonSum, a) => addonSum + a.amountCents, 0);
      }
      return sum + revenue;
    }, 0);

    // Unique staff count
    const uniqueStaffIds = new Set(
      bookings.map((b) => b.assignedStaffId).filter(Boolean) as string[],
    );

    // Format bookings response
    const formattedBookings = bookings.map((b) => ({
      id: b.id,
      scheduledStart: b.scheduledStart.toISOString(),
      scheduledEnd: b.scheduledEnd?.toISOString() ?? null,
      status: b.status,
      completionNotes: b.completionNotes ?? null,
      rating: b.rating ?? null,
      task: {
        id: b.task.id,
        category: b.task.category,
        status: b.task.status,
        amountCents: b.task.amountCents,
        instructions: b.task.instructions,
        household: b.task.household,
      },
      assignedStaff: b.assignedStaff
        ? {
            id: b.assignedStaff.id,
            name: b.assignedStaff.name,
            contact: b.assignedStaff.contact,
            role: b.assignedStaff.role,
          }
        : null,
      addons: b.addons.map((a) => ({
        id: a.id,
        description: a.description,
        amountCents: a.amountCents,
        status: a.status,
      })),
    }));

    const formattedStaff = staffList.map((s) => ({
      id: s.id,
      name: s.name,
      contact: s.contact,
      role: s.role,
      isActive: s.isActive,
      jobCount: s._count.bookings,
    }));

    return vendorJson({
      bookings: formattedBookings,
      staff: formattedStaff,
      summary: {
        totalBookings: bookings.length,
        completedBookings,
        cancelledBookings,
        activeBookings,
        totalRevenueCents,
        uniqueStaffCount: uniqueStaffIds.size,
      },
    }, vendorId);
  } catch (error) {
    console.error("[/api/vendor/calendar GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
