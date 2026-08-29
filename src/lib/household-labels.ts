/**
 * Shared label maps for household onboarding data.
 * Used by:
 *   - src/components/ops/households/household-intelligence-panel.tsx (display)
 *   - src/app/api/ops/households/[id]/export/route.ts (CSV/JSON export)
 *   - src/app/api/ops/households/export-all/route.ts (bulk CSV export)
 *   - src/app/api/ops/households/intelligence/route.ts (aggregation)
 *
 * These mirror the household app's src/components/anna/household-profile-section.tsx
 * so ops staff see the exact same labels the household user sees.
 */

export const HOME_TYPE_LABELS: Record<string, string> = {
  HDB: "HDB Flat",
  CONDO: "Condominium",
  LANDED: "Landed Property",
  TERRACE: "Terrace House",
  OTHER: "Other",
};

export const HDB_SIZE_LABELS: Record<string, string> = {
  "2ROOM": "2-Room",
  "3ROOM": "3-Room",
  "4ROOM": "4-Room",
  "5ROOM": "5-Room",
  EXEC: "Executive",
};

export const OCCUPANT_LABELS: Record<string, string> = {
  "1": "1 (Solo)",
  "2": "2 (Couple)",
  "3-4": "3–4 (Small family)",
  "5+": "5+ (Large family)",
};

export const MEMBER_LABELS: Record<string, string> = {
  ADULTS: "Working Adults",
  CHILDREN: "Young Children",
  TEENS: "Teenagers",
  ELDERLY: "Elderly",
  PETS: "Pets",
};

export const PET_LABELS: Record<string, string> = {
  DOGS: "Dogs",
  CATS: "Cats",
  SMALL: "Small Animals",
  OTHERS: "Others",
};

export const SCHEDULE_LABELS: Record<string, string> = {
  HOME: "Everyone's usually home",
  MIXED: "Mixed schedule",
  OUT: "Usually out during the day",
};

export const PAIN_POINT_LABELS: Record<string, string> = {
  CLEANING: "Cleaning & tidying",
  AIRCON: "Air-con servicing",
  REPAIRS: "Repairs & maintenance",
  LAUNDRY: "Laundry",
  PLANNING: "Planning & scheduling",
  FINDING: "Finding reliable providers",
};

export const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Fortnightly",
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  AD_HOC: "Ad hoc",
  AS_NEEDED: "As needed",
};

export const DAY_LABELS: Record<string, string> = {
  ANY: "Any day",
  WEEKDAY: "Weekdays",
  WEEKEND: "Weekends",
};

export const TIME_LABELS: Record<string, string> = {
  MORNING: "Morning",
  AFTERNOON: "Afternoon",
  EVENING: "Evening",
  FLEXIBLE: "Flexible",
};

export const AUTONOMY_LABELS: Record<string, string> = {
  "1": "Remind me",
  "2": "Suggest",
  "3": "Prepare",
  "4": "Automate",
};

export const ACQUISITION_LABELS: Record<string, string> = {
  PILOT_COHORT: "Pilot Cohort",
  PUBLIC_CODE: "Public Code",
  PARTNERSHIP_REFERRAL: "Partnership Referral",
  ORGANIC: "Organic",
  OTHER: "Other",
};

/**
 * Helper: safely extract a value from the onboarding profile by path.
 * Returns null if any step is missing.
 */
export function getProfileValue(
  profile: Record<string, unknown> | null | undefined,
  ...path: string[]
): unknown {
  if (!profile) return null;
  let current: unknown = profile;
  for (const key of path) {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return null;
    }
    if (current === undefined || current === null) return null;
  }
  return current;
}

/**
 * Helper: resolve a code to its label (or return the code if unknown).
 */
export function resolveLabel(
  labels: Record<string, string>,
  code: string | null | undefined
): string {
  if (!code) return "";
  return labels[code] || code;
}
