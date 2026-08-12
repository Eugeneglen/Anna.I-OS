"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatSgd, formatDateTime } from "@/lib/ops-format";
import { ESCROW_STYLES } from "./escrow-kpi-card";

// ============================================================
// Anna.I — Ops Escrow Ledger Desktop Table
// ============================================================
// The `hidden md:block` table view shown on tablet/desktop.
// ============================================================

interface EscrowLedgerTableProps {
  entries: Record<string, unknown>[];
}

export function EscrowLedgerTable({ entries }: EscrowLedgerTableProps) {
  return (
    <div className="hidden md:block bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)]">
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Household</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Category</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Vendor</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Amount</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Commission</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Payout</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">State</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Created</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e: Record<string, unknown>) => {
            const t = e.task as Record<string, unknown>;
            const household = t?.household as Record<string, unknown>;
            const vendor = (e.booking as Record<string, unknown>)?.vendor as Record<string, unknown> | undefined;
            const stateStyle = ESCROW_STYLES[e.state as string] || ESCROW_STYLES.HELD;

            return (
              <tr key={e.id as string} className={cn(
                "border-b border-[var(--anna-border)] last:border-0 transition-colors",
                e.state === "DISPUTED" ? "hover:bg-red-50/30" : "hover:bg-[var(--anna-sage-light)]/20"
              )}>
                <td className="px-4 py-3">
                  <p className="font-medium text-[var(--anna-slate)]">{(household?.name as string) || "—"}</p>
                </td>
                <td className="px-4 py-3">
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                    {(t?.category as string)?.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--anna-slate-light)]">
                  {vendor?.name as string || "—"}
                </td>
                <td className="px-4 py-3 font-data text-xs text-[var(--anna-slate)]">
                  {formatSgd(e.amountCents as number)}
                </td>
                <td className="px-4 py-3 font-data text-xs text-[var(--anna-muted)]">
                  {formatSgd(e.commissionCents as number)}
                </td>
                <td className="px-4 py-3 font-data text-xs text-[var(--anna-slate)]">
                  {formatSgd(e.vendorPayoutCents as number)}
                </td>
                <td className="px-4 py-3">
                  <Badge variant="secondary" className={cn("text-[10px]", stateStyle.bg, stateStyle.text)}>
                    {(e.state as string)?.replace(/_/g, " ")}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-xs text-[var(--anna-muted)] font-data">
                  {formatDateTime(e.createdAt as string)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
