import { useQuery } from "@tanstack/react-query";
import { type ServiceCategory } from "@/lib/types";
import { PLATFORM_COMMISSION_RATE } from "@/lib/constants";

interface PricingCategory {
  category: ServiceCategory;
  label: string;
  /** Derived from live active job types — null when the category has no
   *  catalogue services (never a hard-coded fallback). */
  priceCents: number | null;
  icon: string;
  isActive: boolean;
}

interface PricingData {
  categories: PricingCategory[];
  activeCategories: string[];
  commissionRate: number;
  blendedJobValueCents: number;
}

// Fetch live pricing from /api/pricing, fallback to CATEGORY_DEFAULTS
export function useDynamicPricing() {
  const { data, isLoading } = useQuery({
    queryKey: ["pricing"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/pricing");
        if (res.ok) return res.json() as PricingData;
      } catch {
        // Fallback silently
      }
      return null;
    },
    staleTime: 5 * 60 * 1000, // 5 min stale time — pricing doesn't change often
  });

  // Build a lookup: category → priceCents (null = no catalogue price)
  const priceMap: Record<string, number | null> = {};
  if (data?.categories) {
    for (const c of data.categories) {
      priceMap[c.category] = c.priceCents;
    }
  }

  // Build a set of active categories
  const activeCategorySet = new Set<string>(data?.activeCategories ?? []);

  // Helper: get the live catalogue-derived price for a category.
  // ── Service/Pricing/Availability Authority ──
  // NO CATEGORY_DEFAULTS fallback: 0 means "no catalogue price — the
  // amount must come from a catalogue quote or an explicit custom
  // request", never a hard-coded number.
  function getPrice(category: ServiceCategory): number {
    const live = priceMap[category];
    return typeof live === "number" ? live : 0;
  }

  // Helper: check if a category is active
  // When data hasn't loaded yet, assume all categories are active (optimistic default)
  function isCategoryActive(category: string): boolean {
    if (!data) return true; // Not loaded yet — don't falsely mark as unavailable
    return activeCategorySet.has(category);
  }

  // Commission rate (dynamic > default)
  const commissionRate: number = data?.commissionRate ?? PLATFORM_COMMISSION_RATE;

  return {
    pricing: data,
    isLoading,
    getPrice,
    isCategoryActive,
    activeCategorySet,
    commissionRate,
    blendedJobValueCents: data?.blendedJobValueCents ?? 0,
  };
}
