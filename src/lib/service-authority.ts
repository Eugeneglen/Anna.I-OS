// ============================================================
// Service / Pricing / Availability Authority
// ============================================================
// The SINGLE operational source of truth for what Anna.I offers, what
// it costs, and what is currently bookable — with role-specific access
// and presentation layered on top:
//
//   Ops configuration  →  ServiceJobType  →  calculateQuote()
//                     →  User UI / Ask Anna / Ops AI / Vendor AI
//                     →  Task (price snapshot at customer approval)
//                     →  EscrowLedger
//                     →  future Stripe PaymentIntent
//
// Authority rules (enforced at every task-creation writer):
//   1. A client-supplied `amountCents` is NEVER a pricing authority for
//      a catalogue service — the server always recomputes from the live
//      ServiceJobType row through calculateQuote(). Client amounts are
//      accepted only on the explicit off-catalogue "custom request"
//      path (no jobTypeId / quotationId), sanity-capped, and stamped
//      with metadata.pricingSource = "custom_request".
//   2. CATEGORY_DEFAULTS and the retired category_price_* config are
//      presentation-only (labels/icons). No code path may read them as
//      a price.
//   3. Price snapshot: once a task is customer-approved its amounts are
//      frozen on the Task row (amountCents / finalAmountCents). Later
//      Ops catalogue edits never retro-change an existing booking; NEW
//      bookings (including rebook) re-price from the live catalogue.
//   4. Availability = ServiceJobType.isActive at booking time. A
//      disabled service can be listed (history, ops views) but can
//      never be newly booked, quoted, or AI-booked.
//   5. The AI is never a pricing authority: it retrieves authoritative
//      data through the tools in nlu-tools.ts / vendor-ai-tools.ts and
//      must refuse to state a price it could not look up.
// ============================================================

import { db } from "@/lib/db";
import {
  calculateQuote,
  type JobTypeAddOn,
  type JobTypePricingRules,
  type JobTypeRequiredField,
  type QuoteResult,
} from "./quote-calculator";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/** Row shape needed to run the authoritative quote engine. */
export interface AuthorityJobTypeRow {
  id: string;
  category: string;
  name: string;
  slug: string;
  description: string;
  basePriceCents: number;
  unitLabel: string;
  pricingRules: unknown; // Prisma Json
  requiredFields: unknown; // Prisma Json
  addOns: unknown; // Prisma Json
  isActive: boolean;
}

/** Public card view of a catalogue service — safe for AI and UI. */
export interface CatalogueServiceView {
  jobTypeId: string;
  category: string;
  name: string;
  slug: string;
  description: string;
  basePriceCents: number;
  unitLabel: string;
  pricingType: string;
  unitField?: string;
  unitMin?: number;
  unitMax?: number;
  isActive: boolean;
  addOns: { key: string; label: string; priceCents: number }[];
}

/** Inputs for an authoritative quote. */
export interface AuthorityQuoteRequest {
  /** Convenience: value applied to pricingRules.unitField (e.g. 2 aircon units). */
  units?: number;
  /** Full dynamic-field answers (quotation-style callers). */
  fieldValues?: Record<string, number>;
  /** Selected catalogue add-on keys. */
  selectedAddOns?: string[];
}

export type AuthorityQuoteResult =
  | {
      ok: true;
      jobType: AuthorityJobTypeRow;
      quote: QuoteResult;
    }
  | {
      ok: false;
      code: "NOT_FOUND" | "INACTIVE" | "UNITS_OUT_OF_RANGE" | "LOOKUP_FAILED";
      message: string;
    };

// ─────────────────────────────────────────────────────────────
// JSON casting helpers (Prisma Json columns → quote-calculator types)
// ─────────────────────────────────────────────────────────────

interface JsonCarryingRow {
  pricingRules: unknown;
  requiredFields: unknown;
  addOns: unknown;
}

