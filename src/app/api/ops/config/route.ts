import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession, hasMinRole } from "@/lib/ops-auth";
import { logAction } from "@/lib/audit-log";
import { CATEGORIES, ACTIVE_CATEGORIES, PLATFORM_COMMISSION_RATE, MAX_AUTONOMY_LEVEL, CATEGORY_CYCLES_PER_LEVEL } from "@/lib/constants";
import { CATEGORY_DEFAULTS } from "@/lib/types";

export async function GET() {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [jobTypes, thresholds, platformConfigs] = await Promise.all([
      db.serviceJobType.findMany({
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
      }),
      db.autonomyLevelThreshold.findMany({
        orderBy: [{ category: "asc" }, { level: "asc" }],
      }),
      db.platformConfig.findMany(),
    ]);

    const categories = CATEGORIES.map((cat) => ({
      name: cat,
      label: cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      isActive: ACTIVE_CATEGORIES.includes(cat as typeof ACTIVE_CATEGORIES[number]),
    }));

    // Build config map
    const configMap: Record<string, string> = {};
    for (const c of platformConfigs) {
      configMap[c.key] = c.value;
    }

    // Dynamic commission rate (default to constant if not configured)
    const effectiveCommission = configMap["commission_rate"]
      ? parseInt(configMap["commission_rate"])
      : PLATFORM_COMMISSION_RATE;

    // Build per-category pricing (DB overrides > CATEGORY_DEFAULTS)
    const categoryPricing = CATEGORIES.map((cat) => {
      const dbPrice = configMap[`category_price_${cat}`];
      const priceCents = dbPrice ? parseInt(dbPrice) : (CATEGORY_DEFAULTS[cat as keyof typeof CATEGORY_DEFAULTS]?.amount || 0);
      return {
        category: cat,
        label: cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        defaultPriceCents: CATEGORY_DEFAULTS[cat as keyof typeof CATEGORY_DEFAULTS]?.amount || 0,
        activePriceCents: priceCents,
        isCustom: !!dbPrice,
        isActive: ACTIVE_CATEGORIES.includes(cat as typeof ACTIVE_CATEGORIES[number]),
      };
    });

    // Compute blended job value from active categories
    const activePricing = categoryPricing.filter((c) => c.isActive);
    const blendedJobValueCents = activePricing.length > 0
      ? Math.round(activePricing.reduce((sum, c) => sum + c.activePriceCents, 0) / activePricing.length)
      : 0;

    return NextResponse.json({
      categories,
      jobTypes,
      thresholds,
      commissionRate: effectiveCommission,
      maxLevel: MAX_AUTONOMY_LEVEL,
      categoryPricing,
      blendedJobValueCents,
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
    } else if (action === "save_pricing") {
      const { pricing } = body as { pricing: { category: string; priceCents: number }[] };
      for (const p of pricing) {
        const key = `category_price_${p.category}`;
        await db.platformConfig.upsert({
          where: { key },
          create: { key, value: String(p.priceCents), label: `Base price for ${p.category.replace(/_/g, " ")}` },
          update: { value: String(p.priceCents) },
        });
      }
      await logAction({
        userId: session.userId,
        userName: session.name,
        action: "config.save_pricing",
        entityType: "PlatformConfig",
        metadata: { count: pricing.length, items: pricing.map((p) => ({ category: p.category, priceCents: p.priceCents })) },
      });
    } else if (action === "save_commission") {
      const { commissionRate } = body as { commissionRate: number };
      if (commissionRate < 0 || commissionRate > 100) {
        return NextResponse.json({ error: "Commission must be 0-100" }, { status: 400 });
      }
      await db.platformConfig.upsert({
        where: { key: "commission_rate" },
        create: { key: "commission_rate", value: String(commissionRate), label: "Platform commission rate (%)" },
        update: { value: String(commissionRate) },
      });
      await logAction({
        userId: session.userId,
        userName: session.name,
        action: "config.save_commission",
        entityType: "PlatformConfig",
        metadata: { commissionRate },
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