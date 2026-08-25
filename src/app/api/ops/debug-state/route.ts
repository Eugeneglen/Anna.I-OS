import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";

export async function GET() {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if super_admin
    if (session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [permissions, roles, seedVersion] = await Promise.all([
      db.permission.findMany({ orderBy: [{ module: "asc" }, { action: "asc" }] }),
      db.role.findMany({
        include: { rolePermissions: { include: { permission: true } } },
      }),
      db.platformConfig.findUnique({ where: { key: "seed_version" } }),
    ]);

    const marketingPerms = permissions.filter(p => p.module === "marketing");
    const superAdmin = roles.find(r => r.slug === "super_admin");
    const superAdminMarketing = superAdmin?.rolePermissions.filter(rp => rp.permission.module === "marketing") || [];

    return NextResponse.json({
      totalPermissions: permissions.length,
      marketingPermissions: marketingPerms.map(p => `${p.module}:${p.action}`),
      storedSeedVersion: seedVersion?.value || null,
      superAdminPermCount: superAdmin?.rolePermissions.length || 0,
      superAdminMarketingPerms: superAdminMarketing.map(rp => `${rp.permission.module}:${rp.permission.action}`),
    });
  } catch (error) {
    console.error("[/api/ops/debug-state]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
