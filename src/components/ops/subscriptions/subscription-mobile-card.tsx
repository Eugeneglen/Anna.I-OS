"use client";

import { Badge } from "@/components/ui/badge";
import { ChevronRight, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSgd } from "@/lib/ops-format";
import { TIER_STYLES, STATUS_STYLES, type SubItem } from "./subscription-styles";

// ============================================================
// Anna.I — Ops Subscriptions Mobile Card List
// ============================================================
// The `md:hidden` card list shown on mobile. Receives the
// filtered subscription list and a selection handler. Visual
// output must stay pixel-identical to the original page.
// ============================================================

interface SubscriptionMobileListProps {
  subscriptions: SubItem[];
  onSelect: (id: string) => void;
}

export function SubscriptionMobileList({
  subscriptions,
  onSelect,
}: SubscriptionMobileListProps) {
  return (
    <div className="md:hidden space-y-2">
      {subscriptions.map((sub) => {
        const tierStyle = TIER_STYLES[sub.tier] || TIER_STYLES.HOME;
        const statusStyle = STATUS_STYLES[sub.status] || STATUS_STYLES.ACTIVE;
        const StatusIcon = statusStyle.icon;
        return (
          <div
            key={sub.id}
            onClick={() => onSelect(sub.id)}
            className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 hover:shadow-sm transition-all cursor-pointer"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[var(--anna-slate)]">{sub.household.name}</p>
                <p className="text-xs text-[var(--anna-muted)] mt-0.5">{sub.household.email}</p>
              </div>
              <ChevronRight size={16} className="text-[var(--anna-muted)] shrink-0 mt-0.5" />
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className={cn("text-[10px] font-medium", tierStyle.bg, tierStyle.text)}>
                <Crown size={10} className="mr-1" />
                {tierStyle.label}
              </Badge>
              <Badge variant="secondary" className={cn("text-[10px] font-medium", statusStyle.bg, statusStyle.text)}>
                <StatusIcon size={10} className="mr-1" />
                {sub.status}
              </Badge>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="font-data text-[var(--anna-slate)]">{formatSgd(sub.priceCents)}/mo</span>
              <span className="text-[var(--anna-muted)]">{sub.stats.completedTasks} tasks</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
