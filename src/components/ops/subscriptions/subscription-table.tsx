"use client";

import { Badge } from "@/components/ui/badge";
import { ChevronRight, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSgd, formatDate } from "@/lib/ops-format";
import { TIER_STYLES, STATUS_STYLES, type SubItem } from "./subscription-styles";

// ============================================================
// Anna.I — Ops Subscriptions Desktop Table
// ============================================================
// The `hidden md:block` table view shown on tablet/desktop.
// Receives the filtered subscription list and a selection
// handler. Visual output must stay pixel-identical to the
// original page.
// ============================================================

interface SubscriptionTableProps {
  subscriptions: SubItem[];
  onSelect: (id: string) => void;
}

export function SubscriptionTable({
  subscriptions,
  onSelect,
}: SubscriptionTableProps) {
  return (
    <div className="hidden md:block bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)]">
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Household</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Tier</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Status</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Price</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Next Billing</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Tasks</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Total Spend</th>
          </tr>
        </thead>
        <tbody>
          {subscriptions.map((sub) => {
            const tierStyle = TIER_STYLES[sub.tier] || TIER_STYLES.HOME;
            const statusStyle = STATUS_STYLES[sub.status] || STATUS_STYLES.ACTIVE;
            const StatusIcon = statusStyle.icon;
            return (
              <tr
                key={sub.id}
                onClick={() => onSelect(sub.id)}
                className="border-b border-[var(--anna-border)] last:border-0 hover:bg-[var(--anna-sage-light)]/30 cursor-pointer transition-colors group"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--anna-slate)]">{sub.household.name}</span>
                    <ChevronRight size={14} className="text-[var(--anna-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <p className="text-[10px] text-[var(--anna-muted)]">{sub.household.email}</p>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="secondary" className={cn("text-[10px] font-medium", tierStyle.bg, tierStyle.text)}>
                    <Crown size={10} className="mr-1" />
                    {tierStyle.label}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="secondary" className={cn("text-[10px] font-medium", statusStyle.bg, statusStyle.text)}>
                    <StatusIcon size={10} className="mr-1" />
                    {sub.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 font-data text-xs text-[var(--anna-slate)]">
                  {formatSgd(sub.priceCents)}
                  <span className="text-[var(--anna-muted)]">/mo</span>
                </td>
                <td className="px-4 py-3 font-data text-xs text-[var(--anna-muted)]">
                  {formatDate(sub.nextBillingDate)}
                </td>
                <td className="px-4 py-3 font-data text-xs text-[var(--anna-slate-light)]">
                  {sub.stats.completedTasks}
                </td>
                <td className="px-4 py-3 font-data text-xs text-[var(--anna-slate-light)]">
                  {formatSgd(sub.stats.totalSpendCents)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
