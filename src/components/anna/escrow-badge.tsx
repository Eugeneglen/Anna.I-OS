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

interface EscrowBadgeProps {
  state: EscrowState;
  amountCents?: number;
  commissionCents?: number;
  vendorPayoutCents?: number;
  showBreakdown?: boolean;
}

export function EscrowBadge({
  state,
  amountCents,
  commissionCents,
  vendorPayoutCents,
  showBreakdown = false,
}: EscrowBadgeProps) {
  const config = stateConfig[state];
  const Icon = config.icon;

  return (
    <div className="space-y-2">
      <Badge
        variant="outline"
        className={`gap-1.5 px-3 py-1 text-xs font-medium ${config.className}`}
      >
        <Icon size={12} />
        {config.label}
      </Badge>
      {showBreakdown && amountCents !== undefined && (
        <div className="space-y-1 pl-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--anna-muted)]">Amount</span>
            <span className="font-data font-medium">
              {formatSgd(amountCents)}
            </span>
          </div>
          {commissionCents !== undefined && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--anna-muted)]">Commission (10%)</span>
              <span className="font-data font-medium text-[var(--anna-muted)]">
                -{formatSgd(commissionCents)}
              </span>
            </div>
          )}
          {vendorPayoutCents !== undefined && (
            <div className="flex items-center justify-between text-xs border-t border-[var(--anna-border)] pt-1">
              <span className="text-[var(--anna-slate)] font-medium">
                Vendor Payout
              </span>
              <span className="font-data font-semibold text-[var(--anna-success)]">
                {formatSgd(vendorPayoutCents)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}