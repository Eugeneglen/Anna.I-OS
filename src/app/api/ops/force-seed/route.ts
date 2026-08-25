import { NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { db } from "@/lib/db";

export async function POST() {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only super_admin can force-seed
    if (session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden — super_admin only" }, { status: 403 });
    }

    // Run the seed directly
    const seedModule = await import("../../../../prisma/seed");
    const seed = seedModule.default;
    if (typeof seed !== "function") {
      return NextResponse.json({ error: "Seed function not found" }, { status: 500 });
    }

    await seed();

    // Verify marketing permissions now exist
    const marketingPerms = await db.permission.findMany({ where: { module: "marketing" } });
    const superAdmin = await db.role.findUnique({
      where: { slug: "super_admin" },
      include: { rolePermissions: { include: { permission: true } } },
    });
    const superAdminMarketing = superAdmin?.rolePermissions.filter(rp => rp.permission.module === "marketing") || [];

    return NextResponse.json({
      success: true,
      message: "Seed completed",
      marketingPermissionsCreated: marketingPerms.length,
      superAdminMarketingPerms: superAdminMarketing.length,
    });
  } catch (error) {
    console.error("[/api/ops/force-seed]", error);
    const msg = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
