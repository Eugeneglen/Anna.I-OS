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

    // ── HQ staff (VendorUser): resolve identity + RBAC from VendorUser ──
    if (session.isStaff && session.userId) {
      const user = await db.vendorUser.findUnique({
        where: { id: session.userId },
        select: {
          id: true,
          name: true,
          email: true,
          contact: true,
          jobTitle: true,
          role: true,
          isActive: true,
          roleId: true,
          vendorId: true,
          vendor: { select: { id: true, name: true, vendorType: true, status: true } },
          roleRel: {
            select: {
              id: true,
              name: true,
              slug: true,
              level: true,
              rolePermissions: {
                select: { permission: { select: { module: true, action: true } } },
              },
            },
          },
        },
      });

      if (!user || !user.isActive) {
        return NextResponse.json({ error: "User not found or inactive" }, { status: 404 });
      }

      const permissions = user.roleRel?.rolePermissions.map(
        (rp) => `${rp.permission.module}:${rp.permission.action}`
      ) || [];

      return vendorJson({
        vendor: {
          id: user.vendorId,
          // For HQ staff, surface the user's own name (the layout's UserSection
          // displays vendor.name). The parent vendor name is still queryable
          // via the Vendor relation if needed.
          name: user.name,
          email: user.email,
          vendorType: user.vendor.vendorType,
          status: user.vendor.status,
        },
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          jobTitle: user.jobTitle,
          isStaff: true,
        },
        role: user.roleRel
          ? { id: user.roleRel.id, name: user.roleRel.name, slug: user.roleRel.slug, level: user.roleRel.level }
          : null,
        permissions,
      }, user.vendorId);
    }

    // ── Vendor owner (Vendor table) ──
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
      user: {
        id: vendor.id,
        name: vendor.name,
        email: vendor.email,
        isStaff: false,
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
