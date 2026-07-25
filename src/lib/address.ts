// ============================================================
// Address Formatting Utility
// Builds human-readable Singapore addresses by property type
// ============================================================

import type { PropertyType } from "@/lib/types";

// Re-export for convenience (avoids circular dep with types.ts)
export type { PropertyType };

/**
 * Input data for building a full address.
 * Not all fields are used for every property type —
 * use `getRequiredFields()` to know which ones are needed.
 */
export interface AddressData {
  propertyType: PropertyType;
  postalCode: string;
  blockNumber?: string | null;
  streetName?: string | null;
  buildingName?: string | null;
  level?: string | null;
  unitNumber?: string | null;
  houseNumber?: string | null;
  streetAddress?: string | null;
}

/**
 * Builds a human-readable Singapore address from its components.
 *
 * Format by property type:
 * - HDB:          Block {blockNumber} {streetName}, #{level}-{unitNumber}, Singapore {postalCode}
 * - CONDOMINIUM:  {buildingName}, {streetName}, #{level}-{unitNumber}, Singapore {postalCode}
 * - LANDED:       {houseNumber} {streetAddress}, Singapore {postalCode}
 * - OFFICE:       {buildingName}, {streetAddress}, #{level}-{unitNumber}, Singapore {postalCode}
 * - OTHER:        {streetAddress}, Singapore {postalCode}
 */
export function buildFullAddress(data: AddressData): string {
  const { propertyType, postalCode } = data;
  const parts: string[] = [];

  switch (propertyType) {
    case "HDB": {
      const block = [data.blockNumber, data.streetName].filter(Boolean).join(" ");
      if (block) parts.push(block);
      const unit = formatUnit(data.level, data.unitNumber);
      if (unit) parts.push(unit);
      break;
    }

    case "CONDOMINIUM": {
      if (data.buildingName) parts.push(data.buildingName);
      if (data.streetName) parts.push(data.streetName);
      const unit = formatUnit(data.level, data.unitNumber);
      if (unit) parts.push(unit);
      break;
    }

    case "LANDED": {
      const landed = [data.houseNumber, data.streetAddress].filter(Boolean).join(" ");
      if (landed) parts.push(landed);
      break;
    }

    case "OFFICE": {
      if (data.buildingName) parts.push(data.buildingName);
      if (data.streetAddress) parts.push(data.streetAddress);
      const unit = formatUnit(data.level, data.unitNumber);
      if (unit) parts.push(unit);
      break;
    }

    case "OTHER":
    default: {
      // Fallback: use whatever street info is available
      const fallback = [data.streetAddress, data.streetName].filter(Boolean).join(" ");
      if (fallback) parts.push(fallback);
      break;
    }
  }

  parts.push(`Singapore ${postalCode}`);

  return parts.filter(Boolean).join(", ");
}

/**
 * Returns which fields are required for a given property type.
 * The returned field names match the keys in `AddressData`.
 */
export function getRequiredFields(propertyType: PropertyType): string[] {
  switch (propertyType) {
    case "HDB":
      return ["postalCode", "blockNumber", "streetName", "level", "unitNumber"];
    case "CONDOMINIUM":
      return ["postalCode", "buildingName", "streetName", "level", "unitNumber"];
    case "LANDED":
      return ["postalCode", "houseNumber", "streetAddress"];
    case "OFFICE":
      return ["postalCode", "buildingName", "streetAddress", "level", "unitNumber"];
    case "OTHER":
    default:
      return ["postalCode", "streetAddress"];
  }
}

/**
 * Returns a human-readable label for a property type enum value.
 */
export function getPropertyTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    HDB: "HDB Flat",
    CONDOMINIUM: "Condominium",
    LANDED: "Landed Property",
    OFFICE: "Office",
    OTHER: "Other",
  };
  return labels[type] || type;
}

// ─── Internal helpers ───────────────────────────────────────

function formatUnit(level?: string | null, unit?: string | null): string {
  if (!level && !unit) return "";
  return `#${level ?? ""}-${unit ?? ""}`;
}
