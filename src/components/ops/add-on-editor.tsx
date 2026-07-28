"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type PricingType = "flat" | "per_unit" | "per_room" | "per_item";

interface AddOn {
  key: string;
  label: string;
  priceCents: number;
  pricingType: PricingType;
  unitField?: string;
}

interface AddOnEditorProps {
  addOns: AddOn[];
  onChange: (updated: AddOn[]) => void;
}

const PRICING_TYPE_OPTIONS: { value: PricingType; label: string }[] = [
  { value: "flat", label: "Flat" },
  { value: "per_unit", label: "Per Unit" },
  { value: "per_room", label: "Per Room" },
  { value: "per_item", label: "Per Item" },
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function centsToDollars(cents: number): string {
  if (cents === 0) return "";
  return (cents / 100).toFixed(2);
}

function dollarsToCents(value: string): number {
  const parsed = parseFloat(value);
  if (isNaN(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

function createEmptyAddOn(): AddOn {
  return {
    key: "",
    label: "",
    priceCents: 0,
    pricingType: "flat",
  };
}

export function AddOnEditor({ addOns: incomingAddOns, onChange }: AddOnEditorProps) {
  // Defensive: ensure addOns is always an array
  const addOns = Array.isArray(incomingAddOns) ? incomingAddOns : [];

  const handleAdd = () => {
    onChange([...addOns, createEmptyAddOn()]);
  };

  const handleRemove = (index: number) => {
    const updated = addOns.filter((_, i) => i !== index);
    onChange(updated);
  };

  const handleFieldChange = (
    index: number,
    field: keyof AddOn,
    value: string | number,
  ) => {
    const updated = addOns.map((item, i) => {
      if (i !== index) return item;

      const next = { ...item, [field]: value };

      // Auto-generate key from label
      if (field === "label" && typeof value === "string") {
        next.key = slugify(value);
      }

      return next;
    });
    onChange(updated);
  };

  return (
    <div className="space-y-2">
      {/* ── Column Headers ──────────────────────────────── */}
      <div className="grid grid-cols-[1fr_100px_110px_90px_28px] sm:grid-cols-[1fr_100px_120px_100px_28px] gap-1.5 items-center px-0.5">
        <span
          className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]"
        >
          Label
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]"
        >
          Price (SGD)
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]"
        >
          Pricing Type
        </span>
        <span
          className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]"
        >
          Unit Field
        </span>
        <span className="w-7" />
      </div>

      {/* ── Add-on Rows ─────────────────────────────────── */}
      {addOns.length === 0 && (
        <div className="py-6 text-center text-xs text-[var(--anna-muted)] border border-dashed border-[var(--anna-border)] rounded-lg">
          No add-ons configured yet.
        </div>
      )}

      {addOns.map((addOn, index) => {
        const showUnitField =
          addOn.pricingType === "per_unit" ||
          addOn.pricingType === "per_room" ||
          addOn.pricingType === "per_item";

        return (
          <div
            key={`${addOn.key || `new-${index}`}`}
            className="group rounded-lg border border-[var(--anna-border)] bg-[var(--anna-bg)] p-2"
          >
            <div className="grid grid-cols-[1fr_100px_110px_90px_28px] sm:grid-cols-[1fr_100px_120px_100px_28px] gap-1.5 items-center">
              {/* Label */}
              <Input
                value={addOn.label}
                onChange={(e) =>
                  handleFieldChange(index, "label", e.target.value)
                }
                placeholder="e.g. Carpet Steam Clean"
                className="h-7 rounded-md border-[var(--anna-border)] bg-[var(--anna-white)] text-[11px] text-[var(--anna-slate)] px-2"
              />

              {/* Price (dollars display, cents storage) */}
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--anna-muted)] pointer-events-none">
                  $
                </span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={centsToDollars(addOn.priceCents)}
                  onChange={(e) =>
                    handleFieldChange(
                      index,
                      "priceCents",
                      dollarsToCents(e.target.value),
                    )
                  }
                  placeholder="0.00"
                  className="h-7 rounded-md border-[var(--anna-border)] bg-[var(--anna-white)] text-[11px] text-[var(--anna-slate)] pl-5 pr-1.5"
                />
              </div>

              {/* Pricing Type */}
              <select
                value={addOn.pricingType}
                onChange={(e) =>
                  handleFieldChange(index, "pricingType", e.target.value)
                }
                className="h-7 rounded-md border border-[var(--anna-border)] bg-[var(--anna-white)] px-1.5 text-[11px] text-[var(--anna-slate)] focus:outline-none focus:ring-2 focus:ring-[var(--anna-sage-light)]"
              >
                {PRICING_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              {/* Unit Field – only shown for non-flat types */}
              {showUnitField ? (
                <Input
                  value={addOn.unitField ?? ""}
                  onChange={(e) =>
                    handleFieldChange(index, "unitField", e.target.value)
                  }
                  placeholder="e.g. rooms"
                  className="h-7 rounded-md border-[var(--anna-border)] bg-[var(--anna-white)] text-[11px] text-[var(--anna-slate)] px-2"
                />
              ) : (
                <Badge
                  variant="secondary"
                  className="h-7 px-2 rounded-md bg-[var(--anna-slate-light)]/50 text-[10px] text-[var(--anna-muted)] font-normal border-0 justify-center"
                >
                  —
                </Badge>
              )}

              {/* Delete */}
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="h-7 w-7 flex items-center justify-center rounded-md text-[var(--anna-muted)] hover:text-[var(--anna-red)] hover:bg-red-50 transition-colors"
                aria-label={`Remove add-on ${addOn.label || index + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Auto-generated key preview */}
            {addOn.key && (
              <div className="mt-1.5 ml-0.5">
                <span className="text-[9px] font-mono text-[var(--anna-muted)]">
                  key: {addOn.key}
                </span>
              </div>
            )}
          </div>
        );
      })}

      {/* ── Add Button ──────────────────────────────────── */}
      <Button
        type="button"
        variant="ghost"
        onClick={handleAdd}
        className="mt-1 h-7 text-[11px] text-[var(--anna-sage-dark)] hover:text-[var(--anna-sage)] hover:bg-[var(--anna-sage-light)]/20 font-medium gap-1"
      >
        <Plus className="h-3.5 w-3.5" />
        Add Add-on
      </Button>
    </div>
  );
}
