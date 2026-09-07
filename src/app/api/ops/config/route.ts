import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession, hasMinRole } from "@/lib/ops-auth";
import { logAction } from "@/lib/audit-log";
import { getCommissionRate, invalidateCommissionRateCache } from "@/lib/commission";
import { CATEGORIES, ACTIVE_CATEGORIES, MAX_AUTONOMY_LEVEL } from "@/lib/constants";
import { CATEGORY_DEFAULTS, ServiceJobType as ServiceJobTypeT } from "@/lib/types";

// ── README keys & labels for the Autonomy tab ──
const README_KEYS = ["readme_autonomy_levels", "readme_threshold_guide", "readme_api_automation"] as const;

const README_LABELS: Record<string, string> = {
  readme_autonomy_levels: "Guide: Autonomy Levels Overview",
  readme_threshold_guide: "Guide: Threshold Configuration",
  readme_api_automation: "Guide: API & Automation",
};

function toLabel(name: string) {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function toSlug(input: string) {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

async function getConfigArray(key: string): Promise<string[]> {
  const row = await db.platformConfig.findUnique({ where: { key } });
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function setConfigArray(key: string, arr: string[], label: string) {
  await db.platformConfig.upsert({
    where: { key },
    create: { key, value: JSON.stringify(arr), label },
    update: { value: JSON.stringify(arr) },
  });
}

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

    const configMap: Record<string, string> = {};
    for (const c of platformConfigs) {
      configMap[c.key] = c.value;
    }

    let activeCats: string[] = [...ACTIVE_CATEGORIES];
    const activeCatsConfig = configMap["active_categories"];
    if (activeCatsConfig) {
      try {
        const parsed = JSON.parse(activeCatsConfig);
        if (Array.isArray(parsed)) activeCats = parsed;
      } catch { /* ignore malformed */ }
    }

    let customCats: string[] = [];
    const customCatsConfig = configMap["custom_categories"];
    if (customCatsConfig) {
      try {
        const parsed = JSON.parse(customCatsConfig);
        if (Array.isArray(parsed)) customCats = parsed;
      } catch { /* ignore malformed */ }
    }
    const allCats = [...new Set([...CATEGORIES, ...customCats])];

    const categories = allCats.map((cat) => ({
      name: cat,
      label: toLabel(cat),
      isActive: activeCats.includes(cat),
    }));

    // ── Commission rate: single source of truth (FIX-1c) ──
    // Reported through the same cached reader the charge path uses
    // (getCommissionRate — PlatformConfig "commission_rate", 60s cache,
    // PLATFORM_COMMISSION_RATE fallback), so the Ops UI can never show a
    // value the escrow math doesn't apply.
    const effectiveCommission = await getCommissionRate();

    // ── Pricing authority consolidation (FIX-1c) ──
    // ServiceJobType is the ONLY selling-price source (Ops edits prices in
    // the Job Types tab). The former category_price_* PlatformConfig surface
    // was display-only and diverged from the real charge path (audit:
    // category_price_CARE 2000 vs job-type 6800) — retired from this GET and
    // its write action removed below. This view is READ-ONLY, derived from
    // the active job types per category.
    const categoryPricing = allCats.map((cat) => {
      const categoryJobTypes = jobTypes.filter((j) => j.category === cat);
      const activeJobTypes = categoryJobTypes.filter((j) => j.isActive);
      const priced = (activeJobTypes.length > 0 ? activeJobTypes : categoryJobTypes)
        .map((j) => j.basePriceCents)
        .filter((p) => p > 0);
      return {
        category: cat,
        label: toLabel(cat),
        isActive: activeCats.includes(cat),
        activeJobTypes: activeJobTypes.length,
        totalJobTypes: categoryJobTypes.length,
        minPriceCents: priced.length > 0 ? Math.min(...priced) : 0,
        maxPriceCents: priced.length > 0 ? Math.max(...priced) : 0,
        avgPriceCents:
          priced.length > 0
            ? Math.round(priced.reduce((sum, p) => sum + p, 0) / priced.length)
            : CATEGORY_DEFAULTS[cat as keyof typeof CATEGORY_DEFAULTS]?.amount || 0,
      };
    });

    // Blended job value: average of the per-category average prices across
    // ACTIVE categories that have priced job types (derived view).
    const activePricing = categoryPricing.filter(
      (c) => c.isActive && (c.activeJobTypes > 0 || c.avgPriceCents > 0)
    );
    const blendedJobValueCents = activePricing.length > 0
      ? Math.round(activePricing.reduce((sum, c) => sum + c.avgPriceCents, 0) / activePricing.length)
      : 0;

    // ── Fetch READMEs ──
    const readmeRows = await db.platformConfig.findMany({
      where: { key: { in: [...README_KEYS] } },
    });
    const readmes: Record<string, string> = {};
    for (const row of readmeRows) {
      readmes[row.key] = row.value;
    }

    return NextResponse.json({
      categories,
      jobTypes,
      thresholds,
      commissionRate: effectiveCommission,
      maxLevel: MAX_AUTONOMY_LEVEL,
      categoryPricing,
      blendedJobValueCents,
      readmes,
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
      // ── RETIRED (FIX-1c pricing authority consolidation) ──
      // The category_price_* PlatformConfig surface was display-only and
      // diverged from the real charge path (ServiceJobType prices via
      // calculateQuote). Selling prices are edited per job type in the Job
      // Types tab; commission_rate (save_commission) is the Ops margin lever.
      return NextResponse.json(
        {
          error:
            "Category base prices are derived from Service Job Types — edit prices in the Job Types tab. This action has been retired.",
        },
        { status: 400 }
      );
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
      // FIX-1c: invalidate the in-process commission cache so the next
      // escrow creation (booking accept / add-on approval) reads the fresh
      // value immediately — the write is no longer display-only.
      invalidateCommissionRateCache();
      await logAction({
        userId: session.userId,
        userName: session.name,
        action: "config.save_commission",
        entityType: "PlatformConfig",
        metadata: { commissionRate },
      });
    } else if (action === "create_job_type") {
      const { name, category, slug, description, basePriceCents, unitLabel, pricingRules, requiredFields, addOns, sortOrder } = body as {
        name: string; category: string; slug: string; description: string;
        basePriceCents: number; unitLabel: string;
        pricingRules: ServiceJobTypeT["pricingRules"];
        requiredFields: ServiceJobTypeT["requiredFields"];
        addOns: ServiceJobTypeT["addOns"];
        sortOrder?: number;
      };
      const existing = await db.serviceJobType.findUnique({ where: { slug } });
      if (existing) {
        return NextResponse.json({ error: `Slug "${slug}" already exists` }, { status: 409 });
      }
      const jobType = await db.serviceJobType.create({
        data: {
          name, category, slug, description, basePriceCents, unitLabel,
          pricingRules: pricingRules as any,
          requiredFields: requiredFields as any,
          addOns: addOns as any,
          sortOrder: sortOrder ?? 0,
        },
      });
      await logAction({
        userId: session.userId, userName: session.name,
        action: "config.create_job_type", entityType: "ServiceJobType", entityId: jobType.id,
        metadata: { name, category, slug },
      });
      return NextResponse.json({ success: true, jobType });

    } else if (action === "update_job_type") {
      const { id, name, slug, description, basePriceCents, unitLabel, pricingRules, requiredFields, addOns, sortOrder, isActive } = body as {
        id: string; name?: string; slug?: string; description?: string;
        basePriceCents?: number; unitLabel?: string;
        pricingRules?: ServiceJobTypeT["pricingRules"];
        requiredFields?: ServiceJobTypeT["requiredFields"];
        addOns?: ServiceJobTypeT["addOns"];
        sortOrder?: number; isActive?: boolean;
      };
      if (slug) {
        const existing = await db.serviceJobType.findFirst({ where: { slug, NOT: { id } } });
        if (existing) {
          return NextResponse.json({ error: `Slug "${slug}" already exists` }, { status: 409 });
        }
      }
      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (slug !== undefined) updateData.slug = slug;
      if (description !== undefined) updateData.description = description;
      if (basePriceCents !== undefined) updateData.basePriceCents = basePriceCents;
      if (unitLabel !== undefined) updateData.unitLabel = unitLabel;
      if (pricingRules !== undefined) updateData.pricingRules = pricingRules as any;
      if (requiredFields !== undefined) updateData.requiredFields = requiredFields as any;
      if (addOns !== undefined) updateData.addOns = addOns as any;
      if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
      if (isActive !== undefined) updateData.isActive = isActive;

      await db.serviceJobType.update({ where: { id }, data: updateData });
      await logAction({
        userId: session.userId, userName: session.name,
        action: "config.update_job_type", entityType: "ServiceJobType", entityId: id,
        metadata: updateData,
      });

    } else if (action === "delete_job_type") {
      const { id } = body as { id: string };
      const [quotations, tasks] = await Promise.all([
        db.quotation.count({ where: { jobTypeId: id } }),
        db.task.count({ where: { jobTypeId: id } }),
      ]);
      if (quotations > 0 || tasks > 0) {
        return NextResponse.json(
          { error: `Cannot delete: ${quotations} quotation(s) and ${tasks} task(s) reference this job type. Deactivate instead.` },
          { status: 409 }
        );
      }
      await db.serviceJobType.delete({ where: { id } });
      await logAction({
        userId: session.userId, userName: session.name,
        action: "config.delete_job_type", entityType: "ServiceJobType", entityId: id,
      });

    } else if (action === "toggle_category") {
      const categoryName = (body as { name?: string; category?: string }).name ?? (body as { category?: string }).category;
      const { isActive } = body as { isActive: boolean };
      if (!categoryName) {
        return NextResponse.json({ error: "Category name is required" }, { status: 400 });
      }
      let activeCats = await getConfigArray("active_categories");
      if (activeCats.length === 0) activeCats = [...ACTIVE_CATEGORIES];
      // Filter out any falsy entries
      activeCats = activeCats.filter(Boolean);
      if (isActive && !activeCats.includes(categoryName)) {
        activeCats.push(categoryName);
      } else if (!isActive) {
        activeCats = activeCats.filter((c) => c !== categoryName);
      }
      await setConfigArray("active_categories", activeCats, "Active service categories (JSON array)");
      await logAction({
        userId: session.userId, userName: session.name,
        action: "config.toggle_category", entityType: "PlatformConfig",
        metadata: { name: categoryName, isActive, activeCategories: activeCats },
      });

    } else if (action === "create_category") {
      const { name, isActive } = body as { name: string; isActive: boolean };
      if (!name || !name.trim()) {
        return NextResponse.json({ error: "Category name is required" }, { status: 400 });
      }
      const slug = toSlug(name);
      if (!slug) {
        return NextResponse.json({ error: "Invalid category name" }, { status: 400 });
      }
      const customCats = await getConfigArray("custom_categories");
      if (([...CATEGORIES] as string[]).concat(customCats).includes(slug)) {
        return NextResponse.json({ error: `Category "${slug}" already exists` }, { status: 409 });
      }
      customCats.push(slug);
      await setConfigArray("custom_categories", customCats, "Custom (user-created) service categories");
      if (isActive) {
        let activeCats = await getConfigArray("active_categories");
        if (activeCats.length === 0) activeCats = [...ACTIVE_CATEGORIES];
        if (!activeCats.includes(slug)) {
          activeCats.push(slug);
          await setConfigArray("active_categories", activeCats, "Active service categories (JSON array)");
        }
      }
      await logAction({
        userId: session.userId, userName: session.name,
        action: "config.create_category", entityType: "PlatformConfig",
        metadata: { name: slug, label: toLabel(slug), isActive },
      });
      return NextResponse.json({ success: true, category: { name: slug, label: toLabel(slug), isActive } });

    } else if (action === "save_readme") {
      const { key, content } = body as { key: string; content: string };
      if (!README_KEYS.includes(key as any)) {
        return NextResponse.json({ error: "Invalid readme key" }, { status: 400 });
      }
      const label = README_LABELS[key] || `Guide: ${key}`;
      await db.platformConfig.upsert({
        where: { key },
        create: { key, value: content, label },
        update: { value: content },
      });
      await logAction({
        userId: session.userId,
        userName: session.name,
        action: "config.save_readme",
        entityType: "PlatformConfig",
        entityId: key,
        metadata: { key, contentLength: content.length },
      });
      return NextResponse.json({ success: true });

    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/ops/config POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
