import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getVendorSession } from "@/lib/vendor-auth";
import { db } from "@/lib/db";

// ═════════════════════════════════════════════════════
// GET /api/vendor/users — List vendor staff (scoped to this vendor)
// ═════════════════════════════════════════════════════
export async function GET() {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const staff = await db.vendorStaff.findMany({
      where: { vendorId: session.vendorId },
      orderBy: { createdAt: "desc" },
      include: {
        roleRel: { select: { id: true, name: true, slug: true, level: true } },
      },
    });

    // Count staff per role for userCount
    const roleCounts: Record<string, number> = {};
    for (const s of staff) {
      if (s.roleId) roleCounts[s.roleId] = (roleCounts[s.roleId] || 0) + 1;
    }

    return NextResponse.json({
      users: staff.map((s) => ({
        id: s.id,
        name: s.name,
        contact: s.contact,
        role: s.role,
        roleId: s.roleId,
        isActive: s.isActive,
        createdAt: s.createdAt,
        roleRel: s.roleRel,
      })),
    });
  } catch (error) {
    console.error("[/api/vendor/users GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ═════════════════════════════════════════════════════
// POST /api/vendor/users — Add new staff member
// ═════════════════════════════════════════════════════
const createStaffSchema = z.object({
  name: z.string().min(1, "Name is required"),
  contact: z.string().min(1, "Contact is required"),
  roleId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = createStaffSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { name, contact, roleId } = parsed.data;

    // Validate role belongs to vendor scope if provided
    if (roleId) {
      const role = await db.role.findUnique({ where: { id: roleId } });
      if (!role || !role.slug.startsWith("vendor_")) {
        return NextResponse.json({ error: "Invalid vendor role" }, { status: 400 });
      }
    }

    const staff = await db.vendorStaff.create({
      data: {
        vendorId: session.vendorId,
        name,
        contact,
        roleId: roleId || null,
      },
      include: { roleRel: { select: { id: true, name: true, slug: true, level: true } } },
    });

    return NextResponse.json({ user: staff }, { status: 201 });
  } catch (error) {
    console.error("[/api/vendor/users POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
