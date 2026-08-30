import { z } from "zod";

/**
 * Marketing validation schemas (remediation card F8).
 *
 * One source of truth for the SegmentFilters shape and campaign bounds,
 * imported by create/edit/preview routes so preview and compute CANNOT
 * diverge (the existing invariant, now type-enforced).
 *
 * Bounds rationale:
 *  - spend/AOV caps ≤ $100k (10_000_000 cents) — absurd-but-typed inputs
 *    like 1e18 previously crashed SQL aggregation with a 500.
 *  - PERCENTAGE discountValue ≤ 100 (audit: >100% could drive
 *    finalAmountCents negative).
 *  - FIXED_AMOUNT discountValue ≤ 100_000 (=$100k; applied as value×100
 *    cents at redemption).
 *  - autonomy levels are 1–5 by product definition.
 *  - string/array caps keep filter JSON bounded.
 */

export const MAX_SPEND_CENTS = 10_000_000; // $100k
export const MAX_FIXED_DISCOUNT_VALUE = 100_000; // $100k (value × 100 cents)
export const MAX_PERCENT_DISCOUNT = 100;

const intNonNegative = z.number().int().min(0);
const spendCents = intNonNegative.max(MAX_SPEND_CENTS);
const shortString = z.string().max(120);
const boundedStringArray = z.array(z.string().max(60)).max(20);

export const segmentFiltersSchema = z
  .object({
    // Recency
    lastOrderDaysMin: intNonNegative.max(3650).optional(),
    lastOrderDaysMax: intNonNegative.max(3650).optional(),
    // Frequency
    minOrders: intNonNegative.max(1_000_000).optional(),
    maxOrders: intNonNegative.max(1_000_000).optional(),
    // Monetary
    minTotalSpendCents: spendCents.optional(),
    maxTotalSpendCents: spendCents.optional(),
    minAvgOrderValueCents: spendCents.optional(),
    // Category
    categoriesUsed: boundedStringArray.optional(),
    categoriesNeverTried: boundedStringArray.optional(),
    // Account
    minAccountAgeDays: intNonNegative.max(3650).optional(),
    maxAccountAgeDays: intNonNegative.max(3650).optional(),
    // Subscription
    subscriptionTier: z.enum(["HOME", "CARE"]).optional(),
    // RFM — values produced by behaviour-engine getRfmSegment()
    rfmSegment: z
      .enum([
        "Champions",
        "Loyal",
        "Recent",
        "Regular",
        "About to Sleep",
        "At Risk",
        "Lost",
        "New",
        "Average",
      ])
      .optional(),
    churnRisk: z.array(z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])).max(4).optional(),
    lifecycleStage: z
      .array(z.enum(["NEW", "ACTIVE", "REGULAR", "DECLINING", "LAPSED", "REACTIVATED"]))
      .max(6)
      .optional(),
    // Acquisition — AcquisitionSource enum values
    acquisitionSource: z
      .array(z.enum(["PILOT_COHORT", "PUBLIC_CODE", "PARTNERSHIP_REFERRAL", "ORGANIC", "OTHER"]))
      .max(5)
      .optional(),
    // ── Phase 2 expanded filters ──
    customerValue: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
    minVouchersRedeemed: intNonNegative.max(1_000_000).optional(),
    geographicArea: shortString.optional(),
    nameContains: shortString.optional(),
    activityLevel: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    marketingEngagement: z.enum(["ENGAGED", "NOT_ENGAGED"]).optional(),
    minAutonomyLevel: z.number().int().min(1).max(5).optional(),
  })
  .strict() // reject unknown keys — filters shape is closed
  .refine(
    (f) =>
      f.lastOrderDaysMin === undefined ||
      f.lastOrderDaysMax === undefined ||
      f.lastOrderDaysMin <= f.lastOrderDaysMax,
    { message: "lastOrderDaysMin must be ≤ lastOrderDaysMax" }
  )
  .refine(
    (f) =>
      f.minOrders === undefined ||
      f.maxOrders === undefined ||
      f.minOrders <= f.maxOrders,
    { message: "minOrders must be ≤ maxOrders" }
  )
  .refine(
    (f) =>
      f.minTotalSpendCents === undefined ||
      f.maxTotalSpendCents === undefined ||
      f.minTotalSpendCents <= f.maxTotalSpendCents,
    { message: "minTotalSpendCents must be ≤ maxTotalSpendCents" }
  )
  .refine(
    (f) =>
      f.minAccountAgeDays === undefined ||
      f.maxAccountAgeDays === undefined ||
      f.minAccountAgeDays <= f.maxAccountAgeDays,
    { message: "minAccountAgeDays must be ≤ maxAccountAgeDays" }
  );

export type SegmentFiltersInput = z.infer<typeof segmentFiltersSchema>;

/**
 * Discount rule bounds applied wherever a campaign is created (or its
 * discount edited). Compose with route-level schemas via .superRefine.
 */
export const discountRuleRefinement = <
  T extends { discountType: string; discountValue: number; maxDiscountCapCents?: number }
>(
  data: T,
  ctx: z.RefinementCtx
): void => {
  if (data.discountType === "PERCENTAGE" && data.discountValue > MAX_PERCENT_DISCOUNT) {
    ctx.addIssue({
      code: "custom",
      path: ["discountValue"],
      message: "Percentage discount cannot exceed 100%",
    });
  }
  if (data.discountType === "FIXED_AMOUNT" && data.discountValue > MAX_FIXED_DISCOUNT_VALUE) {
    ctx.addIssue({
      code: "custom",
      path: ["discountValue"],
      message: "Fixed discount cannot exceed $100,000",
    });
  }
  if (
    data.maxDiscountCapCents !== undefined &&
    data.maxDiscountCapCents > MAX_SPEND_CENTS
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["maxDiscountCapCents"],
      message: "Discount cap cannot exceed $100,000",
    });
  }
};

/** Shared ISO-date string check (rejects garbage before `new Date()` NaNaNaN). */
export const isoDateString = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), {
    message: "Must be a valid ISO-8601 datetime string",
  });
