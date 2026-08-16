import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getVendorSession } from "@/lib/vendor-auth";

// Fields vendors can self-edit (validated list, not arbitrary updates)
const ALLOWED_PATCH_FIELDS = [
  "phone",
  "email",
  "contactPerson",
  "contactEmail1",
  "contactPhone1",
  "contactPerson2",
  "contactEmail2",
  "contactPhone2",
  "availability",    // JSON: { workingDays, workingHours, notes }
  "zones",            // JSON array of zone strings
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
        contactPerson: true,
        contactEmail1: true,
        contactPhone1: true,
        contactPerson2: true,
        contactEmail2: true,
        contactPhone2: true,
        companyName: true,
        companyRegNo: true,
        registeredAddress: true,
        categories: true,
        vendorType: true,
        staffCount: true,
        dailyCapacity: true,
        maxTasksPerDay: true,
        maxTasksPerWeek: true,
        availability: true,
        zones: true,
        avatarUrl: true,
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

    // Validate phone format if changing — strict Singapore mobile validation
    if ("phone" in updateData && updateData.phone) {
      const { validateSgPhone } = await import("@/lib/phone-validation");
      const result = validateSgPhone(String(updateData.phone));
      if (!result.valid) {
        return NextResponse.json(
          { error: result.error || "Invalid Singapore phone number" },
          { status: 400 }
        );
      }
      // Normalize to +65XXXXXXXX format
      updateData.phone = result.normalized;
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

    // Validate zones structure if changing — must be array of strings
    if ("zones" in updateData && updateData.zones !== null) {
      if (!Array.isArray(updateData.zones)) {
        return NextResponse.json(
          { error: "zones must be an array of strings" },
          { status: 400 }
        );
      }
      const cleaned = (updateData.zones as unknown[]).map((z) => String(z).trim()).filter(Boolean);
      updateData.zones = JSON.stringify(cleaned);
    }

    const vendor = await db.vendor.update({
      where: { id: session.vendorId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        contactPerson: true,
        contactEmail1: true,
        contactPhone1: true,
        contactPerson2: true,
        contactEmail2: true,
        contactPhone2: true,
        companyName: true,
        companyRegNo: true,
        registeredAddress: true,
        categories: true,
        vendorType: true,
        staffCount: true,
        dailyCapacity: true,
        maxTasksPerDay: true,
        maxTasksPerWeek: true,
        availability: true,
        zones: true,
        avatarUrl: true,
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
