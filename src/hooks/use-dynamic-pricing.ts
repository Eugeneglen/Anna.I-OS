import { useQuery } from "@tanstack/react-query";
import { CATEGORY_DEFAULTS, type ServiceCategory } from "@/lib/types";
import { PLATFORM_COMMISSION_RATE } from "@/lib/constants";

interface PricingCategory {
  category: ServiceCategory;
  label: string;
  priceCents: number;
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

  // Build a lookup: category → priceCents
  const priceMap: Record<string, number> = {};
  if (data?.categories) {
    for (const c of data.categories) {
      priceMap[c.category] = c.priceCents;
    }
  }

  // Build a set of active categories
  const activeCategorySet = new Set<string>(data?.activeCategories ?? []);

  // Helper: get price for a category (dynamic > default)
  function getPrice(category: ServiceCategory): number {
    return priceMap[category] ?? CATEGORY_DEFAULTS[category]?.amount ?? 0;
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
