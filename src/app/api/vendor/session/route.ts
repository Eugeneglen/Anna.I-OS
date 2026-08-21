import { NextResponse } from "next/server";
import { getVendorSession } from "@/lib/vendor-auth";
import { db } from "@/lib/db";
import { vendorJson } from "@/lib/vendor-guard";

export async function GET() {
  try {
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch vendor with role and permissions
    const vendor = await db.vendor.findUnique({
      where: { id: session.vendorId },
      select: {
        id: true,
        name: true,
        email: true,
        vendorType: true,
        status: true,
        roleId: true,
        roleRel: {
          select: {
            id: true,
            name: true,
            slug: true,
            level: true,
            rolePermissions: {
              select: {
                permission: { select: { module: true, action: true } },
              },
            },
          },
        },
      },
    });

    if (!vendor) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }

    const permissions = vendor.roleRel?.rolePermissions.map(
      (rp) => `${rp.permission.module}:${rp.permission.action}`
    ) || [];

    return vendorJson({
      vendor: {
        id: vendor.id,
        name: vendor.name,
        email: vendor.email,
        vendorType: vendor.vendorType,
        status: vendor.status,
      },
      role: vendor.roleRel
        ? { id: vendor.roleRel.id, name: vendor.roleRel.name, slug: vendor.roleRel.slug, level: vendor.roleRel.level }
        : null,
      permissions,
    }, vendor.id);
  } catch (error) {
    console.error("[/api/vendor/session GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
