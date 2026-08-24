import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireVendorPermission } from "@/lib/vendor-guard";

// Vendor-initiated audit log. Writes with vendorId set (userId null) so
// vendor-scope actions are auditable without an OpsUser FK dependency.
async function vendorAuditLog(params: {
  userName: string;
  vendorId: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await db.auditLog.create({
      data: {
        userName: params.userName,
        vendorId: params.vendorId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        metadata: params.metadata ?? undefined,
      },
    });
  } catch (err) {
    console.warn("[vendor audit] failed to write audit log:", err);
  }
}

// ── GET: List vendor's field roster (Staff Roster) ──
// Returns VendorStaff rows (front-end operations team — NOT login users).
export async function GET() {
  try {
    const auth = await requireVendorPermission("v_staff", "view");
    if (!auth.success) return auth.response;

    const staff = await db.vendorStaff.findMany({
      where: { vendorId: auth.vendorId },
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

// ── POST: Add a new field roster member (Staff Roster) ──
// Roster members do NOT have login credentials. They are field workers
// (cleaners, technicians) assignable to bookings.
const addStaffSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  contact: z.string().min(1, "Contact is required").max(200),
  jobTitle: z.string().max(100).optional(),
  role: z.string().optional().default("staff"),
});

export async function POST(request: Request) {
  try {
    const auth = await requireVendorPermission("v_staff", "create");
    if (!auth.success) return auth.response;

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
        vendorId: auth.vendorId,
        name: parsed.data.name,
        contact: parsed.data.contact,
        jobTitle: parsed.data.jobTitle,
        role: parsed.data.role,
      },
    });

    await vendorAuditLog({
      userName: auth.session.name,
      vendorId: auth.vendorId,
      action: "vendor.staff.add",
      entityType: "VendorStaff",
      entityId: newStaff.id,
      metadata: { name: parsed.data.name, contact: parsed.data.contact, jobTitle: parsed.data.jobTitle },
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

// ── PATCH: Toggle roster member active status ──
const patchStaffSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean(),
});

export async function PATCH(request: Request) {
  try {
    const auth = await requireVendorPermission("v_staff", "edit");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const parsed = patchStaffSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    // Ensure the roster member belongs to this vendor
    const existing = await db.vendorStaff.findFirst({
      where: { id: parsed.data.id, vendorId: auth.vendorId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 });
    }

    const updated = await db.vendorStaff.update({
      where: { id: parsed.data.id },
      data: { isActive: parsed.data.isActive },
    });

    await vendorAuditLog({
      userName: auth.session.name,
      vendorId: auth.vendorId,
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

// ── DELETE: Remove a roster member ──
const deleteStaffSchema = z.object({
  id: z.string().min(1),
});

export async function DELETE(request: Request) {
  try {
    const auth = await requireVendorPermission("v_staff", "delete");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const parsed = deleteStaffSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    // Ensure the roster member belongs to this vendor
    const existing = await db.vendorStaff.findFirst({
      where: { id: parsed.data.id, vendorId: auth.vendorId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 });
    }

    await db.vendorStaff.deleteMany({
      where: { id: parsed.data.id, vendorId: auth.vendorId },
    });

    await vendorAuditLog({
      userName: auth.session.name,
      vendorId: auth.vendorId,
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

