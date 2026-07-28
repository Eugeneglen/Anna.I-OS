"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// Types — mirrors ServiceJobType["pricingRules"]
// ============================================================

interface AreaMultiplierTier {
  maxSqft: number;
  multiplier: number;
}

interface AreaMultiplier {
  field: string;
  tiers: AreaMultiplierTier[];
}

interface Surcharge {
  key: string;
  label: string;
  amountCents: number;
  perUnit?: boolean;
}

export interface PricingRules {
  type: "flat" | "per_unit" | "per_room" | "per_item";
  unitField?: string;
  multiplierField?: string;
  areaMultiplier?: AreaMultiplier;
  surcharges?: Surcharge[];
}

export interface PricingRulesEditorProps {
  rules: PricingRules;
  onChange: (rules: PricingRules) => void;
}

const PRICING_TYPES = [
  { value: "flat", label: "Flat" },
  { value: "per_unit", label: "Per Unit" },
  { value: "per_room", label: "Per Room" },
  { value: "per_item", label: "Per Item" },
] as const;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/(^_|_$)/g, "");
}

const DEFAULT_RULES: PricingRules = { type: "flat" };

// ============================================================
// Component
// ============================================================

export default function PricingRulesEditor({
  rules: incomingRules,
  onChange,
}: PricingRulesEditorProps) {
  // Defensive: ensure rules is always a valid object
  const rules = incomingRules && typeof incomingRules === "object"
    ? incomingRules
    : DEFAULT_RULES;

  const [areaOpen, setAreaOpen] = useState(!!rules.areaMultiplier);
  const [surchargesOpen, setSurchargesOpen] = useState(
    (rules.surcharges?.length ?? 0) > 0
  );

  function update(partial: Partial<PricingRules>) {
    onChange({ ...rules, ...partial });
  }

  return (
    <div className="space-y-3">
      {/* ── Main row: pricing type + conditional fields ── */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={rules.type}
          onChange={(e) =>
            update({
              type: e.target.value as PricingRules["type"],
              ...(e.target.value === "flat"
                ? { unitField: undefined, multiplierField: undefined }
                : {}),
            })
          }
          className="h-7 rounded-lg border border-[var(--anna-border)] bg-[var(--anna-white)] px-2 text-xs text-[var(--anna-slate)]"
        >
          {PRICING_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        {/* unitField — shown for per_unit / per_room / per_item */}
        {rules.type !== "flat" && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[var(--anna-muted)]">
              Unit Field
            </span>
            <Input
              value={rules.unitField ?? ""}
              onChange={(e) =>
                update({ unitField: e.target.value || undefined })
              }
              placeholder="e.g. rooms"
              className="h-7 w-24 rounded-lg border-[var(--anna-border)] text-xs"
            />
          </div>
        )}

        {/* multiplierField — shown for per_unit / per_room */}
        {rules.type !== "flat" && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[var(--anna-muted)]">
              Multiplier Field
            </span>
            <Input
              value={rules.multiplierField ?? ""}
              onChange={(e) =>
                update({ multiplierField: e.target.value || undefined })
              }
              placeholder="e.g. floors"
              className="h-7 w-24 rounded-lg border-[var(--anna-border)] text-xs"
            />
          </div>
        )}
      </div>

      {/* ── Area Multiplier section (collapsible, relevant for per_room) ── */}
      {rules.type === "per_room" && (
        <div className="rounded-lg border border-[var(--anna-border)] bg-[var(--anna-bg)]">
          <button
            type="button"
            onClick={() => setAreaOpen(!areaOpen)}
            className="flex items-center justify-between w-full px-3 py-2 text-left"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Area Multiplier
              {rules.areaMultiplier && (
                <Badge
                  variant="secondary"
                  className="ml-2 text-[8px] bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
                >
                  {rules.areaMultiplier.tiers.length} tier
                  {rules.areaMultiplier.tiers.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </span>
            {areaOpen ? (
              <ChevronUp size={14} className="text-[var(--anna-muted)]" />
            ) : (
              <ChevronDown size={14} className="text-[var(--anna-muted)]" />
            )}
          </button>

          {areaOpen && (
            <div className="px-3 pb-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--anna-muted)]">
                  Area Field
                </span>
                <Input
                  value={rules.areaMultiplier?.field ?? ""}
                  onChange={(e) => {
                    const existing = rules.areaMultiplier ?? { field: "", tiers: [] };
                    update({
                      areaMultiplier: { ...existing, field: e.target.value },
                    });
                  }}
                  placeholder="e.g. area_sqft"
                  className="h-6 w-28 rounded-lg border-[var(--anna-border)] text-xs"
                />
              </div>

              {/* Tiers table */}
              <div className="space-y-1.5">
                {rules.areaMultiplier?.tiers.map((tier, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2"
                  >
                    <Input
                      type="number"
                      value={tier.maxSqft}
                      onChange={(e) => {
                        const tiers = [...(rules.areaMultiplier?.tiers ?? [])];
                        tiers[idx] = { ...tiers[idx], maxSqft: parseInt(e.target.value) || 0 };
                        update({
                          areaMultiplier: {
                            field: rules.areaMultiplier?.field ?? "",
                            tiers,
                          },
                        });
                      }}
                      placeholder="Max sqft"
                      className="h-6 w-24 rounded-lg border-[var(--anna-border)] text-xs font-data"
                    />
                    <span className="text-[10px] text-[var(--anna-muted)]">×</span>
                    <Input
                      type="number"
                      step="0.1"
                      value={tier.multiplier}
                      onChange={(e) => {
                        const tiers = [...(rules.areaMultiplier?.tiers ?? [])];
                        tiers[idx] = { ...tiers[idx], multiplier: parseFloat(e.target.value) || 0 };
                        update({
                          areaMultiplier: {
                            field: rules.areaMultiplier?.field ?? "",
                            tiers,
                          },
                        });
                      }}
                      placeholder="×1.0"
                      className="h-6 w-20 rounded-lg border-[var(--anna-border)] text-xs font-data"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const tiers = (rules.areaMultiplier?.tiers ?? []).filter(
                          (_, i) => i !== idx
                        );
                        update({
                          areaMultiplier: {
                            field: rules.areaMultiplier?.field ?? "",
                            tiers,
                          },
                        });
                        if (tiers.length === 0) setAreaOpen(false);
                      }}
                      className="h-6 w-6 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const tiers = [...(rules.areaMultiplier?.tiers ?? []), { maxSqft: 0, multiplier: 1.0 }];
                    update({
                      areaMultiplier: {
                        field: rules.areaMultiplier?.field ?? "",
                        tiers,
                      },
                    });
                  }}
                  className="h-6 text-[10px] text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)]/50"
                >
                  <Plus size={12} className="mr-1" />
                  Add Tier
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Surcharges section (collapsible) ── */}
      <div className="rounded-lg border border-[var(--anna-border)] bg-[var(--anna-bg)]">
        <button
          type="button"
          onClick={() => setSurchargesOpen(!surchargesOpen)}
          className="flex items-center justify-between w-full px-3 py-2 text-left"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
            Surcharges
            {rules.surcharges && rules.surcharges.length > 0 && (
              <Badge
                variant="secondary"
                className="ml-2 text-[8px] bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
              >
                {rules.surcharges.length}
              </Badge>
            )}
          </span>
          {surchargesOpen ? (
            <ChevronUp size={14} className="text-[var(--anna-muted)]" />
          ) : (
            <ChevronDown size={14} className="text-[var(--anna-muted)]" />
          )}
        </button>

        {surchargesOpen && (
          <div className="px-3 pb-3 space-y-1.5">
            {rules.surcharges?.map((surcharge, idx) => (
              <div
                key={idx}
                className="flex flex-wrap items-center gap-2"
              >
                <Input
                  value={surcharge.label}
                  onChange={(e) => {
                    const surcharges = [...(rules.surcharges ?? [])];
                    surcharges[idx] = {
                      ...surcharges[idx],
                      label: e.target.value,
                      key: slugify(e.target.value),
                    };
                    update({ surcharges });
                  }}
                  placeholder="Label"
                  className="h-6 w-28 rounded-lg border-[var(--anna-border)] text-xs"
                />
                <div className="flex items-center gap-0.5">
                  <span className="text-[10px] text-[var(--anna-muted)]">$</span>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={surcharge.amountCents / 100}
                    onChange={(e) => {
                      const surcharges = [...(rules.surcharges ?? [])];
                      surcharges[idx] = {
                        ...surcharges[idx],
                        amountCents: Math.round(
                          (parseFloat(e.target.value) || 0) * 100
                        ),
                      };
                      update({ surcharges });
                    }}
                    placeholder="0"
                    className="h-6 w-16 rounded-lg border-[var(--anna-border)] text-xs font-data"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-[var(--anna-muted)]">Per unit</span>
                  <Switch
                    checked={surcharge.perUnit ?? false}
                    onCheckedChange={(checked) => {
                      const surcharges = [...(rules.surcharges ?? [])];
                      surcharges[idx] = { ...surcharges[idx], perUnit: checked };
                      update({ surcharges });
                    }}
                    className="scale-75"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const surcharges = (rules.surcharges ?? []).filter(
                      (_, i) => i !== idx
                    );
                    update({ surcharges });
                    if (surcharges.length === 0) setSurchargesOpen(false);
                  }}
                  className="h-6 w-6 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={12} />
                </Button>
              </div>
            ))}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const surcharges = [
                  ...(rules.surcharges ?? []),
                  { key: "", label: "", amountCents: 0, perUnit: false },
                ];
                update({ surcharges });
              }}
              className="h-6 text-[10px] text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)]/50"
            >
              <Plus size={12} className="mr-1" />
              Add Surcharge
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
