"use client";

import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Building2,
  Home,
  Trees,
  Briefcase,
  HelpCircle,
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  MapPin,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PropertyType } from "@/lib/types";
import { PROPERTY_TYPE_LABELS } from "@/lib/types";
import { isValidPostalCode, normalizePostalCode } from "@/lib/postal-code";
import { buildFullAddress, getRequiredFields } from "@/lib/address";

// ─── Property type selector ───────────────────────────────

const PROPERTY_TYPES: {
  value: PropertyType;
  label: string;
  icon: React.ElementType;
  desc: string;
}[] = [
  {
    value: "HDB",
    label: "HDB Flat",
    icon: Building2,
    desc: "Public housing",
  },
  {
    value: "CONDOMINIUM",
    label: "Condominium",
    icon: Building2,
    desc: "Private apartment",
  },
  {
    value: "LANDED",
    label: "Landed Property",
    icon: Trees,
    desc: "Detached / Semi-D",
  },
  {
    value: "OFFICE",
    label: "Office",
    icon: Briefcase,
    desc: "Private office building",
  },
  {
    value: "OTHER",
    label: "Other",
    icon: HelpCircle,
    desc: "Studio, dorm, etc.",
  },
];

// ─── Lookup result type ────────────────────────────────────

interface PostalLookupResult {
  blk_no: string;
  road_name: string;
  building?: string;
  address: string;
  postal: string;
  lat: number;
  lon: number;
}

// ─── Main component ───────────────────────────────────────

export interface AddressFormData {
  propertyType: PropertyType;
  postalCode: string;
  blockNumber: string;
  streetName: string;
  buildingName: string;
  level: string;
  unitNumber: string;
  houseNumber: string;
  streetAddress: string;
  label?: string;
  isDefault?: boolean;
  latitude?: number;
  longitude?: number;
}

interface AddressFormProps {
  initialData?: Partial<AddressFormData>;
  onSubmit: (data: AddressFormData) => void;
  submitLabel?: string;
  loading?: boolean;
  showPropertyTypeSelector?: boolean;
  showLabel?: boolean;
  /** Restrict to specific property types */
  allowedTypes?: PropertyType[];
  /** Hide the submit button (caller handles submission) */
  hideSubmit?: boolean;
  /** Extra class for the root container */
  className?: string;
  /** Compact mode for onboarding (smaller padding) */
  compact?: boolean;
  /** For form-level errors */
  error?: string;
}

