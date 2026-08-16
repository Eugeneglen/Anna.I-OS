import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getVendorSession } from "@/lib/vendor-auth";
import { logAction } from "@/lib/audit-log";

// ── GET: List vendor's staff ──
export async function GET() {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const staff = await db.vendorStaff.findMany({
      where: { vendorId: session.vendorId },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ staff });
  } catch (error) {
    console.error("GET /api/vendor/staff error:", error);
    return NextResponse.json(
      { error: "Failed to fetch staff" },
      { status: 500 }
    );
  }
}

// ── POST: Add a new staff member ──
const addStaffSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  contact: z.string().min(1, "Contact is required").max(200),
  role: z.string().optional().default("staff"),
});

export async function POST(request: Request) {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = addStaffSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const newStaff = await db.vendorStaff.create({
      data: {
        vendorId: session.vendorId,
        name: parsed.data.name,
        contact: parsed.data.contact,
        role: parsed.data.role,
      },
    });

    await logAction({
      userId: session.vendorId,
      userName: session.name,
      action: "vendor.staff.add",
      entityType: "VendorStaff",
      entityId: newStaff.id,
      metadata: { name: parsed.data.name, contact: parsed.data.contact },
    });

    return NextResponse.json({ staff: newStaff }, { status: 201 });
  } catch (error) {
    console.error("POST /api/vendor/staff error:", error);
    return NextResponse.json(
      { error: "Failed to add staff" },
      { status: 500 }
    );
  }
}

// ── PATCH: Toggle staff active status ──
const patchStaffSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean(),
});

export async function PATCH(request: Request) {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = patchStaffSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    // Ensure the staff member belongs to this vendor
    const existing = await db.vendorStaff.findFirst({
      where: { id: parsed.data.id, vendorId: session.vendorId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 });
    }

    const updated = await db.vendorStaff.update({
      where: { id: parsed.data.id },
      data: { isActive: parsed.data.isActive },
    });

    await logAction({
      userId: session.vendorId,
      userName: session.name,
      action: "vendor.staff.toggle",
      entityType: "VendorStaff",
      entityId: updated.id,
      metadata: { name: existing.name, isActive: parsed.data.isActive },
    });

    return NextResponse.json({ staff: updated });
  } catch (error) {
    console.error("PATCH /api/vendor/staff error:", error);
    return NextResponse.json(
      { error: "Failed to update staff" },
      { status: 500 }
    );
  }
}

// ── DELETE: Remove a staff member ──
const deleteStaffSchema = z.object({
  id: z.string().min(1),
});

export async function DELETE(request: Request) {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = deleteStaffSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    // Ensure the staff member belongs to this vendor
    const existing = await db.vendorStaff.findFirst({
      where: { id: parsed.data.id, vendorId: session.vendorId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 });
    }

    await db.vendorStaff.deleteMany({
      where: { id: parsed.data.id, vendorId: session.vendorId },
    });

    await logAction({
      userId: session.vendorId,
      userName: session.name,
      action: "vendor.staff.remove",
      entityType: "VendorStaff",
      entityId: parsed.data.id,
      metadata: { name: existing.name },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/vendor/staff error:", error);
    return NextResponse.json(
      { error: "Failed to remove staff" },
      { status: 500 }
    );
  }
}
