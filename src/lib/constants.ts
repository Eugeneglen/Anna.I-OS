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

// ============================================================
// Anomaly Detection SLA Thresholds (Phase 3)
// ============================================================

/** Minutes past scheduled start before vendor is flagged as late */
export const VENDOR_LATE_SLA_MINUTES = 30

/** Hours after dispatch before a task is flagged as overdue */
export const TASK_OVERDUE_SLA_HOURS = 4

/** Hours after completion before missing verification is flagged */
export const VERIFICATION_MISSING_SLA_HOURS = 24

/** Minimum rating drop (out of 5) to trigger RATING_DROP anomaly */
export const RATING_DROP_THRESHOLD = 1.5

/** Human-readable labels for anomaly types */
export const ANOMALY_TYPE_LABELS: Record<string, string> = {
  VENDOR_LATE: 'Vendor Late',
  TASK_OVERDUE: 'Task Overdue',
  VERIFICATION_MISSING: 'Verification Missing',
  RATING_DROP: 'Rating Drop',
  ESCROW_DISPUTED: 'Escrow Disputed',
}

/** Severity color mapping for UI */
export const ANOMALY_SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  CRITICAL: {
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
    dot: 'bg-red-500',
  },
  HIGH: {
    bg: 'bg-orange-50',
    text: 'text-orange-700',
    border: 'border-orange-200',
    dot: 'bg-orange-500',
  },
  MEDIUM: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    dot: 'bg-amber-500',
  },
  LOW: {
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    dot: 'bg-blue-500',
  },
}