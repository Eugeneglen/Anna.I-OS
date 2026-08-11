"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatSgd, formatDateTime } from "@/lib/ops-format";
import { ESCROW_STYLES } from "./escrow-kpi-card";

// ============================================================
// Anna.I — Ops Escrow Ledger Mobile Cards
// ============================================================
// The `md:hidden` card view shown on mobile.
// ============================================================

interface EscrowLedgerMobileListProps {
  entries: Record<string, unknown>[];
}

export function EscrowLedgerMobileList({ entries }: EscrowLedgerMobileListProps) {
  return (
    <div className="md:hidden space-y-2">
      {entries.map((e: Record<string, unknown>) => {
        const t = e.task as Record<string, unknown>;
        const household = t?.household as Record<string, unknown>;
        const vendor = (e.booking as Record<string, unknown>)?.vendor as Record<string, unknown> | undefined;
        const stateStyle = ESCROW_STYLES[e.state as string] || ESCROW_STYLES.HELD;

        return (
          <div key={e.id as string} className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--anna-slate)] truncate">
                  {household?.name as string}
                </p>
                <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">
                  {vendor?.name as string || "No vendor"}
                </p>
              </div>
              <Badge variant="secondary" className={cn("text-[10px] shrink-0 ml-2", stateStyle.bg, stateStyle.text)}>
                {(e.state as string)?.replace(/_/g, " ")}
              </Badge>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                {(t?.category as string)?.replace(/_/g, " ")}
              </span>
              <span className="font-data text-xs text-[var(--anna-slate)]">{formatSgd(e.amountCents as number)}</span>
              <span className="font-data text-[10px] text-[var(--anna-muted)]">
                → {formatSgd(e.vendorPayoutCents as number)} payout
              </span>
            </div>
            <p className="text-[10px] text-[var(--anna-muted)] mt-2 font-data">
              {formatDateTime(e.createdAt as string)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
