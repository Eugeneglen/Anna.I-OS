// ============================================================
// Anna.I — Category Active-Check Utility
// ============================================================
// Reads PlatformConfig keys (category_price_X) and cross-references
// ACTIVE_CATEGORIES / INACTIVE_CATEGORIES from constants to determine
// whether a given ServiceCategory is available for consumer-side use.
// ============================================================

import { db } from "@/lib/db";
import { ACTIVE_CATEGORIES, INACTIVE_CATEGORIES } from "@/lib/constants";

/**
 * Returns the list of currently active categories.
 * Checks PlatformConfig for any dynamic overrides, falling back to constants.
 */
export async function getActiveCategories(): Promise<string[]> {
  try {
    // Check if there's a dynamic override in PlatformConfig
    const override = await db.platformConfig.findUnique({
      where: { key: "active_categories" },
    });

    if (override?.value) {
      try {
        const parsed = JSON.parse(override.value) as string[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {
        // Malformed JSON — fall through to constants
      }
    }

    return [...ACTIVE_CATEGORIES];
  } catch {
    // DB error — safest fallback is the hard-coded active list
    return [...ACTIVE_CATEGORIES];
  }
}

/**
 * Returns true if the given category is currently active/available
 * for consumer-side operations (task creation, dispatch, quotation).
 */
export async function isCategoryActive(category: string): Promise<boolean> {
  const active = await getActiveCategories();
  return active.includes(category);
}
