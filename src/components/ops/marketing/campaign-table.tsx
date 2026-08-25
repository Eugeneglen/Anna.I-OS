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
// Anna.I — Ops Campaigns Desktop Table
// ============================================================
// The `hidden md:block` table view shown on tablet/desktop.
// Mirrors the layout of subscriptions/subscription-table.tsx,
// adapted to the marketing domain (campaign name, type, status,
// discount summary, redemption/code counts, created date).
// ============================================================

interface CampaignTableProps {
  campaigns: CampaignListItem[];
  onSelect: (id: string) => void;
}

export function CampaignTable({ campaigns, onSelect }: CampaignTableProps) {
  return (
    <div className="hidden md:block bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)]">
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Campaign
            </th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Type
            </th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Status
            </th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Discount
            </th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Redemptions
            </th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Codes
            </th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Created
            </th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c) => {
            const statusStyle = STATUS_STYLES[c.status] || STATUS_STYLES.DRAFT;
            const typeStyle = TYPE_STYLES[c.type] || TYPE_STYLES.OTHER;
            return (
              <tr
                key={c.id}
                onClick={() => onSelect(c.id)}
                className="border-b border-[var(--anna-border)] last:border-0 hover:bg-[var(--anna-sage-light)]/30 cursor-pointer transition-colors group"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--anna-slate)] truncate max-w-[260px]">
                      {c.name}
                    </span>
                    <ChevronRight
                      size={14}
                      className="text-[var(--anna-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    />
                  </div>
                  {c.description && (
                    <p className="text-[10px] text-[var(--anna-muted)] truncate max-w-[260px]">
                      {c.description}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3">
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
                </td>
                <td className="px-4 py-3">
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
                </td>
                <td className="px-4 py-3 font-data text-xs text-[var(--anna-slate-light)]">
                  {formatDiscount(c.discountRule)}
                </td>
                <td className="px-4 py-3 font-data text-xs text-[var(--anna-slate)]">
                  {c.redemptionsCount}
                  {c.maxRedemptions ? (
                    <span className="text-[var(--anna-muted)]"> / {c.maxRedemptions}</span>
                  ) : null}
                </td>
                <td className="px-4 py-3 font-data text-xs text-[var(--anna-slate-light)]">
                  {c._count.codes}
                </td>
                <td className="px-4 py-3 font-data text-xs text-[var(--anna-muted)]">
                  {formatDate(c.createdAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
