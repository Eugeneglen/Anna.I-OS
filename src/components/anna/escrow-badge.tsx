"use client";

import { Badge } from "@/components/ui/badge";
import type { EscrowState } from "@/lib/types";
import { formatSgd } from "@/lib/types";
import { ShieldCheck, AlertTriangle, Clock, RotateCcw } from "lucide-react";

const stateConfig: Record<
  EscrowState,
  { label: string; className: string; icon: React.ElementType }
> = {
  HELD: {
    label: "Held",
    className:
      "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)] border-[var(--anna-warning)]/20",
    icon: Clock,
  },
  RELEASED: {
    label: "Released",
    className:
      "bg-[var(--anna-success)]/15 text-[var(--anna-success)] border-[var(--anna-success)]/20",
    icon: ShieldCheck,
  },
  DISPUTED: {
    label: "Disputed",
    className:
      "bg-[var(--anna-error)]/15 text-[var(--anna-error)] border-[var(--anna-error)]/20",
    icon: AlertTriangle,
  },
  REFUNDED: {
    label: "Refunded",
    className:
      "bg-[var(--anna-muted)]/15 text-[var(--anna-muted)] border-[var(--anna-muted)]/20",
    icon: RotateCcw,
  },
};

interface EscrowEntryInfo {
  amountCents: number;
  originalAmountCents?: number;
  discountCents?: number;
  refundCents?: number;
  commissionCents?: number;
  vendorPayoutCents?: number;
}

interface EscrowBadgeProps {
  state: EscrowState;
  /** Legacy: single entry amount (used when only one escrow entry exists). */
  amountCents?: number;
  /** All escrow entries for this task (base + add-ons). When provided,
   *  the badge shows the order total (sum of all entries) instead of
   *  just the first entry's amount. */
  entries?: EscrowEntryInfo[];
  showBreakdown?: boolean;
}

export function EscrowBadge({
  state,
  amountCents,
  entries,
  showBreakdown = false,
}: EscrowBadgeProps) {
  const config = stateConfig[state];
  const Icon = config.icon;

  // Compute order total from ALL entries (base + add-ons), or fall back
  // to the single amountCents prop for backward compatibility.
  const orderTotalCents = entries && entries.length > 0
    ? entries.reduce((sum, e) => sum + e.amountCents, 0)
    : amountCents ?? 0;

  // Cumulative refund across all entries
  const totalRefundCents = entries && entries.length > 0
    ? entries.reduce((sum, e) => sum + (e.refundCents || 0), 0)
    : 0;

  // Sum commission + vendor payout across ALL entries so the household
  // view matches the vendor + OPS views exactly.
  const totalCommissionCents = entries && entries.length > 0
    ? entries.reduce((sum, e) => sum + (e.commissionCents || 0), 0)
    : 0;
  const totalVendorPayoutCents = entries && entries.length > 0
    ? entries.reduce((sum, e) => sum + (e.vendorPayoutCents || 0), 0)
    : 0;

  // Marketing discount totals (base entry carries the discount; addons = 0)
  const totalDiscountCents = entries && entries.length > 0
    ? entries.reduce((sum, e) => sum + (e.discountCents || 0), 0)
    : 0;
  const totalOriginalCents = entries && entries.length > 0
    ? entries.reduce((sum, e) => sum + (e.originalAmountCents || 0), 0)
    : 0;
  const hasDiscount = totalDiscountCents > 0 && totalOriginalCents > 0;

  const remainingCents = orderTotalCents - totalRefundCents;
  const hasMultipleEntries = entries && entries.length > 1;
  const hasRefund = totalRefundCents > 0;
  const isReleased = state === "RELEASED";
  const isRefunded = state === "REFUNDED";

  return (
    <div className="space-y-2">
      <Badge
        variant="outline"
        className={`gap-1.5 px-3 py-1 text-xs font-medium ${config.className}`}
      >
        <Icon size={12} />
        {config.label}
      </Badge>
      {showBreakdown && orderTotalCents > 0 && (
        <div className="space-y-1 pl-1">
          {/* Order Total — the authoritative figure all parties see */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--anna-muted)] font-medium">
              {hasMultipleEntries ? "Order Total" : "Amount"}
            </span>
            <span className="font-data font-bold text-[var(--anna-slate)]">
              {formatSgd(orderTotalCents)}
            </span>
          </div>

          {/* Discount breakdown (when a marketing promo/voucher was applied) */}
          {hasDiscount && (
            <div className="space-y-0.5 pl-2 border-l border-[var(--anna-border)] ml-1">
              <div className="flex items-center justify-between text-[10px] text-[var(--anna-muted)]">
                <span>Original Amount</span>
                <span className="font-data line-through">{formatSgd(totalOriginalCents)}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-emerald-600">
                <span>Promo Discount</span>
                <span className="font-data">−{formatSgd(totalDiscountCents)}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-[var(--anna-slate-light)] font-medium">
                <span>Held Amount</span>
                <span className="font-data">{formatSgd(orderTotalCents)}</span>
              </div>
            </div>
          )}

          {/* Per-entry breakdown when there are multiple (base + add-ons) */}
          {hasMultipleEntries && entries && !hasDiscount && (
            <div className="space-y-0.5 pl-2 border-l border-[var(--anna-border)] ml-1">
              {entries.map((e, i) => (
                <div key={i} className="flex items-center justify-between text-[10px] text-[var(--anna-muted)]">
                  <span>{i === 0 ? "Base service" : `Add-on ${i}`}</span>
                  <span className="font-data">{formatSgd(e.amountCents)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Commission + payout breakdown (summed across all entries)
              NOTE: Commission and vendor payout are INTERNAL financial details
              (platform + vendor only). They must NOT be shown to the household.
              The household sees: Order Total, Refund (if any), and the final
              amount paid/remaining — which is orderTotal − refund, NOT the
              vendor's payout (which is after commission deduction). */}

          {/* Refund + bottom row (PAID / Refunded / Remaining Payable)
              For the household, the bottom row shows the ORDER total minus
              refund (what they actually paid), not the vendor payout. */}
          {(hasRefund || isReleased) && (
            <>
              {hasRefund && (
                <div className="flex items-center justify-between text-xs pt-1 border-t border-[var(--anna-border)]">
                  <span className="text-[var(--anna-error)]">Refunded</span>
                  <span className="font-data text-[var(--anna-error)]">
                    −{formatSgd(totalRefundCents)}
                  </span>
                </div>
              )}
              {isReleased ? (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--anna-success)] font-semibold uppercase tracking-wider">
                    Paid
                  </span>
                  <span className="font-data font-bold text-[var(--anna-success)]">
                    {formatSgd(remainingCents)}
                  </span>
                </div>
              ) : isRefunded ? (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--anna-warning)] font-semibold uppercase tracking-wider">
                    Refunded to Household
                  </span>
                  <span className="font-data font-bold text-[var(--anna-warning)]">
                    {formatSgd(remainingCents)}
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--anna-slate)] font-medium">Remaining Payable</span>
                  <span className="font-data font-bold text-[var(--anna-sage-dark)]">
                    {formatSgd(remainingCents)}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
