"use client";

import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/ops-format";
import {
  STATUS_STYLES,
  TYPE_STYLES,
  formatDiscount,
} from "./campaign-styles";
import type { CampaignListItem } from "./types";

// ============================================================
// Anna.I — Ops Campaigns Mobile Card List
// ============================================================
// The `md:hidden` card list shown on mobile. Mirrors
// subscriptions/subscription-mobile-card.tsx — stacked card
// layout with type + status badges, discount summary, and
// redemption / code counts.
// ============================================================

interface CampaignMobileListProps {
  campaigns: CampaignListItem[];
  onSelect: (id: string) => void;
}

export function CampaignMobileList({
  campaigns,
  onSelect,
}: CampaignMobileListProps) {
  return (
    <div className="md:hidden space-y-2">
      {campaigns.map((c) => {
        const statusStyle = STATUS_STYLES[c.status] || STATUS_STYLES.DRAFT;
        const typeStyle = TYPE_STYLES[c.type] || TYPE_STYLES.OTHER;
        return (
          <div
            key={c.id}
            onClick={() => onSelect(c.id)}
            className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 hover:shadow-sm transition-all cursor-pointer"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[var(--anna-slate)] truncate">
                  {c.name}
                </p>
                {c.description ? (
                  <p className="text-xs text-[var(--anna-muted)] mt-0.5 truncate">
                    {c.description}
                  </p>
                ) : null}
              </div>
              <ChevronRight
                size={16}
                className="text-[var(--anna-muted)] shrink-0 mt-0.5"
              />
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <Badge
                variant="secondary"
                className={cn(
                  "text-[10px] font-medium",
                  typeStyle.bg,
                  typeStyle.text
                )}
              >
                {typeStyle.label}
              </Badge>
              <Badge
                variant="secondary"
                className={cn(
                  "text-[10px] font-medium inline-flex items-center gap-1",
                  statusStyle.bg,
                  statusStyle.text
                )}
              >
                <span className={cn("w-1.5 h-1.5 rounded-full", statusStyle.dot)} />
                {statusStyle.label}
              </Badge>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="font-data text-[var(--anna-slate)]">
                {formatDiscount(c.discountRule)}
              </span>
              <span className="text-[var(--anna-muted)]">
                <span className="font-data text-[var(--anna-slate-light)]">
                  {c.redemptionsCount}
                </span>{" "}
                redemptions ·{" "}
                <span className="font-data text-[var(--anna-slate-light)]">
                  {c._count.codes}
                </span>{" "}
                codes
              </span>
            </div>
            <p className="mt-1 text-[10px] text-[var(--anna-muted)]">
              Created {formatDate(c.createdAt)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
