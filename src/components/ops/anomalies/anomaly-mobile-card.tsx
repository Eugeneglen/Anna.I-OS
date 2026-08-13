"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/ops-format";
import {
  ANOMALY_TYPE_LABELS,
  ANOMALY_SEVERITY_STYLES,
} from "@/lib/constants";
import { AnomalyRow, STATUS_STYLES } from "./anomaly-styles";

// ============================================================
// Anna.I — Ops Anomalies Mobile Card List
// ============================================================
// The `md:hidden` stacked-card list shown on mobile.
// Tapping a card toggles its selection. Visual output must
// stay pixel-identical to the original page.
// ============================================================

interface AnomalyMobileListProps {
  anomalies: AnomalyRow[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}

export function AnomalyMobileList({
  anomalies,
  selectedIds,
  onToggleSelect,
}: AnomalyMobileListProps) {
  return (
    <div className="md:hidden space-y-2">
      {anomalies.map((a) => {
        const sevStyle = ANOMALY_SEVERITY_STYLES[a.severity] || {};
        return (
          <div
            key={a.id}
            onClick={() => onToggleSelect(a.id)}
            className={cn(
              "bg-[var(--anna-white)] rounded-2xl border p-4 cursor-pointer transition-all",
              selectedIds.has(a.id)
                ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/30"
                : "border-[var(--anna-border)] hover:shadow-sm"
            )}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selectedIds.has(a.id)}
                onChange={() => onToggleSelect(a.id)}
                className="mt-1 rounded border-[var(--anna-border)]"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      sevStyle.dot
                    )}
                  />
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                    {ANOMALY_TYPE_LABELS[a.type] || a.type}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] border shrink-0",
                      sevStyle.bg,
                      sevStyle.text,
                      sevStyle.border
                    )}
                  >
                    {a.severity}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] border shrink-0 ml-auto",
                      STATUS_STYLES[a.status] || ""
                    )}
                  >
                    {a.status}
                  </Badge>
                </div>
                <p className="text-xs text-[var(--anna-slate)]">
                  {a.message}
                </p>
                <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--anna-muted)]">
                  <span>{a.household?.name}</span>
                  {a.vendor && <span>&middot; {a.vendor.name}</span>}
                  <span className="ml-auto font-data">
                    {timeAgo(a.createdAt)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