export function castJobTypePricing(row: JsonCarryingRow): {
  pricingRules: JobTypePricingRules;
  requiredFields: JobTypeRequiredField[];
  addOns: JobTypeAddOn[];
} {
  const rules =
    row.pricingRules && typeof row.pricingRules === "object"
      ? (row.pricingRules as JobTypePricingRules)
      : { type: "flat" as const };
  const fields = Array.isArray(row.requiredFields)
    ? (row.requiredFields as JobTypeRequiredField[])
    : [];
  const addons = Array.isArray(row.addOns) ? (row.addOns as JobTypeAddOn[]) : [];
  return { pricingRules: rules, requiredFields: fields, addOns: addons };
}

const AUTHORITY_SELECT = {
  id: true,
  category: true,
  name: true,
  slug: true,
  description: true,
  basePriceCents: true,
  unitLabel: true,
  pricingRules: true,
  requiredFields: true,
  addOns: true,
  isActive: true,
} as const;

// ─────────────────────────────────────────────────────────────
// Catalogue listing (availability authority)
// ─────────────────────────────────────────────────────────────

function toCatalogueView(row: AuthorityJobTypeRow): CatalogueServiceView {
  const { pricingRules, requiredFields, addOns } = castJobTypePricing(row);
  const unitField = pricingRules.unitField;
  const unitFieldDef = unitField
    ? requiredFields.find((f) => f.key === unitField)
    : undefined;
  return {
    jobTypeId: row.id,
    category: row.category,
    name: row.name,
    slug: row.slug,
    description: row.description,
    basePriceCents: row.basePriceCents,
    unitLabel: row.unitLabel,
    pricingType: pricingRules.type ?? "flat",
    unitField,
    unitMin: unitFieldDef?.min,
    unitMax: unitFieldDef?.max,
    isActive: row.isActive,
    addOns: addOns.map((a) => ({
      key: a.key,
      label: a.label,
      priceCents: a.priceCents,
    })),
  };
}

/**
 * Live, active-only catalogue listing. This is the availability
 * authority for every surface (user browse, AI lookup, vendor scoping).
 */
export async function listActiveJobTypes(
  category?: string
): Promise<CatalogueServiceView[]> {
  const rows = await db.serviceJobType.findMany({
    where: category
      ? { category: category as never, isActive: true }
      : { isActive: true },
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: AUTHORITY_SELECT,
  });
  return (rows as unknown as AuthorityJobTypeRow[]).map(toCatalogueView);
}

/** Full catalogue including inactive rows (ops/status views only). */
export async function listAllJobTypes(
  category?: string
): Promise<CatalogueServiceView[]> {
  const rows = await db.serviceJobType.findMany({
    where: category ? { category: category as never } : undefined,
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: AUTHORITY_SELECT,
  });
  return (rows as unknown as AuthorityJobTypeRow[]).map(toCatalogueView);
}

// ─────────────────────────────────────────────────────────────
// Booking resolution + authoritative quoting
// ─────────────────────────────────────────────────────────────

/**
 * Resolve a SPECIFIC job type for booking. Never falls back to
 * `findFirst({ category })` — a booking must target one concrete
 * catalogue service (slug/id), and it must be active.
 */
export async function resolveJobTypeForBooking(
  jobTypeId: string
): Promise<
  | { ok: true; jobType: AuthorityJobTypeRow }
  | { ok: false; code: "NOT_FOUND" | "INACTIVE"; message: string }
> {
  if (!jobTypeId || typeof jobTypeId !== "string") {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "A specific catalogue service (jobTypeId) is required",
    };
  }
  const row = (await db.serviceJobType.findUnique({
    where: { id: jobTypeId },
    select: AUTHORITY_SELECT,
  })) as unknown as AuthorityJobTypeRow | null;
  if (!row) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: `Unknown job type: ${jobTypeId}`,
    };
  }
  if (!row.isActive) {
    return {
      ok: false,
      code: "INACTIVE",
      message: `Job type "${row.name}" is currently inactive`,
    };
  }
  return { ok: true, jobType: row };
}

