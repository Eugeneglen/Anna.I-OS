import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession, hasMinRole } from "@/lib/ops-auth";
import { logAction } from "@/lib/audit-log";
import { stripVendorSecrets } from "@/lib/sanitize";
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
  roleId?: string | null; // assign/clear the vendor PORTAL role (vendor_* roles only)
};

/**
 * Resolves a candidate portal role for a vendor. Only roles with slugs
 * under the vendor_ namespace are assignable here — an ops user must never
 * be able to pin an OPS role (super_admin etc.) onto a vendor.
 */
async function resolveVendorPortalRole(roleId: string | null | undefined) {
  if (roleId === undefined) return { ok: true as const, role: undefined };
  if (roleId === null || roleId === "") return { ok: true as const, role: null };
  const role = await db.role.findUnique({
    where: { id: roleId },
    select: { id: true, name: true, slug: true, level: true },
  });
  if (!role || !role.slug.startsWith("vendor_")) {
    return { ok: false as const };
  }
  return { ok: true as const, role };
}

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
        roleRel: { select: { id: true, name: true, slug: true, level: true } },
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

    // ── P3 companion (AUDIT-FIX-9): Ops needs a way to provision vendor
    // portal roles now that request-path self-heal is disabled in
    // production. Expose the assignable vendor_* role catalog alongside
    // the vendor record so the detail page can render a role picker
    // without requiring roles:view (which coordinators lack). ──
    const vendorRoles = await db.role.findMany({
      where: { slug: { startsWith: "vendor_" } },
      orderBy: { level: "desc" },
      select: { id: true, name: true, slug: true, level: true, description: true },
    });

    // FIX-1a: strip passwordHash + verificationData before serialising.
    return NextResponse.json({ vendor: stripVendorSecrets(vendor), vendorRoles });
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

    // Portal role assignment is a privilege grant — ADMIN only.
    const roleChange = body.roleId !== undefined ? await resolveVendorPortalRole(body.roleId) : null;
    if (roleChange && !roleChange.ok) {
      return NextResponse.json(
        { error: "Invalid role — only vendor portal roles (vendor_*) can be assigned" },
        { status: 400 }
      );
    }
    if (body.roleId !== undefined && !hasMinRole(session.role, "ADMIN")) {
      return NextResponse.json({ error: "Admin required for portal role changes" }, { status: 403 });
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

    // Assign/clear the vendor portal role (validated + admin-gated above).
    // Vendor permissions are resolved from the DB on every request
    // (vendor-guard resolvePermissions), so the change takes effect on
    // the vendor's very next API call — no cache to invalidate.
    if (roleChange && roleChange.ok && roleChange.role !== undefined) {
      updateData.roleId = roleChange.role ? roleChange.role.id : null;
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
      // FIX-1a: never persist the (new) passwordHash into the audit trail —
      // log a boolean marker instead.
      metadata: {
        changes: { ...updateData, ...(body.password !== undefined ? { passwordHash: "[redacted]" } : {}) },
      },
    });

    // Re-fetch with staff and addresses
    const updated = await db.vendor.findUnique({
      where: { id },
      include: {
        roleRel: { select: { id: true, name: true, slug: true, level: true } },
        staff: { orderBy: { createdAt: "asc" } },
        addresses: {
          where: { ownerType: "VENDOR", vendorId: id },
          orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        },
      },
    });

    // Dedicated audit entry for portal-role changes (old → new), so
    // privilege grants are greppable in isolation from profile edits.
    if (roleChange && roleChange.ok && roleChange.role !== undefined) {
      const oldRole = existing.roleId
        ? await db.role.findUnique({
            where: { id: existing.roleId },
            select: { name: true, slug: true },
          })
        : null;
      await logAction({
        userId: session.userId,
        userName: session.name,
        action: "vendor.role.assign",
        entityType: "Vendor",
        entityId: id,
        metadata: {
          from: oldRole ? { id: existing.roleId, name: oldRole.name, slug: oldRole.slug } : null,
          to: roleChange.role
            ? { id: roleChange.role.id, name: roleChange.role.name, slug: roleChange.role.slug }
            : null,
        },
      });
    }

    // FIX-1a: strip passwordHash + verificationData before serialising.
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ vendor: stripVendorSecrets(updated) });
  } catch (error: unknown) {
    console.error("[/api/ops/vendors/[id] PATCH]", error);
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}