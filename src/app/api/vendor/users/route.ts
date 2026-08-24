import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireVendorPermission } from "@/lib/vendor-guard";
import { db } from "@/lib/db";
import * as bcrypt from "bcryptjs";

// ═════════════════════════════════════════════════════
// GET /api/vendor/users — List HQ staff (VendorUser) for this vendor
// These are back-office users (finance, auditors, analysts, ops managers)
// who can log in to the vendor portal. They are NOT field roster members.
// ═════════════════════════════════════════════════════
export async function GET() {
  try {
    const auth = await requireVendorPermission("v_users", "view");
    if (!auth.success) return auth.response;

    const users = await db.vendorUser.findMany({
      where: { vendorId: auth.vendorId },
      orderBy: { createdAt: "desc" },
      include: {
        roleRel: { select: { id: true, name: true, slug: true, level: true } },
      },
    });

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        contact: u.contact,
        jobTitle: u.jobTitle,
        role: u.role,
        roleId: u.roleId,
        hasPassword: !!u.passwordHash,
        isActive: u.isActive,
        createdAt: u.createdAt,
        roleRel: u.roleRel,
      })),
    });
  } catch (error) {
    console.error("[/api/vendor/users GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ═════════════════════════════════════════════════════
// POST /api/vendor/users — Create a new HQ staff user (VendorUser)
// Email + password are REQUIRED (HQ users always have portal login).
// ═════════════════════════════════════════════════════
const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  contact: z.string().min(1, "Contact is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  jobTitle: z.string().optional(),
  roleId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const auth = await requireVendorPermission("v_users", "create");
    if (!auth.success) return auth.response;

    const body = await req.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { name, contact, email, password, jobTitle, roleId } = parsed.data;

    // Email must be globally unique among VendorUsers (@@unique)
    const existingUser = await db.vendorUser.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 409 }
      );
    }

    // Email must NOT collide with a Vendor owner's email — otherwise the auth
    // route (which checks Vendor first) would shadow the HQ user and they
    // could never log in.
    const existingVendor = await db.vendor.findUnique({ where: { email } });
    if (existingVendor) {
      return NextResponse.json(
        { error: "This email is already used by a vendor account. Choose a different email." },
        { status: 409 }
      );
    }

    // Validate role if provided
    if (roleId) {
      const role = await db.role.findUnique({ where: { id: roleId } });
      if (!role || !role.slug.startsWith("vendor_")) {
        return NextResponse.json({ error: "Invalid vendor role" }, { status: 400 });
      }
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    const newUser = await db.vendorUser.create({
      data: {
        vendorId: auth.vendorId,
        name,
        email,
        contact,
        jobTitle,
        passwordHash,
        roleId,
      },
      include: {
        roleRel: { select: { id: true, name: true, slug: true, level: true } },
      },
    });

    // Vendor-initiated audit log (FK-safe: userId nullable, vendorId set)
    await db.auditLog.create({
      data: {
        userName: auth.session.name,
        vendorId: auth.vendorId,
        action: "vendor.user.create",
        entityType: "VendorUser",
        entityId: newUser.id,
        metadata: { name, email, jobTitle, roleId },
      },
    }).catch((err: unknown) => {
      console.warn("[vendor audit] failed to write audit log:", err);
    });

    return NextResponse.json({
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        contact: newUser.contact,
        jobTitle: newUser.jobTitle,
        role: newUser.role,
        roleId: newUser.roleId,
        hasPassword: !!newUser.passwordHash,
        isActive: newUser.isActive,
        createdAt: newUser.createdAt,
        roleRel: newUser.roleRel,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("[/api/vendor/users POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