/**
 * Authoritative quote for a job type the caller has ALREADY loaded and
 * validated. Pure computation on top of calculateQuote().
 *
 * Field-value precedence (highest wins):
 *   explicit fieldValues > units (applied to pricingRules.unitField) >
 *   requiredFields defaultValue
 */
export function quoteLoadedJobType(
  jobType: AuthorityJobTypeRow,
  req: AuthorityQuoteRequest = {}
): AuthorityQuoteResult {
  const { pricingRules, requiredFields, addOns } = castJobTypePricing(jobType);

  // Start from declared defaults so flat/per-unit math always has a value.
  const fieldValues: Record<string, number> = {};
  for (const f of requiredFields) {
    if (typeof f.defaultValue === "number") fieldValues[f.key] = f.defaultValue;
  }
  if (req.fieldValues) {
    for (const [k, v] of Object.entries(req.fieldValues)) {
      if (typeof v === "number" && Number.isFinite(v)) fieldValues[k] = v;
    }
  }
  const unitField = pricingRules.unitField;
  if (req.units !== undefined && unitField) {
    const def = requiredFields.find((f) => f.key === unitField);
    const min = def?.min;
    const max = def?.max;
    if (
      !Number.isInteger(req.units) ||
      req.units < 1 ||
      (min !== undefined && req.units < min) ||
      (max !== undefined && req.units > max)
    ) {
      return {
        ok: false,
        code: "UNITS_OUT_OF_RANGE",
        message: `Units must be a whole number${
          min !== undefined && max !== undefined ? ` between ${min} and ${max}` : " ≥ 1"
        }`,
      };
    }
    fieldValues[unitField] = req.units;
  }

  const quote = calculateQuote(
    jobType.basePriceCents,
    pricingRules,
    requiredFields,
    addOns,
    fieldValues,
    req.selectedAddOns ?? []
  );
  return { ok: true, jobType, quote };
}

/**
 * Load + validate + quote in one step — the canonical entry point for
 * every booking writer that has a jobTypeId (manual HTTP, AI create,
 * rebook, predictive confirm).
 */
export async function quoteJobType(
  jobTypeId: string,
  req: AuthorityQuoteRequest = {}
): Promise<AuthorityQuoteResult> {
  const resolved = await resolveJobTypeForBooking(jobTypeId);
  if (!resolved.ok) return resolved;
  return quoteLoadedJobType(resolved.jobType, req);
}

// ─────────────────────────────────────────────────────────────
// Status lookup (service / price / availability questions)
// ─────────────────────────────────────────────────────────────

/**
 * Distinguish "service exists but is currently unavailable" from
 * "service does not exist" — required for honest AI answers.
 */
export async function lookupServiceStatus(
  jobTypeIdOrSlug: string
): Promise<{
  exists: boolean;
  active: boolean;
  service?: CatalogueServiceView;
}> {
  if (!jobTypeIdOrSlug) return { exists: false, active: false };
  const row = (await db.serviceJobType.findFirst({
    where: { OR: [{ id: jobTypeIdOrSlug }, { slug: jobTypeIdOrSlug }] },
    select: AUTHORITY_SELECT,
  })) as unknown as AuthorityJobTypeRow | null;
  if (!row) return { exists: false, active: false };
  return { exists: true, active: row.isActive, service: toCatalogueView(row) };
}

// ─────────────────────────────────────────────────────────────
// Snapshot rule helper
// ─────────────────────────────────────────────────────────────

/**
 * The single finalAmountCents formula (the task-amount invariant):
 *   finalAmountCents = amountCents − discountCents
 * Every writer must stamp BOTH fields together through this helper so
 * the `finalAmountCents || amountCents` fallback idiom in consumers
 * never has to fire for newly created tasks.
 */
export function stampTaskAmounts(amountCents: number, discountCents = 0) {
  return {
    amountCents,
    discountCents,
    finalAmountCents: amountCents - discountCents,
  };
}
