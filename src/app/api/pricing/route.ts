import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CATEGORIES, ACTIVE_CATEGORIES, PLATFORM_COMMISSION_RATE } from "@/lib/constants";
import { CATEGORY_DEFAULTS } from "@/lib/types";
import { getActiveCategories } from "@/lib/get-active-categories";

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

    // Resolve active categories (dynamic overrides > constants)
    const activeCategories = await getActiveCategories();
    const activeSet = new Set(activeCategories);

    // Also merge any custom categories from PlatformConfig
    const customCatsRaw = configMap["custom_categories"];
    let customCats: string[] = [];
    if (customCatsRaw) {
      try { customCats = JSON.parse(customCatsRaw); } catch { /* ignore */ }
    }
    const allCats = [...new Set([...CATEGORIES, ...customCats])];

    const categories = allCats.map((cat) => {
      const isActive = activeSet.has(cat);
      const dbPrice = configMap[`category_price_${cat}`];
      const defaults = CATEGORY_DEFAULTS[cat as keyof typeof CATEGORY_DEFAULTS];
      const priceCents = dbPrice
        ? parseInt(dbPrice)
        : (defaults?.amount || 0);
      return {
        category: cat,
        label: defaults?.label || cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        priceCents,
        icon: defaults?.icon || "Sparkles",
        isActive,
      };
    });

    // Blended average across active categories only
    const activePricing = categories.filter((c) => c.isActive);
    const blendedCents = activePricing.length > 0
      ? Math.round(activePricing.reduce((sum, c) => sum + c.priceCents, 0) / activePricing.length)
      : 0;

    return NextResponse.json({
      categories,
      activeCategories,
      commissionRate,
      blendedJobValueCents: blendedCents,
    });
  } catch (error) {
    console.error("[/api/pricing GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
