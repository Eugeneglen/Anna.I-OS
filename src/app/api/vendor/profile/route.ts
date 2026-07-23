import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getVendorSession } from "@/lib/vendor-auth";

// Fields vendors can self-edit (validated list, not arbitrary updates)
const ALLOWED_PATCH_FIELDS = [
  "phone",
  "email",
  "availability",    // JSON: { workingDays, workingHours, notes }
] as const;

// Fields that require ops approval — reject vendor attempts
const OPS_ONLY_FIELDS = [
  "name",
  "categories",
  "vendorType",
  "staffCount",
  "dailyCapacity",
  "maxTasksPerDay",
  "maxTasksPerWeek",
  "zones",
  "status",
  "verificationData",
] as const;

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
        updatedAt: true,
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

    // Reject ops-only fields
    for (const field of OPS_ONLY_FIELDS) {
      if (field in body) {
        return NextResponse.json(
          { error: `"${field}" requires ops approval. Contact support.` },
          { status: 403 }
        );
      }
    }

    // Build update data from allowed fields only
    const updateData: Record<string, unknown> = {};
    for (const field of ALLOWED_PATCH_FIELDS) {
      if (field in body) {
        updateData[field] = body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    // Validate email uniqueness if changing
    if ("email" in updateData && updateData.email !== session.email) {
      const existing = await db.vendor.findUnique({
        where: { email: updateData.email as string },
        select: { id: true },
      });
      if (existing && existing.id !== session.vendorId) {
        return NextResponse.json(
          { error: "Email already in use by another vendor" },
          { status: 409 }
        );
      }
    }

    // Validate phone format if changing (basic +65 or +60 prefix)
    if ("phone" in updateData && updateData.phone) {
      const phone = String(updateData.phone).replace(/\s/g, "");
      if (!/^\+65\d{8,11}$/.test(phone) && !/^\+60\d{9,12}$/.test(phone)) {
        return NextResponse.json(
          { error: "Phone must be a valid SG (+65) or MY (+60) number" },
          { status: 400 }
        );
      }
    }

    // Validate availability structure if changing
    if ("availability" in updateData && updateData.availability !== null) {
      const avail = updateData.availability;
      if (typeof avail === "object" && avail !== null) {
        const a = avail as Record<string, unknown>;
        if (a.workingDays && !Array.isArray(a.workingDays)) {
          return NextResponse.json(
            { error: "workingDays must be an array" },
            { status: 400 }
          );
        }
      }
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
        updatedAt: true,
      },
    });

    return NextResponse.json({ vendor });
  } catch (error) {
    console.error("[/api/vendor/profile PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
