import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getVendorSession } from "@/lib/vendor-auth";
import { db } from "@/lib/db";

// ═════════════════════════════════════════════════════
// PATCH /api/vendor/users/[id] — Update staff member
// ═════════════════════════════════════════════════════
const updateStaffSchema = z.object({
  name: z.string().min(1).optional(),
  contact: z.string().min(1).optional(),
  roleId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify staff belongs to this vendor
    const existing = await db.vendorStaff.findFirst({
      where: { id, vendorId: session.vendorId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = updateStaffSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { name, contact, roleId, isActive } = parsed.data;

    // Validate role if provided
    if (roleId) {
      const role = await db.role.findUnique({ where: { id: roleId } });
      if (!role || !role.slug.startsWith("vendor_")) {
        return NextResponse.json({ error: "Invalid vendor role" }, { status: 400 });
      }
    }

    const updated = await db.vendorStaff.update({
      where: { id },
      data: { name, contact, roleId, isActive },
      include: { roleRel: { select: { id: true, name: true, slug: true, level: true } } },
    });

    return NextResponse.json({ user: updated });
  } catch (error) {
    console.error("[/api/vendor/users/[id] PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ═════════════════════════════════════════════════════
// DELETE /api/vendor/users/[id] — Remove staff member
// ═════════════════════════════════════════════════════
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify staff belongs to this vendor
    const existing = await db.vendorStaff.findFirst({
      where: { id, vendorId: session.vendorId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 });
    }

    await db.vendorStaff.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/vendor/users/[id] DELETE]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
