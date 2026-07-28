"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { Save, Info, TrendingUp, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { formatSgd } from "@/lib/ops-format";

interface PricingTabProps {
  categoryPricing: Record<string, unknown>[];
  priceState: Record<string, number>;
  commissionState: number;
  liveBlended: number;
  hasPriceChanges: boolean;
  isEditing: boolean;
  isAdmin: boolean;
  effectiveCommission: number;
  isPending: boolean;
  onSave: () => void;
  onSaveCommission: () => void;
  onReset: () => void;
  onPriceChange: (category: string, cents: number) => void;
  onCommissionChange: (value: number) => void;
}

export function PricingTab({
  categoryPricing,
  priceState,
  commissionState,
  liveBlended,
  hasPriceChanges,
  isEditing,
  isAdmin,
  effectiveCommission,
  isPending,
  onSave,
  onSaveCommission,
  onReset,
  onPriceChange,
  onCommissionChange,
}: PricingTabProps) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    categoryPricing.forEach((p, i) => {
      initial[p.category as string] = i === 0;
    });
    return initial;
  });

  const toggleSection = (category: string) => {
    setOpenSections((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  return (
    <div className="mt-4 space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-[var(--anna-sage-light)] to-[var(--anna-bg)] rounded-2xl p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Blended Job Value</p>
          <p className="text-xl font-bold font-data text-[var(--anna-slate)] mt-1">
            {formatSgd(liveBlended)}
          </p>
          <p className="text-[10px] text-emerald-600 mt-0.5 flex items-center gap-1">
            <TrendingUp size={10} /> Live average
          </p>
        </div>
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Commission Rate</p>
          <p className="text-xl font-bold font-data text-[var(--anna-slate)] mt-1">
            {commissionState}%
          </p>
          <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">Platform cut per job</p>
        </div>
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Active Categories</p>
          <p className="text-xl font-bold font-data text-[var(--anna-slate)] mt-1">
            {categoryPricing.filter((c) => c.isActive).length}
          </p>
          <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">Of {categoryPricing.length} total</p>
        </div>
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Avg Vendor Payout</p>
          <p className="text-xl font-bold font-data text-[var(--anna-slate)] mt-1">
            {formatSgd(Math.round(liveBlended * (100 - commissionState) / 100))}
          </p>
          <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">After commission</p>
        </div>
      </div>

      {/* Category Pricing — Collapsible Sections */}
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--anna-border)] flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Category Base Prices</h3>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <>
                <Button variant="ghost" size="sm" className="h-7 text-[10px] text-[var(--anna-muted)] hover:text-[var(--anna-slate)]" onClick={onReset} disabled={!hasPriceChanges}>
                  <RotateCcw size={12} className="mr-1" /> Reset
                </Button>
                <Button onClick={onSave} disabled={isPending || !hasPriceChanges} size="sm" className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl text-xs font-semibold h-7">
                  <Save className="h-3 w-3 mr-1" /> {isPending ? "Saving..." : "Save"}
                </Button>
              </>
            )}
          </div>
        </div>
        <div className="max-h-[28rem] overflow-y-auto anna-scroll divide-y divide-[var(--anna-border)]">
          {categoryPricing.map((p) => {
            const isCustom = p.isCustom as boolean;
            const isActive = p.isActive as boolean;
            const currentPrice = priceState[p.category as string] || p.activePriceCents;
            const vendorPayout = Math.round(currentPrice * (100 - commissionState) / 100);
            const changed = isEditing && priceState[p.category as string] !== (p.activePriceCents as number);
            const isOpen = openSections[p.category as string] ?? false;

            return (
              <Collapsible
                key={p.category as string}
                open={isOpen}
                onOpenChange={() => toggleSection(p.category as string)}
              >
                <CollapsibleTrigger asChild>
                  <button
                    className={cn(
                      "w-full flex items-center justify-between px-5 py-3 text-left transition-colors",
                      isActive ? "hover:bg-[var(--anna-sage-light)]/30" : "opacity-50"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronUp size={14} className="text-[var(--anna-muted)]" /> : <ChevronDown size={14} className="text-[var(--anna-muted)]" />}
                      <span className="font-medium text-xs text-[var(--anna-slate)]">{p.label as string}</span>
                      {isCustom && <Badge variant="secondary" className="text-[8px] bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">Custom</Badge>}
                      {!isActive && <Badge variant="secondary" className="text-[8px] bg-[var(--anna-bg)] text-[var(--anna-muted)]">Inactive</Badge>}
                    </div>
                    <span className={cn("font-data text-xs", isCustom ? "text-[var(--anna-sage-dark)] font-semibold" : "text-[var(--anna-slate)]")}>
                      {formatSgd(p.activePriceCents as number)}
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-5 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-1">Default</p>
                      <p className="font-data text-xs text-[var(--anna-muted)]">{formatSgd(p.defaultPriceCents as number)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-1">Current Price</p>
                      {isAdmin && isActive ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-[var(--anna-muted)]">SGD $</span>
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            value={Math.round(currentPrice / 100)}
                            onChange={(e) => onPriceChange(p.category as string, Math.round((parseFloat(e.target.value) || 0) * 100))}
                            className={cn(
                              "w-20 h-7 text-right text-xs font-data rounded-lg border-[var(--anna-border)]",
                              changed && "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/30"
                            )}
                          />
                        </div>
                      ) : (
                        <p className={cn("font-data text-xs", isCustom ? "text-[var(--anna-sage-dark)] font-semibold" : "text-[var(--anna-slate)]")}>{formatSgd(p.activePriceCents as number)}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-1">Status</p>
                      {isCustom
                        ? <Badge variant="secondary" className="text-[8px] bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">Custom</Badge>
                        : <Badge variant="secondary" className="text-[8px] bg-[var(--anna-bg)] text-[var(--anna-muted)]">Default</Badge>}
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-1">Vendor Payout</p>
                      <p className="font-data text-xs text-emerald-700">{formatSgd(vendorPayout)}</p>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </div>

      {/* Commission Rate Editor */}
      {isAdmin && (
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Platform Commission Rate</h3>
              <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">Applied to all job types. Vendor payout = price × (1 - commission)</p>
            </div>
            <div className="flex items-center gap-2">
              <Input type="number" min={0} max={100} value={commissionState} onChange={(e) => onCommissionChange(parseInt(e.target.value) || 0)} className={cn("w-16 h-8 text-center text-sm font-data rounded-lg border-[var(--anna-border)]", commissionState !== effectiveCommission ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/30" : "")} />
              <span className="text-sm text-[var(--anna-muted)]">%</span>
              <Button onClick={onSaveCommission} disabled={isPending || commissionState === effectiveCommission} size="sm" className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl text-xs font-semibold h-8">Save</Button>
            </div>
          </div>
        </div>
      )}

      {/* Info note */}
      <div className="flex items-start gap-2.5 rounded-2xl border border-[var(--anna-border)] bg-[var(--anna-bg)] p-4 text-xs text-[var(--anna-muted)]">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p><span className="font-semibold text-[var(--anna-slate)]">Blended Job Value</span> is automatically computed as the average base price across all active categories. Changing category prices recalculates this metric in real-time.</p>
          <p className="mt-1">Financial model baseline: SGD $68.00. Current live value: <span className="font-data font-semibold text-[var(--anna-sage-dark)]">{formatSgd(liveBlended)}</span>{liveBlended !== 6800 && (<span className={liveBlended > 6800 ? " text-emerald-600" : " text-amber-600"}> ({liveBlended > 6800 ? "+" : ""}{((liveBlended - 6800) / 100).toFixed(2)} vs baseline)</span>)}</p>
        </div>
      </div>
    </div>
  );
}
