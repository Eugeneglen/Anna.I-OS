import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getVendorSession } from "@/lib/vendor-auth";

export async function GET() {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const vendor = await db.vendor.findUnique({
      where: { id: session.vendorId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        categories: true,
        vendorType: true,
        staffCount: true,
        dailyCapacity: true,
        maxTasksPerDay: true,
        maxTasksPerWeek: true,
        availability: true,
        zones: true,
        status: true,
        createdAt: true,
      },
    });

    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }

    return NextResponse.json({ vendor });
  } catch (error) {
    console.error("[/api/vendor/profile GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { phone, availability, zones } = body;

    // Only allow vendors to update their own contact/availability info
    const updateData: Record<string, unknown> = {};
    if (phone !== undefined) updateData.phone = phone;
    if (availability !== undefined) updateData.availability = availability;
    if (zones !== undefined) updateData.zones = zones;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const vendor = await db.vendor.update({
      where: { id: session.vendorId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        categories: true,
        vendorType: true,
        staffCount: true,
        dailyCapacity: true,
        maxTasksPerDay: true,
        maxTasksPerWeek: true,
        availability: true,
        zones: true,
        status: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ vendor });
  } catch (error) {
    console.error("[/api/vendor/profile PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
