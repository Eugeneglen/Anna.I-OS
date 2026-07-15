// ============================================================
// Anna.I — Business Constants
// ============================================================

/** Platform commission rate (%) */
export const PLATFORM_COMMISSION_RATE = 10

/** Blended default job value in SGD cents (SGD $68) */
export const BLENDED_JOB_VALUE_CENTS = 6800

/** Default amountCents per category */
export const CATEGORY_DEFAULTS: Record<string, number> = {
  CLEANING: 6800,   // $68
  LAUNDRY: 4500,    // $45
  AIRCON: 12000,    // $120
  HANDYMAN: 8000,   // $80
}

/** Cycles required per level-up per category */
export const CATEGORY_CYCLES_PER_LEVEL: Record<string, number> = {
  CLEANING: 2,
  LAUNDRY: 2,
  AIRCON: 3,
  HANDYMAN: 3,
}

/** Human-readable autonomy level names */
export const AUTONOMY_LEVEL_NAMES = [
  'Manual',                  // Level 1
  'Guided Suggestions',     // Level 2
  'Auto-Dispatch',          // Level 3
  'Predictive Pre-Booking', // Level 4
  'Full Autonomous',        // Level 5
] as const

/** Max autonomy level */
export const MAX_AUTONOMY_LEVEL = 5

/** Valid booking status transitions */
export const BOOKING_STATUS_TRANSITIONS: Record<string, string[]> = {
  assigned: ['accepted', 'cancelled'],
  accepted: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}