export function AddressForm({
  initialData,
  onSubmit,
  submitLabel = "Save Address",
  loading = false,
  showPropertyTypeSelector = true,
  showLabel = false,
  allowedTypes,
  hideSubmit = false,
  className,
  compact = false,
  error: formError,
}: AddressFormProps) {
  // ── State ──
  const [form, setForm] = useState<AddressFormData>({
    propertyType: initialData?.propertyType || "HDB",
    postalCode: initialData?.postalCode || "",
    blockNumber: initialData?.blockNumber || "",
    streetName: initialData?.streetName || "",
    buildingName: initialData?.buildingName || "",
    level: initialData?.level || "",
    unitNumber: initialData?.unitNumber || "",
    houseNumber: initialData?.houseNumber || "",
    streetAddress: initialData?.streetAddress || "",
    label: initialData?.label || "",
    isDefault: initialData?.isDefault ?? true,
    latitude: initialData?.latitude,
    longitude: initialData?.longitude,
  });

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lookupStatus, setLookupStatus] = useState<
    "idle" | "searching" | "found" | "not_found" | "error"
  >("idle");
  const [lookupResults, setLookupResults] = useState<PostalLookupResult[]>(
    []
  );
  const [selectedLookupIdx, setSelectedLookupIdx] = useState<number | null>(
    null
  );

  // Note: initialData is only set on mount (used as initial state).
  // If caller needs to reset, they should use a key prop.

  // ── Derived ──
  const propertyType = form.propertyType;
  const requiredFields = getRequiredFields(propertyType);
  const types = allowedTypes
    ? PROPERTY_TYPES.filter((t) => allowedTypes.includes(t.value))
    : PROPERTY_TYPES;

  // ── Apply lookup result ──
  const applyLookupResult = useCallback((result: PostalLookupResult) => {
    setForm((prev) => ({
      ...prev,
      blockNumber: result.blk_no || prev.blockNumber,
      streetName: result.road_name || prev.streetName,
      buildingName: result.building || prev.buildingName,
      streetAddress: result.address || prev.streetAddress,
      latitude: result.lat || prev.latitude,
      longitude: result.lon || prev.longitude,
    }));
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.blockNumber;
      delete next.streetName;
      return next;
    });
  }, []);

  // ── Postal code lookup ──
  const lookupPostalCode = useCallback(async (code: string) => {
    if (!isValidPostalCode(code)) return;

    setLookupStatus("searching");
    setLookupResults([]);
    setSelectedLookupIdx(null);

    try {
      const res = await fetch(
        `/api/address/postal-lookup?code=${encodeURIComponent(code)}`
      );
      const data = await res.json();

      if (data.found && data.results?.length > 0) {
        setLookupResults(data.results);
        setLookupStatus("found");

        // Auto-apply first result if only one
        if (data.results.length === 1) {
          applyLookupResult(data.results[0]);
          setSelectedLookupIdx(0);
        }
      } else {
        setLookupStatus("not_found");
      }
    } catch {
      setLookupStatus("error");
    }
  }, [applyLookupResult]);

  const handlePostalCodeBlur = useCallback(() => {
    const code = normalizePostalCode(form.postalCode);
    if (code.length === 6) {
      lookupPostalCode(code);
    }
  }, [form.postalCode, lookupPostalCode]);

  // ── Field updates ──
  const updateField = (key: keyof AddressFormData, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear error on the field being edited
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // ── Validation ──
  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    // Postal code
    if (!form.postalCode || !isValidPostalCode(form.postalCode)) {
      errors.postalCode = "Enter a valid 6-digit postal code";
    }

    // Required fields for property type
    for (const field of requiredFields) {
      const val = form[field as keyof AddressFormData] as string;
      if (!val || !val.trim()) {
        const labels: Record<string, string> = {
          blockNumber: "Block Number",
          streetName: "Street Name",
          buildingName: "Building Name",
          level: "Level",
          unitNumber: "Unit Number",
          houseNumber: "House Number",
          streetAddress: "Street Address",
        };
        errors[field] = `${labels[field] || field} is required`;
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ── Submit ──
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    onSubmit(form);
  };

  // ── Address preview ──
  const previewAddress = (() => {
    try {
      return buildFullAddress({
        propertyType: form.propertyType,
        postalCode: form.postalCode || "000000",
        blockNumber: form.blockNumber,
        streetName: form.streetName,
        buildingName: form.buildingName,
        level: form.level,
        unitNumber: form.unitNumber,
        houseNumber: form.houseNumber,
        streetAddress: form.streetAddress,
      });
    } catch {
      return "";
    }
  })();

  // ─── Render ────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} className={cn("space-y-4", className)}>
      {/* Property Type Selector */}
      {showPropertyTypeSelector && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">
            Property Type <span className="text-red-500">*</span>
          </Label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {types.map((type) => {
              const Icon = type.icon;
              const isSelected = form.propertyType === type.value;
              return (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => {
                    updateField("propertyType", type.value);
                    setLookupResults([]);
                    setSelectedLookupIdx(null);
                    setLookupStatus("idle");
                  }}
                  className={cn(
                    "flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition-all",
                    isSelected
                      ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/20"
                      : "border-[var(--anna-border)] hover:border-[var(--anna-sage)]/40 bg-white"
                  )}
                >
                  <Icon
                    size={compact ? 16 : 20}
                    className={cn(
                      isSelected
                        ? "text-[var(--anna-sage-dark)]"
                        : "text-[var(--anna-muted)]"
                    )}
                  />
                  <span
                    className={cn(
                      "text-[10px] sm:text-xs font-medium leading-tight text-center",
                      isSelected
                        ? "text-[var(--anna-sage-dark)]"
                        : "text-[var(--anna-slate-light)]"
                    )}
                  >
                    {type.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Address Label */}
      {showLabel && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Address Label</Label>
          <Input
            value={form.label}
            onChange={(e) => updateField("label", e.target.value)}
            placeholder="e.g. Home, Office, Parents' House"
            className="h-10 text-sm"
          />
        </div>
      )}

      {/* ─── Address Fields ──────────────────────────────── */}

      {/* Postal Code with lookup */}
      <div className="space-y-1.5">
        <Label className="text-sm font-medium">
          Postal Code <span className="text-red-500">*</span>
        </Label>
        <div className="relative">
          <Input
            value={form.postalCode}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
              updateField("postalCode", digits);
              setLookupStatus("idle");
              setSelectedLookupIdx(null);
            }}
            onBlur={handlePostalCodeBlur}
            inputMode="numeric"
            placeholder="e.g. 521123"
            className={cn(
              "h-10 text-sm pr-10",
              fieldErrors.postalCode && "border-red-400"
            )}
          />
          {lookupStatus === "searching" && (
            <Loader2
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[var(--anna-muted)]"
            />
          )}
          {lookupStatus === "found" && (
            <CheckCircle2
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--anna-success)]"
            />
          )}
        </div>
        {fieldErrors.postalCode && (
          <p className="text-xs text-red-500">{fieldErrors.postalCode}</p>
        )}
      </div>

      {/* Lookup results dropdown */}
      {lookupResults.length > 1 && (
        <div className="rounded-xl border border-[var(--anna-border)] bg-white overflow-hidden">
          <div className="px-3 py-2 bg-[var(--anna-bg)] border-b border-[var(--anna-border)]">
            <p className="text-xs font-medium text-[var(--anna-muted)]">
              Select your address ({lookupResults.length} found)
            </p>
          </div>
          <div className="max-h-32 overflow-y-auto">
            {lookupResults.map((result, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  applyLookupResult(result);
                  setSelectedLookupIdx(idx);
                  setLookupResults([]);
                  setLookupStatus("found");
                }}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm hover:bg-[var(--anna-sage-light)]/20 transition-colors",
                  selectedLookupIdx === idx &&
                    "bg-[var(--anna-sage-light)]/30"
                )}
              >
                <span className="text-[var(--anna-slate-light)]">
                  {result.address}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {lookupStatus === "not_found" && form.postalCode.length === 6 && (
        <p className="text-xs text-[var(--anna-muted)] flex items-center gap-1">
          <InfoIcon size={12} />
          No match found. Please enter your address manually below.
        </p>
      )}
      {lookupStatus === "error" && (
        <p className="text-xs text-[var(--anna-warning)] flex items-center gap-1">
          <InfoIcon size={12} />
          Address lookup unavailable. Please enter manually.
        </p>
      )}

      {/* ─── Property-type-adaptive fields ──────────────── */}

      {(propertyType === "HDB" || propertyType === "CONDOMINIUM") && (
        <>
          {/* Block Number (HDB only) */}
          {propertyType === "HDB" && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Block Number <span className="text-red-500">*</span>
              </Label>
              <Input
                value={form.blockNumber}
                onChange={(e) => updateField("blockNumber", e.target.value)}
                placeholder="e.g. 123A"
                className={cn(
                  "h-10 text-sm",
                  fieldErrors.blockNumber && "border-red-400"
                )}
              />
              {fieldErrors.blockNumber && (
                <p className="text-xs text-red-500">
                  {fieldErrors.blockNumber}
                </p>
              )}
            </div>
          )}

          {/* Street Name */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              Street Name <span className="text-red-500">*</span>
            </Label>
            <Input
              value={form.streetName}
              onChange={(e) => updateField("streetName", e.target.value)}
              placeholder="e.g. Tampines Street 11"
              className={cn(
                "h-10 text-sm",
                fieldErrors.streetName && "border-red-400"
              )}
            />
            {fieldErrors.streetName && (
              <p className="text-xs text-red-500">{fieldErrors.streetName}</p>
            )}
          </div>

          {/* Building Name (Condominium only) */}
          {propertyType === "CONDOMINIUM" && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Building Name <span className="text-red-500">*</span>
              </Label>
              <Input
                value={form.buildingName}
                onChange={(e) => updateField("buildingName", e.target.value)}
                placeholder="e.g. Bedok Residences"
                className={cn(
                  "h-10 text-sm",
                  fieldErrors.buildingName && "border-red-400"
                )}
              />
              {fieldErrors.buildingName && (
                <p className="text-xs text-red-500">
                  {fieldErrors.buildingName}
                </p>
              )}
            </div>
          )}

          {/* Level + Unit Number */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Level <span className="text-red-500">*</span>
              </Label>
              <Input
                value={form.level}
                onChange={(e) => updateField("level", e.target.value)}
                placeholder="e.g. 5"
                inputMode="numeric"
                className={cn(
                  "h-10 text-sm",
                  fieldErrors.level && "border-red-400"
                )}
              />
              {fieldErrors.level && (
                <p className="text-xs text-red-500">{fieldErrors.level}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Unit Number <span className="text-red-500">*</span>
              </Label>
              <Input
                value={form.unitNumber}
                onChange={(e) => updateField("unitNumber", e.target.value)}
                placeholder="e.g. 42"
                inputMode="numeric"
                className={cn(
                  "h-10 text-sm",
                  fieldErrors.unitNumber && "border-red-400"
                )}
              />
              {fieldErrors.unitNumber && (
                <p className="text-xs text-red-500">
                  {fieldErrors.unitNumber}
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {propertyType === "LANDED" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                House Number <span className="text-red-500">*</span>
              </Label>
              <Input
                value={form.houseNumber}
                onChange={(e) => updateField("houseNumber", e.target.value)}
                placeholder="e.g. 23"
                className={cn(
                  "h-10 text-sm",
                  fieldErrors.houseNumber && "border-red-400"
                )}
              />
              {fieldErrors.houseNumber && (
                <p className="text-xs text-red-500">
                  {fieldErrors.houseNumber}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              Street Address <span className="text-red-500">*</span>
            </Label>
            <Input
              value={form.streetAddress}
              onChange={(e) => updateField("streetAddress", e.target.value)}
              placeholder="e.g. Serangoon Garden Way"
              className={cn(
                "h-10 text-sm",
                fieldErrors.streetAddress && "border-red-400"
              )}
            />
            {fieldErrors.streetAddress && (
              <p className="text-xs text-red-500">
                {fieldErrors.streetAddress}
              </p>
            )}
          </div>
        </>
      )}

      {propertyType === "OFFICE" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              Building Name <span className="text-red-500">*</span>
            </Label>
            <Input
              value={form.buildingName}
              onChange={(e) => updateField("buildingName", e.target.value)}
              placeholder="e.g. Marina Bay Financial Centre"
              className={cn(
                "h-10 text-sm",
                fieldErrors.buildingName && "border-red-400"
              )}
            />
            {fieldErrors.buildingName && (
              <p className="text-xs text-red-500">
                {fieldErrors.buildingName}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              Street Address <span className="text-red-500">*</span>
            </Label>
            <Input
              value={form.streetAddress}
              onChange={(e) => updateField("streetAddress", e.target.value)}
              placeholder="e.g. Central Boulevard"
              className={cn(
                "h-10 text-sm",
                fieldErrors.streetAddress && "border-red-400"
              )}
            />
            {fieldErrors.streetAddress && (
              <p className="text-xs text-red-500">
                {fieldErrors.streetAddress}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Level <span className="text-red-500">*</span>
              </Label>
              <Input
                value={form.level}
                onChange={(e) => updateField("level", e.target.value)}
                placeholder="e.g. 15"
                inputMode="numeric"
                className={cn(
                  "h-10 text-sm",
                  fieldErrors.level && "border-red-400"
                )}
              />
              {fieldErrors.level && (
                <p className="text-xs text-red-500">{fieldErrors.level}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Unit Number <span className="text-red-500">*</span>
              </Label>
              <Input
                value={form.unitNumber}
                onChange={(e) => updateField("unitNumber", e.target.value)}
                placeholder="e.g. 08"
                inputMode="numeric"
                className={cn(
                  "h-10 text-sm",
                  fieldErrors.unitNumber && "border-red-400"
                )}
              />
              {fieldErrors.unitNumber && (
                <p className="text-xs text-red-500">
                  {fieldErrors.unitNumber}
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {propertyType === "OTHER" && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">
            Street Address <span className="text-red-500">*</span>
          </Label>
          <Input
            value={form.streetAddress}
            onChange={(e) => updateField("streetAddress", e.target.value)}
            placeholder="e.g. Full address"
            className={cn(
              "h-10 text-sm",
              fieldErrors.streetAddress && "border-red-400"
            )}
          />
          {fieldErrors.streetAddress && (
            <p className="text-xs text-red-500">
              {fieldErrors.streetAddress}
            </p>
          )}
        </div>
      )}

      {/* ─── Address Preview ────────────────────────────── */}
      {form.postalCode.length === 6 && (
        <div className="rounded-xl bg-[var(--anna-bg)] border border-[var(--anna-border)] p-3">
          <p className="text-xs font-medium text-[var(--anna-muted)] mb-1 flex items-center gap-1">
            <MapPin size={12} />
            Address Preview
          </p>
          <p className="text-sm text-[var(--anna-slate)]">{previewAddress}</p>
        </div>
      )}

      {/* Form-level error */}
      {formError && (
        <p className="text-xs text-red-500">{formError}</p>
      )}

      {/* Submit button */}
      {!hideSubmit && (
        <Button
          type="submit"
          disabled={loading}
          className={cn(
            "w-full h-10 text-sm font-semibold rounded-xl",
            "bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white"
          )}
        >
          {loading ? (
            <Loader2 size={16} className="animate-spin mr-2" />
          ) : (
            <CheckCircle2 size={16} className="mr-2" />
          )}
          {submitLabel}
        </Button>
      )}
    </form>
  );
}

// ─── Tiny info icon ────────────────────────────────────

function InfoIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className="inline-flex"
    >
      <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.15" />
      <path
        d="M8 7v4M8 5v.01"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
