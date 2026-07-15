"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatSgd, type ServiceJobType, type QuotationBreakdownItem } from "@/lib/types";
import { calculateQuote, type QuoteResult } from "@/lib/quote-calculator";
import {
  Calculator,
  SlidersHorizontal,
  PlusCircle,
  PencilLine,
  RotateCcw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface QuoteBuilderProps {
  jobType: ServiceJobType;
  onQuoteChange: (result: QuoteResult | null, fieldValues: Record<string, number>, selectedAddOns: string[]) => void;
}

// ─────────────────────────────────────────────────────────────
// Dynamic Field Renderer
// ─────────────────────────────────────────────────────────────

function DynamicField({
  field,
  value,
  onChange,
}: {
  field: ServiceJobType["requiredFields"][number];
  value: number;
  onChange: (key: string, value: number) => void;
}) {
  if (field.type === "select" && field.options) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-[var(--anna-slate)]">
          {field.label}
        </Label>
        <div className="grid grid-cols-2 gap-2">
          {field.options.map((opt) => (
            <button
              key={opt.label}
              onClick={() => onChange(field.key, opt.value)}
              className={cn(
                "px-3 py-2 rounded-xl border text-xs font-medium transition-all text-left",
                value === opt.value
                  ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/50 text-[var(--anna-sage-dark)]"
                  : "border-[var(--anna-border)] bg-[var(--anna-white)] text-[var(--anna-slate)] hover:border-[var(--anna-sage)]/40"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Number type
  const min = field.min ?? 1;
  const max = field.max ?? 99;
  const defaultVal = field.defaultValue ?? min;

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-[var(--anna-slate)]">
        {field.label}
      </Label>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(field.key, Math.max(min, value - 1))}
          disabled={value <= min}
          className="w-8 h-8 rounded-lg border border-[var(--anna-border)] bg-[var(--anna-white)] flex items-center justify-center text-sm text-[var(--anna-slate)] hover:border-[var(--anna-sage)]/40 disabled:opacity-30 transition-colors"
        >
          −
        </button>
        <div className="flex-1 text-center">
          <span className="font-data text-lg font-bold text-[var(--anna-slate)]">
            {value}
          </span>
        </div>
        <button
          onClick={() => onChange(field.key, Math.min(max, value + 1))}
          disabled={value >= max}
          className="w-8 h-8 rounded-lg border border-[var(--anna-border)] bg-[var(--anna-white)] flex items-center justify-center text-sm text-[var(--anna-slate)] hover:border-[var(--anna-sage)]/40 disabled:opacity-30 transition-colors"
        >
          +
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────

export function QuoteBuilder({ jobType, onQuoteChange }: QuoteBuilderProps) {
  // Initialize field values from defaults
  const [fieldValues, setFieldValues] = useState<Record<string, number>>(() => {
    const defaults: Record<string, number> = {};
    for (const f of jobType.requiredFields) {
      if (f.type === "select" && f.options && f.options.length > 0) {
        defaults[f.key] = f.options[0].value;
      } else {
        defaults[f.key] = f.defaultValue ?? f.min ?? 1;
      }
    }
    return defaults;
  });

  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [useCustomAmount, setUseCustomAmount] = useState(false);
  const [customCents, setCustomCents] = useState(0);

  // Update field value
  const handleFieldChange = useCallback((key: string, value: number) => {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Toggle add-on
  const toggleAddOn = useCallback((key: string) => {
    setSelectedAddOns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }, []);

  // Calculate quote live
  const quoteResult = useMemo(() => {
    return calculateQuote(
      jobType.basePriceCents,
      jobType.pricingRules,
      jobType.requiredFields,
      jobType.addOns,
      fieldValues,
      selectedAddOns
    );
  }, [jobType, fieldValues, selectedAddOns]);

  // Notify parent of quote changes
  useEffect(() => {
    onQuoteChange(quoteResult, fieldValues, selectedAddOns);
  }, [quoteResult, fieldValues, selectedAddOns, onQuoteChange]);

  const displayCents = useCustomAmount ? customCents : quoteResult.totalCents;

  return (
    <div className="space-y-5 anna-fade-in">
      {/* Dynamic Fields */}
      {jobType.requiredFields.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
            <SlidersHorizontal size={12} className="inline mr-1" />
            Details
          </h4>
          <div className="bg-[var(--anna-white)] rounded-2xl p-4 border border-[var(--anna-border)] space-y-4">
            {jobType.requiredFields.map((field) => (
              <DynamicField
                key={field.key}
                field={field}
                value={fieldValues[field.key] ?? 0}
                onChange={handleFieldChange}
              />
            ))}
          </div>
        </div>
      )}

      {/* Add-ons */}
      {jobType.addOns.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
            <PlusCircle size={12} className="inline mr-1" />
            Add-ons
          </h4>
          <div className="bg-[var(--anna-white)] rounded-2xl p-4 border border-[var(--anna-border)] space-y-2">
            {jobType.addOns.map((addon) => {
              const isChecked = selectedAddOns.includes(addon.key);
              const unitLabel =
                addon.pricingType === "per_unit"
                  ? `/unit`
                  : addon.pricingType === "per_room"
                    ? "/room"
                    : addon.pricingType === "per_item"
                      ? "/item"
                      : "";
              return (
                <label
                  key={addon.key}
                  className={cn(
                    "flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all",
                    isChecked
                      ? "bg-[var(--anna-sage-light)]/50"
                      : "hover:bg-[var(--anna-bg)]"
                  )}
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggleAddOn(addon.key)}
                    className="data-[state=checked]:bg-[var(--anna-sage)] data-[state=checked]:border-[var(--anna-sage)]"
                  />
                  <span className="flex-1 text-sm text-[var(--anna-slate)]">
                    {addon.label}
                  </span>
                  <span className="font-data text-xs font-medium text-[var(--anna-muted)]">
                    +{formatSgd(addon.priceCents)}
                    {unitLabel && (
                      <span className="text-[10px]">{unitLabel}</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Live Quote Card */}
      <div className="bg-[var(--anna-sage-light)]/40 rounded-2xl border border-[var(--anna-sage)]/20 overflow-hidden">
        {/* Quote header */}
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calculator size={14} className="text-[var(--anna-sage-dark)]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-sage-dark)]">
              Quoted Price
            </span>
          </div>
          {quoteResult.breakdown.length > 1 && (
            <button
              onClick={() => setShowBreakdown(!showBreakdown)}
              className="text-[10px] text-[var(--anna-sage-dark)] hover:underline flex items-center gap-0.5"
            >
              {showBreakdown ? "Hide" : "Details"}
              {showBreakdown ? (
                <ChevronUp size={10} />
              ) : (
                <ChevronDown size={10} />
              )}
            </button>
          )}
        </div>

        {/* Total amount */}
        <div className="px-4 pb-3">
          {useCustomAmount ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--anna-muted)]">SGD $</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={(customCents / 100).toFixed(2)}
                onChange={(e) =>
                  setCustomCents(Math.round(parseFloat(e.target.value) * 100))
                }
                className="flex-1 bg-white/60 border border-[var(--anna-sage)]/30 rounded-lg px-3 py-1.5 font-data text-2xl font-bold text-[var(--anna-sage-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--anna-sage)]/30"
              />
            </div>
          ) : (
            <div className="font-data text-2xl font-bold text-[var(--anna-sage-dark)]">
              {formatSgd(displayCents)}
            </div>
          )}
        </div>

        {/* Breakdown */}
        {showBreakdown && quoteResult.breakdown.length > 0 && (
          <div className="px-4 pb-3">
            <Separator className="bg-[var(--anna-sage)]/20 mb-3" />
            <div className="space-y-1.5">
              {quoteResult.breakdown.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="text-[var(--anna-slate-light)]">
                    {item.label}
                  </span>
                  <span className="font-data text-[var(--anna-slate)]">
                    {formatSgd(item.amountCents)}
                  </span>
                </div>
              ))}
              {quoteResult.addOnsCents > 0 && (
                <>
                  <Separator className="bg-[var(--anna-sage)]/10 my-1.5" />
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="text-[var(--anna-slate)]">Add-ons</span>
                    <span className="font-data text-[var(--anna-sage-dark)]">
                      {formatSgd(quoteResult.addOnsCents)}
                    </span>
                  </div>
                </>
              )}
              <Separator className="bg-[var(--anna-sage)]/20 my-1.5" />
              <div className="flex items-center justify-between text-sm font-bold">
                <span className="text-[var(--anna-slate)]">Total</span>
                <span className="font-data text-[var(--anna-sage-dark)]">
                  {formatSgd(quoteResult.totalCents)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Custom amount toggle */}
        <div className="border-t border-[var(--anna-sage)]/15 px-4 py-2.5">
          <button
            onClick={() => {
              if (useCustomAmount) {
                setUseCustomAmount(false);
              } else {
                setCustomCents(quoteResult.totalCents);
                setUseCustomAmount(true);
              }
            }}
            className="text-[10px] text-[var(--anna-muted)] hover:text-[var(--anna-slate)] transition-colors flex items-center gap-1"
          >
            {useCustomAmount ? (
              <>
                <RotateCcw size={10} />
                Reset to quoted price
              </>
            ) : (
              <>
                <PencilLine size={10} />
                Enter custom amount
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}