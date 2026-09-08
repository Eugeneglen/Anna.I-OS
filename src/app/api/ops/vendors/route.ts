import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession, hasMinRole } from "@/lib/ops-auth";
import { logAction } from "@/lib/audit-log";
import { stripVendorSecrets } from "@/lib/sanitize";
import * as bcrypt from "bcryptjs";

async function requireAuth(req: NextRequest) {
  const session = await getOpsSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { session };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (auth.error) return auth.error;

    const search = req.nextUrl.searchParams.get("search") || "";

    const vendors = await db.vendor.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search } },
              { email: { contains: search } },
            ],
          }
        : undefined,
      include: { _count: { select: { staff: true } } },
      orderBy: { createdAt: "desc" },
    });

    // FIX-1a: strip bcrypt passwordHash + verificationData (NRIC /
    // background checks) from every row before serialising.
    return NextResponse.json({ vendors: vendors.map(stripVendorSecrets) });
  } catch (error) {
    console.error("[/api/ops/vendors GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (auth.error) return auth.error;
    if (!hasMinRole(auth.session.role, "ADMIN")) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const body = await req.json();
    const {
      companyName,
      contactPerson,
      contactEmail1,
      contactPhone1,
      contactPerson2,
      contactEmail2,
      contactPhone2,
      companyRegNo,
      registeredAddress,
      vendorType,
      categories,
      staffCount,
      dailyCapacity,
      zones,
      password,
      roleId,
    } = body;

    if (!companyName) {
      return NextResponse.json({ error: "Company name is required" }, { status: 400 });
    }

    // Auto-generate vendor login credentials from contact person 1 info
    const vendorName = companyName;
    const vendorEmail = contactEmail1 || `${companyName.toLowerCase().replace(/\s+/g, ".")}@vendor.local`;
    const vendorPhone = contactPhone1 || "";

    // Provision login password if provided (min 8 chars). If omitted, the
    // vendor is created without portal login — ops can set one later via
    // the vendor detail page. This is the legitimate provisioning path
    // (the auth route no longer self-heals a null passwordHash for security).
    let passwordHash: string | undefined;
    if (password) {
      if (typeof password !== "string" || password.length < 8) {
        return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
      }
      passwordHash = bcrypt.hashSync(password, 10);
    }

    // ── P3 companion (AUDIT-FIX-9): provision the vendor PORTAL role.
    // Production is deny-by-default (no request-path self-heal), so a
    // vendor created without a role would authenticate fine but hit 403
    // on every portal action. This explicit, ops-triggered assignment is
    // the replacement: default to Vendor Admin (full portal, no
    // user/role management escalation beyond it), or use the roleId the
    // operator chose. Only vendor_* roles are assignable. ──
    let assignedRoleId: string | null | undefined;
    if (roleId !== undefined && roleId !== null) {
      const chosen = await db.role.findUnique({
        where: { id: roleId as string },
        select: { id: true, slug: true },
      });
      if (!chosen || !chosen.slug.startsWith("vendor_")) {
        return NextResponse.json(
          { error: "Invalid role — only vendor portal roles (vendor_*) can be assigned" },
          { status: 400 }
        );
      }
      assignedRoleId = chosen.id;
    } else {
      const defaultRole = await db.role.findUnique({
        where: { slug: "vendor_admin" },
        select: { id: true },
      });
      if (defaultRole) {
        assignedRoleId = defaultRole.id;
      } else {
        // Role catalog missing (seed not run). Create the vendor anyway
        // but flag it — ops can assign a role from the detail page later.
        console.warn(
          "[ops/vendors POST] vendor_admin role not found — vendor created WITHOUT a portal role (run the RBAC seed or assign one from the vendor detail page)"
        );
      }
    }

    const vendor = await db.vendor.create({
      data: {
        name: vendorName,
        email: vendorEmail,
        phone: vendorPhone,
        contactPerson: contactPerson || null,
        contactEmail1: contactEmail1 || null,
        contactPhone1: contactPhone1 || null,
        contactPerson2: contactPerson2 || null,
        contactEmail2: contactEmail2 || null,
        contactPhone2: contactPhone2 || null,
        companyName: companyName || null,
        companyRegNo: companyRegNo || null,
        registeredAddress: registeredAddress || null,
        vendorType: vendorType || "MICRO",
        categories: JSON.stringify(categories || []),
        staffCount: staffCount || 1,
        dailyCapacity: dailyCapacity || 6,
        zones: JSON.stringify(zones || []),
        ...(passwordHash ? { passwordHash } : {}),
        ...(assignedRoleId !== undefined ? { roleId: assignedRoleId } : {}),
      },
    });

    await logAction({
      userId: auth.session.userId,
      userName: auth.session.name,
      action: "vendor.create",
      entityType: "Vendor",
      entityId: vendor.id,
      metadata: { companyName, contactPerson, vendorType, roleId: assignedRoleId ?? null },
    });

    // Re-fetch with the assigned role so the response shows what the new
    // vendor can actually do in the portal (mirrors the PATCH response).
    // FIX-1a: strip the freshly-written passwordHash before echoing.
    const vendorWithRole = await db.vendor.findUnique({
      where: { id: vendor.id },
      include: { roleRel: { select: { id: true, name: true, slug: true, level: true } } },
    });

    return NextResponse.json(
      {
        vendor: vendorWithRole
          ? stripVendorSecrets(vendorWithRole)
          : stripVendorSecrets(vendor),
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error("[/api/ops/vendors POST]", error);
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}