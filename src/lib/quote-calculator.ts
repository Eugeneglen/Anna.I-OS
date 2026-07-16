// ─── Quote Calculator — Pure function, no DB, no side effects ───

export interface JobTypePricingRules {
  type: "flat" | "per_unit" | "per_room" | "per_item";
  unitField?: string;
  multiplierField?: string;
  areaMultiplier?: {
    field: string;
    tiers: { maxSqft: number; multiplier: number }[];
  };
  surcharges?: {
    key: string;
    label: string;
    amountCents: number;
    perUnit?: boolean;
  }[];
}

export interface JobTypeRequiredField {
  key: string;
  label: string;
  type: "number" | "select";
  min?: number;
  max?: number;
  defaultValue?: number;
  options?: { label: string; value: number }[];
}

export interface JobTypeAddOn {
  key: string;
  label: string;
  priceCents: number;
  pricingType: "flat" | "per_unit" | "per_room" | "per_item";
  unitField?: string;
}

export interface QuoteLineItem {
  label: string;
  amountCents: number;
}

export interface QuoteResult {
  baseCents: number;
  addOnsCents: number;
  totalCents: number;
  breakdown: QuoteLineItem[];
}

/**
 * Calculate a quotation from job type pricing rules, user field values, and selected add-ons.
 *
 * Application order for base price:
 *   1. Start with basePriceCents
 *   2. If per_unit / per_room / per_item: multiply by fieldValues[unitField]
 *   3. If multiplierField exists: multiply by fieldValues[multiplierField]
 *   4. If areaMultiplier exists: multiply by the matching tier multiplier
 *   5. If surcharges exist and matching fieldValues[surcharge.key] is truthy: add surcharge
 *   6. Round to nearest integer
 *
 * Add-ons:
 *   - "flat": add priceCents directly
 *   - "per_unit" / "per_room" / "per_item": priceCents × fieldValues[unitField]
 */
export function calculateQuote(
  basePriceCents: number,
  pricingRules: JobTypePricingRules,
  requiredFields: JobTypeRequiredField[],
  addOns: JobTypeAddOn[],
  fieldValues: Record<string, number>,
  selectedAddOnKeys: string[]
): QuoteResult {
  const breakdown: QuoteLineItem[] = [];
  let baseCents = basePriceCents;

  // Get unit count for per_unit pricing
  const unitCount =
    pricingRules.unitField && (pricingRules.type === "per_unit" || pricingRules.type === "per_room" || pricingRules.type === "per_item")
      ? fieldValues[pricingRules.unitField] ?? 1
      : 1;

  // Step 1: Per-unit / per-room / per-item multiplier
  if (
    (pricingRules.type === "per_unit" ||
      pricingRules.type === "per_room" ||
      pricingRules.type === "per_item") &&
    pricingRules.unitField
  ) {
    baseCents = baseCents * unitCount;
  }

  // Step 2: Select/multiplier field (e.g., loadSize with value 1.5)
  if (pricingRules.multiplierField) {
    const multiplier = fieldValues[pricingRules.multiplierField] ?? 1;
    baseCents = baseCents * multiplier;
  }

  // Step 3: Area-based multiplier
  if (pricingRules.areaMultiplier) {
    const areaValue = fieldValues[pricingRules.areaMultiplier.field];
    if (areaValue !== undefined) {
      const sortedTiers = [...pricingRules.areaMultiplier.tiers].sort(
        (a, b) => a.maxSqft - b.maxSqft
      );
      const matchingTier = sortedTiers.find((t) => areaValue <= t.maxSqft);
      if (matchingTier) {
        baseCents = baseCents * matchingTier.multiplier;
      }
    }
  }

  // Step 4: Surcharges (triggered by boolean-like field values)
  let surchargesCents = 0;
  if (pricingRules.surcharges && pricingRules.surcharges.length > 0) {
    for (const surcharge of pricingRules.surcharges) {
      if (fieldValues[surcharge.key]) {
        const amount = surcharge.perUnit
          ? surcharge.amountCents * unitCount
          : surcharge.amountCents;
        surchargesCents += amount;
        breakdown.push({ label: surcharge.label, amountCents: Math.round(amount) });
      }
    }
  }

  // Round base
  baseCents = Math.round(baseCents);
  const totalBaseCents = baseCents + Math.round(surchargesCents);

  // Build base line item
  const baseLabel = buildBaseLabel(pricingRules, requiredFields, fieldValues, unitCount);
  breakdown.unshift({ label: baseLabel, amountCents: totalBaseCents });

  // Step 5: Calculate add-ons
  let addOnsCents = 0;
  const selectedSet = new Set(selectedAddOnKeys);

  for (const addOn of addOns) {
    if (!selectedSet.has(addOn.key)) continue;

    let addOnTotal = addOn.priceCents;

    if (
      (addOn.pricingType === "per_unit" ||
        addOn.pricingType === "per_room" ||
        addOn.pricingType === "per_item") &&
      addOn.unitField
    ) {
      const count = fieldValues[addOn.unitField] ?? 1;
      addOnTotal = addOnTotal * count;
    }

    addOnTotal = Math.round(addOnTotal);
    addOnsCents += addOnTotal;
    breakdown.push({ label: addOn.label, amountCents: addOnTotal });
  }

  const totalCents = totalBaseCents + addOnsCents;

  return { baseCents: totalBaseCents, addOnsCents, totalCents, breakdown };
}

/**
 * Build a human-readable label for the base line item.
 */
function buildBaseLabel(
  pricingRules: JobTypePricingRules,
  _requiredFields: JobTypeRequiredField[],
  _fieldValues: Record<string, number>,
  _unitCount: number
): string {
  switch (pricingRules.type) {
    case "per_unit":
      return "Base service";
    case "per_room":
      return "Base service";
    case "per_item":
      return "Base service";
    case "flat":
    default:
      return "Base service";
  }
}