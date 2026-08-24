import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession, hasMinRole } from "@/lib/ops-auth";
import { logAction } from "@/lib/audit-log";
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

    return NextResponse.json({ vendors });
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
      },
    });

    await logAction({
      userId: auth.session.userId,
      userName: auth.session.name,
      action: "vendor.create",
      entityType: "Vendor",
      entityId: vendor.id,
      metadata: { companyName, contactPerson, vendorType },
    });

    return NextResponse.json({ vendor }, { status: 201 });
  } catch (error: unknown) {
    console.error("[/api/ops/vendors POST]", error);
    if (error && typeof error === "object" && "code" in error && (error as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}