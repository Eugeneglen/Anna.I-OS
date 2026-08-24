import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireVendorPermission } from "@/lib/vendor-guard";
import { db } from "@/lib/db";
import * as bcrypt from "bcryptjs";

// ═════════════════════════════════════════════════════
// PATCH /api/vendor/users/[id] — Update HQ staff user (VendorUser)
// ═════════════════════════════════════════════════════
const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  contact: z.string().min(1).optional(),
  jobTitle: z.string().optional(),
  roleId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(), // optional password reset
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireVendorPermission("v_users", "edit");
    if (!auth.success) return auth.response;

    const { id } = await params;

    // Verify user belongs to this vendor
    const existing = await db.vendorUser.findFirst({
      where: { id, vendorId: auth.vendorId },
    });
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { name, contact, jobTitle, roleId, isActive, password } = parsed.data;

    // ── Self-escalation guard ──
    // A vendor user cannot change their OWN roleId (would let a manager
    // promote themselves to super_admin). Only another user may reassign.
    if (roleId !== undefined && auth.session.isStaff && auth.session.userId === id) {
      return NextResponse.json(
        { error: "You cannot change your own role. Ask another administrator." },
        { status: 403 }
      );
    }

    // Validate role if provided
    if (roleId) {
      const role = await db.role.findUnique({ where: { id: roleId } });
      if (!role || !role.slug.startsWith("vendor_")) {
        return NextResponse.json({ error: "Invalid vendor role" }, { status: 400 });
      }
    }

    const data: Record<string, unknown> = { name, contact, jobTitle, roleId, isActive };
    if (password) {
      data.passwordHash = bcrypt.hashSync(password, 10);
    }

    const updated = await db.vendorUser.update({
      where: { id },
      data,
      include: { roleRel: { select: { id: true, name: true, slug: true, level: true } } },
    });

    // Audit log
    await db.auditLog.create({
      data: {
        userName: auth.session.name,
        vendorId: auth.vendorId,
        action: "vendor.user.update",
        entityType: "VendorUser",
        entityId: id,
        metadata: { name, contact, jobTitle, roleId, isActive, passwordReset: !!password },
      },
    }).catch((err: unknown) => {
      console.warn("[vendor audit] failed to write audit log:", err);
    });

    return NextResponse.json({
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        contact: updated.contact,
        jobTitle: updated.jobTitle,
        role: updated.role,
        roleId: updated.roleId,
        hasPassword: !!updated.passwordHash,
        isActive: updated.isActive,
        createdAt: updated.createdAt,
        roleRel: updated.roleRel,
      },
    });
  } catch (error) {
    console.error("[/api/vendor/users/[id] PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ═════════════════════════════════════════════════════
// DELETE /api/vendor/users/[id] — Remove HQ staff user (VendorUser)
// ═════════════════════════════════════════════════════
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireVendorPermission("v_users", "delete");
    if (!auth.success) return auth.response;

    const { id } = await params;

    // Self-deletion guard — a user cannot delete their own account
    if (auth.session.isStaff && auth.session.userId === id) {
      return NextResponse.json(
        { error: "You cannot delete your own account." },
        { status: 403 }
      );
    }

    // Verify user belongs to this vendor
    const existing = await db.vendorUser.findFirst({
      where: { id, vendorId: auth.vendorId },
    });
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await db.vendorUser.delete({ where: { id } });

    // Audit log
    await db.auditLog.create({
      data: {
        userName: auth.session.name,
        vendorId: auth.vendorId,
        action: "vendor.user.delete",
        entityType: "VendorUser",
        entityId: id,
        metadata: { name: existing.name, email: existing.email },
      },
    }).catch((err: unknown) => {
      console.warn("[vendor audit] failed to write audit log:", err);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/vendor/users/[id] DELETE]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
