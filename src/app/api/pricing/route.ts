import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { CATEGORIES } from "@/lib/constants";
import { getCommissionRate } from "@/lib/commission";
import { CATEGORY_DEFAULTS } from "@/lib/types";
import { getActiveCategories } from "@/lib/get-active-categories";

// ── GET /api/pricing ──
// Public API: returns current category prices (for task creation UI).
// No auth required — these are public pricing values.
//
// ── Pricing authority consolidation (FIX-1c) ──
// ServiceJobType is the ONLY selling-price source (Ops edits job-type prices
// in the CMS; charges are computed by calculateQuote()). The former
// category_price_* PlatformConfig reads were display-only and diverged from
// the real charge path (audit: category_price_CARE 2000 vs job-type 6800) —
// this route now derives its per-category price from the ACTIVE job types
// (average base price), so the household booking prefill matches what the
// quote will actually charge. commission_rate comes from the same cached
// reader the escrow math uses (Ops margin lever).
export async function GET() {
  try {
    // ── Commission rate: single source of truth ──
    // PlatformConfig "commission_rate" (60s-cached) with the compiled
    // constant as fallback — same reader as the escrow creation path.
    const commissionRate = await getCommissionRate();

    // Resolve active categories (dynamic overrides > constants)
    const activeCategories = await getActiveCategories();
    const activeSet = new Set(activeCategories);

    // ── Derived selling prices per category (read-only, from ServiceJobType) ──
    const jobTypes = await db.serviceJobType.findMany({
      where: { isActive: true },
      select: { category: true, basePriceCents: true },
    });
    const pricesByCategory = new Map<string, number[]>();
    for (const jt of jobTypes) {
      const list = pricesByCategory.get(jt.category) ?? [];
      if (jt.basePriceCents > 0) list.push(jt.basePriceCents);
      pricesByCategory.set(jt.category, list);
    }

    // Also merge any custom categories from PlatformConfig
    const customCatsRaw = (
      await db.platformConfig.findUnique({ where: { key: "custom_categories" } })
    )?.value;
    let customCats: string[] = [];
    if (customCatsRaw) {
      try { customCats = JSON.parse(customCatsRaw); } catch { /* ignore */ }
    }
    const allCats = [...new Set([...CATEGORIES, ...customCats])];

    const categories = allCats.map((cat) => {
      const isActive = activeSet.has(cat);
      const defaults = CATEGORY_DEFAULTS[cat as keyof typeof CATEGORY_DEFAULTS];
      const jobTypePrices = pricesByCategory.get(cat) ?? [];
      const priceCents = jobTypePrices.length > 0
        ? Math.round(jobTypePrices.reduce((sum, p) => sum + p, 0) / jobTypePrices.length)
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
