// ─── Quote Calculator — Pure function, no DB, no side effects ───

export interface JobTypePricingRules {
  type: "flat" | "per_unit" | "per_room" | "per_item";
  unitField?: string;
  multiplierField?: string;
  areaMultiplier?: {
    field: string;
    tiers: { maxSqft: number; multiplier: number }[];
  };
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
 *   5. Round to nearest integer
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

  // Step 1: Per-unit / per-room / per-item multiplier
  if (
    (pricingRules.type === "per_unit" ||
      pricingRules.type === "per_room" ||
      pricingRules.type === "per_item") &&
    pricingRules.unitField
  ) {
    const unitCount = fieldValues[pricingRules.unitField] ?? 1;
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
      // Tiers are sorted ascending by maxSqft; find the first tier whose maxSqft >= areaValue
      const sortedTiers = [...pricingRules.areaMultiplier.tiers].sort(
        (a, b) => a.maxSqft - b.maxSqft
      );
      const matchingTier = sortedTiers.find((t) => areaValue <= t.maxSqft);
      if (matchingTier) {
        baseCents = baseCents * matchingTier.multiplier;
      }
    }
  }

  // Round base
  baseCents = Math.round(baseCents);

  // Build base line item label
  const baseLabel = buildBaseLabel(pricingRules, requiredFields, fieldValues);
  breakdown.push({ label: baseLabel, amountCents: baseCents });

  // Step 4: Calculate add-ons
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

  const totalCents = baseCents + addOnsCents;

  return { baseCents, addOnsCents, totalCents, breakdown };
}

/**
 * Build a human-readable label for the base line item.
 */
function buildBaseLabel(
  pricingRules: JobTypePricingRules,
  _requiredFields: JobTypeRequiredField[],
  _fieldValues: Record<string, number>
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