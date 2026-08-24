import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession, hasMinRole } from "@/lib/ops-auth";
import { logAction } from "@/lib/audit-log";
import * as bcrypt from "bcryptjs";

type VendorUpdateData = {
  name?: string;
  email?: string;
  phone?: string;
  contactPerson?: string | null;
  contactEmail1?: string | null;
  contactPhone1?: string | null;
  contactPerson2?: string | null;
  contactEmail2?: string | null;
  contactPhone2?: string | null;
  companyName?: string | null;
  companyRegNo?: string | null;
  registeredAddress?: string | null;
  vendorType?: string;
  categories?: string[];
  staffCount?: number;
  dailyCapacity?: number;
  zones?: string[];
  status?: string;
  availability?: unknown;
  staff?: { action: "add" | "remove" | "toggle"; data: Record<string, unknown> };
  password?: string; // set/reset vendor portal login password
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const vendor = await db.vendor.findUnique({
      where: { id },
      include: {
        staff: { orderBy: { createdAt: "asc" } },
        addresses: {
          where: { ownerType: "VENDOR", vendorId: id },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        },
      },
    });

    if (!vendor) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ vendor });
  } catch (error) {
    console.error("[/api/ops/vendors/[id] GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body: VendorUpdateData = await req.json();

    const existing = await db.vendor.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Status changes require ADMIN
    if (body.status && !hasMinRole(session.role, "ADMIN")) {
      return NextResponse.json({ error: "Admin required for status changes" }, { status: 403 });
    }

    // Non-admin can only edit certain fields
    if (!hasMinRole(session.role, "COORDINATOR")) {
      return NextResponse.json({ error: "Coordinator or above required" }, { status: 403 });
    }

    const updateData: Record<string, unknown> = {};

    if (body.name !== undefined) updateData.name = body.name;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.phone !== undefined) updateData.phone = body.phone;
    if (body.contactPerson !== undefined) updateData.contactPerson = body.contactPerson;
    if (body.contactEmail1 !== undefined) updateData.contactEmail1 = body.contactEmail1;
    if (body.contactPhone1 !== undefined) updateData.contactPhone1 = body.contactPhone1;
    if (body.contactPerson2 !== undefined) updateData.contactPerson2 = body.contactPerson2;
    if (body.contactEmail2 !== undefined) updateData.contactEmail2 = body.contactEmail2;
    if (body.contactPhone2 !== undefined) updateData.contactPhone2 = body.contactPhone2;
    if (body.companyName !== undefined) updateData.companyName = body.companyName;
    if (body.companyRegNo !== undefined) updateData.companyRegNo = body.companyRegNo;
    if (body.registeredAddress !== undefined) updateData.registeredAddress = body.registeredAddress;
    if (body.vendorType !== undefined) updateData.vendorType = body.vendorType;
    if (body.categories !== undefined) updateData.categories = JSON.stringify(body.categories);
    if (body.staffCount !== undefined) updateData.staffCount = body.staffCount;
    if (body.dailyCapacity !== undefined) updateData.dailyCapacity = body.dailyCapacity;
    if (body.zones !== undefined) updateData.zones = JSON.stringify(body.zones);
    if (body.status !== undefined) updateData.status = body.status;
    if (body.availability !== undefined) updateData.availability = body.availability;

    // Set/reset vendor portal login password. Setting a password on a
    // vendor that had none provisions them for login. Setting a new one
    // overwrites the existing hash (password reset by ops).
    if (body.password !== undefined) {
      if (typeof body.password !== "string" || body.password.length < 8) {
        return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
      }
      updateData.passwordHash = bcrypt.hashSync(body.password, 10);
    }

    const vendor = await db.vendor.update({
      where: { id },
      data: updateData,
    });

    // Handle staff operations
    if (body.staff) {
      const { action, data } = body.staff;

      if (action === "add") {
        await db.vendorStaff.create({
          data: {
            vendorId: id,
            name: data.name as string,
            contact: data.contact as string,
            role: (data.role as string) || "staff",
          },
        });
      } else if (action === "remove") {
        await db.vendorStaff.deleteMany({
          where: { id: data.id as string, vendorId: id },
        });
      } else if (action === "toggle") {
        await db.vendorStaff.update({
          where: { id: data.id as string },
          data: { isActive: data.isActive as boolean },
        });
      }

      await logAction({
        userId: session.userId,
        userName: session.name,
        action: `vendor.staff.${action}`,
        entityType: "VendorStaff",
        entityId: id,
        metadata: { action, data },
      });
    }

    await logAction({
      userId: session.userId,
      userName: session.name,
      action: "vendor.update",
      entityType: "Vendor",
      entityId: id,
      metadata: { changes: updateData },
    });

    // Re-fetch with staff and addresses
    const updated = await db.vendor.findUnique({
      where: { id },
      include: {
        staff: { orderBy: { createdAt: "asc" } },
        addresses: {
          where: { ownerType: "VENDOR", vendorId: id },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        },
      },
    });

    return NextResponse.json({ vendor: updated });
  } catch (error: unknown) {
    console.error("[/api/ops/vendors/[id] PATCH]", error);
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}