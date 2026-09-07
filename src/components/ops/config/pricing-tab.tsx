"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Info, TrendingUp, ChevronRight } from "lucide-react";
import { formatSgd } from "@/lib/ops-format";

/**
 * Ops Pricing tab (FIX-1c pricing authority consolidation).
 *
 * Anna.I Ops is the sole pricing authority. Selling prices are defined per
 * Service Job Type (edited in the Job Types tab — basePriceCents /
 * pricingRules / addOns) and this tab is a READ-ONLY derived view of those
 * prices. The former category_price_* PlatformConfig editor was retired:
 * it was display-only, never touched the charge path, and diverged from the
 * real job-type prices (audit conflict: category_price_CARE 2000 vs
 * job-type 6800). The commission_rate editor below is the Ops MARGIN lever
 * (single source of truth for the platform cut, read by the escrow
 * creation path via getCommissionRate()).
 */

interface CategoryPriceView {
  category: string;
  label: string;
  isActive: boolean;
  activeJobTypes: number;
  totalJobTypes: number;
  minPriceCents: number;
  maxPriceCents: number;
  avgPriceCents: number;
}

interface PricingTabProps {
  /** Read-only per-category view derived from ServiceJobType (server-side). */
  categoryPricing: CategoryPriceView[];
  /** Effective commission rate (from getCommissionRate — same value the escrow math uses). */
  effectiveCommission: number;
  commissionState: number;
  blendedJobValueCents: number;
  isAdmin: boolean;
  isPending: boolean;
  onSaveCommission: () => void;
  onCommissionChange: (value: number) => void;
}

export function PricingTab({
  categoryPricing,
  effectiveCommission,
  commissionState,
  blendedJobValueCents,
  isAdmin,
  isPending,
  onSaveCommission,
  onCommissionChange,
}: PricingTabProps) {
  const avgVendorPayout = Math.round(
    (blendedJobValueCents * (100 - commissionState)) / 100
  );

  return (
    <div className="mt-4 space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-gradient-to-br from-[var(--anna-sage-light)] to-[var(--anna-bg)] rounded-2xl p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Blended Job Value</p>
          <p className="text-xl font-bold font-data text-[var(--anna-slate)] mt-1">
            {formatSgd(blendedJobValueCents)}
          </p>
          <p className="text-[10px] text-emerald-600 mt-0.5 flex items-center gap-1">
            <TrendingUp size={10} /> Avg of job-type prices
          </p>
        </div>
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Commission Rate</p>
          <p className="text-xl font-bold font-data text-[var(--anna-slate)] mt-1">
            {commissionState}%
          </p>
          <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">Platform margin per job</p>
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
            {formatSgd(avgVendorPayout)}
          </p>
          <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">After commission</p>
        </div>
      </div>

      {/* Category Prices — read-only view derived from ServiceJobType */}
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--anna-border)] flex items-center justify-between">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Category Base Prices</h3>
            <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">
              Read-only — derived from active Service Job Types. Edit prices per job type in the Job Types tab.
            </p>
          </div>
        </div>
        <div className="max-h-[28rem] overflow-y-auto anna-scroll divide-y divide-[var(--anna-border)]">
          {categoryPricing.map((c) => {
            const priceRange =
              c.minPriceCents === c.maxPriceCents
                ? formatSgd(c.avgPriceCents)
                : `${formatSgd(c.minPriceCents)} – ${formatSgd(c.maxPriceCents)}`;
            const vendorPayout = Math.round((c.avgPriceCents * (100 - commissionState)) / 100);
            return (
              <div
                key={c.category}
                className={cn(
                  "w-full flex items-center justify-between px-5 py-3",
                  !c.isActive && "opacity-50"
                )}
              >
                <div className="flex items-center gap-2">
                  <ChevronRight size={14} className="text-[var(--anna-muted)]" />
                  <span className="font-medium text-xs text-[var(--anna-slate)]">{c.label}</span>
                  {c.activeJobTypes === 0 && (
                    <Badge variant="secondary" className="text-[8px] bg-[var(--anna-bg)] text-[var(--anna-muted)]">
                      No active job types
                    </Badge>
                  )}
                  {!c.isActive && (
                    <Badge variant="secondary" className="text-[8px] bg-[var(--anna-bg)] text-[var(--anna-muted)]">
                      Inactive
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[10px] text-[var(--anna-muted)] hidden sm:inline">
                    {c.activeJobTypes}/{c.totalJobTypes} job types
                  </span>
                  <span className="font-data text-xs text-[var(--anna-slate)] w-32 text-right">{priceRange}</span>
                  <span className="font-data text-xs text-emerald-700 w-24 text-right hidden sm:inline">
                    {formatSgd(vendorPayout)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Commission Rate Editor (the Ops margin lever) */}
      {isAdmin && (
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Platform Commission Rate</h3>
              <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">
                Applied to all new escrows at booking accept and add-on approval. Vendor payout = price × (1 − commission).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={100}
                value={commissionState}
                onChange={(e) => onCommissionChange(parseInt(e.target.value) || 0)}
                className={cn(
                  "w-16 h-8 text-center text-sm font-data rounded-lg border-[var(--anna-border)]",
                  commissionState !== effectiveCommission ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/30" : ""
                )}
              />
              <span className="text-sm text-[var(--anna-muted)]">%</span>
              <Button
                onClick={onSaveCommission}
                disabled={isPending || commissionState === effectiveCommission}
                size="sm"
                className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl text-xs font-semibold h-8"
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Info note */}
      <div className="flex items-start gap-2.5 rounded-2xl border border-[var(--anna-border)] bg-[var(--anna-bg)] p-4 text-xs text-[var(--anna-muted)]">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p>
            <span className="font-semibold text-[var(--anna-slate)]">Pricing authority:</span> selling prices are defined
            per Service Job Type (Job Types tab) — this view is read-only and always mirrors the live charge path. The
            commission rate above is the platform margin lever and takes effect on newly created escrows.
          </p>
          <p className="mt-1">
            Financial model baseline: SGD $68.00. Current live blended value:{" "}
            <span className="font-data font-semibold text-[var(--anna-sage-dark)]">{formatSgd(blendedJobValueCents)}</span>
            {blendedJobValueCents !== 6800 && (
              <span className={blendedJobValueCents > 6800 ? " text-emerald-600" : " text-amber-600"}>
                {" "}({blendedJobValueCents > 6800 ? "+" : ""}
                {((blendedJobValueCents - 6800) / 100).toFixed(2)} vs baseline)
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
