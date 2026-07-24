import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CATEGORIES, ACTIVE_CATEGORIES, PLATFORM_COMMISSION_RATE } from "@/lib/constants";
import { CATEGORY_DEFAULTS } from "@/lib/types";

// ── GET /api/pricing ──
// Public API: returns current category prices (for task creation UI)
// No auth required — these are public pricing values
export async function GET() {
  try {
    const platformConfigs = await db.platformConfig.findMany();
    const configMap: Record<string, string> = {};
    for (const c of platformConfigs) {
      configMap[c.key] = c.value;
    }

    const commissionRate = configMap["commission_rate"]
      ? parseInt(configMap["commission_rate"])
      : PLATFORM_COMMISSION_RATE;

    const categories = ACTIVE_CATEGORIES.map((cat) => {
      const dbPrice = configMap[`category_price_${cat}`];
      const priceCents = dbPrice
        ? parseInt(dbPrice)
        : (CATEGORY_DEFAULTS[cat as keyof typeof CATEGORY_DEFAULTS]?.amount || 0);
      return {
        category: cat,
        label: CATEGORY_DEFAULTS[cat as keyof typeof CATEGORY_DEFAULTS]?.label || cat,
        priceCents,
        icon: CATEGORY_DEFAULTS[cat as keyof typeof CATEGORY_DEFAULTS]?.icon || "Sparkles",
      };
    });

    // Blended average across active categories
    const blendedCents = categories.length > 0
      ? Math.round(categories.reduce((sum, c) => sum + c.priceCents, 0) / categories.length)
      : 0;

    return NextResponse.json({
      categories,
      commissionRate,
      blendedJobValueCents: blendedCents,
    });
  } catch (error) {
    console.error("[/api/pricing GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
