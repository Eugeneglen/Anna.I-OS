import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession, hasMinRole } from "@/lib/ops-auth";
import { logAction } from "@/lib/audit-log";
import { CATEGORIES, ACTIVE_CATEGORIES, PLATFORM_COMMISSION_RATE, MAX_AUTONOMY_LEVEL } from "@/lib/constants";

export async function GET() {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [jobTypes, thresholds] = await Promise.all([
      db.serviceJobType.findMany({
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
      }),
      db.autonomyLevelThreshold.findMany({
        orderBy: [{ category: "asc" }, { level: "asc" }],
      }),
    ]);

    const categories = CATEGORIES.map((cat) => ({
      name: cat,
      label: cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      isActive: ACTIVE_CATEGORIES.includes(cat as typeof ACTIVE_CATEGORIES[number]),
    }));

    return NextResponse.json({
      categories,
      jobTypes,
      thresholds,
      commissionRate: PLATFORM_COMMISSION_RATE,
      maxLevel: MAX_AUTONOMY_LEVEL,
    });
  } catch (error) {
    console.error("[/api/ops/config GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasMinRole(session.role, "ADMIN")) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const body = await req.json();
    const { action } = body;

    if (action === "toggle_job_type") {
      const { id, isActive } = body;
      await db.serviceJobType.update({
        where: { id },
        data: { isActive },
      });
      await logAction({
        userId: session.userId,
        userName: session.name,
        action: "config.toggle_job_type",
        entityType: "ServiceJobType",
        entityId: id,
        metadata: { isActive },
      });
    } else if (action === "save_thresholds") {
      const { thresholds } = body as { thresholds: { category: string; level: number; cyclesRequired: number }[] };
      for (const t of thresholds) {
        await db.autonomyLevelThreshold.upsert({
          where: { category_level: { category: t.category, level: t.level } },
          create: { category: t.category, level: t.level, cyclesRequired: t.cyclesRequired },
          update: { cyclesRequired: t.cyclesRequired },
        });
      }
      await logAction({
        userId: session.userId,
        userName: session.name,
        action: "config.save_thresholds",
        entityType: "AutonomyLevelThreshold",
        metadata: { count: thresholds.length },
      });
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/ops/config POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}