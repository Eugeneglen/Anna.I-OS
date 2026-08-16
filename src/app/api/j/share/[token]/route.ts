import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const booking = await db.booking.findUnique({
      where: { shareToken: token },
      include: {
        task: {
          include: {
            household: { select: { address: true } },
          },
        },
        vendor: {
          select: {
            name: true,
            companyName: true,
            avatarUrl: true,
          },
        },
        assignedStaff: {
          select: {
            name: true,
            role: true,
          },
        },
      },
    });

    if (!booking) {
      return NextResponse.json(
        { error: "Link not found or expired" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      booking: {
        id: booking.id,
        status: booking.status,
        scheduledStart: booking.scheduledStart,
        scheduledEnd: booking.scheduledEnd,
        category: booking.task.category,
        instructions: booking.task.instructions,
        taskStatus: booking.task.status,
        address: booking.task.household?.address || null,
        vendorName: booking.vendor.companyName || booking.vendor.name,
        vendorLogo: booking.vendor.avatarUrl || null,
        staffName: booking.assignedStaff?.name || null,
        staffRole: booking.assignedStaff?.role || null,
      },
    });
  } catch (error) {
    console.error("GET /api/j/share/[token] error:", error);
    return NextResponse.json(
      { error: "Failed to load job details" },
      { status: 500 }
    );
  }
}
