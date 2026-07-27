"use client";

import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCents, formatDateTime, timeAgo } from "@/lib/ops-format";
import {
  ANOMALY_TYPE_LABELS,
  ANOMALY_SEVERITY_STYLES,
} from "@/lib/constants";
import {
  AnomalyRow,
  STATUS_STYLES,
  STATUS_ICONS,
} from "./anomaly-styles";

// ============================================================
// Anna.I — Ops Anomalies Desktop Table
// ============================================================
// The `hidden md:block` table view shown on tablet/desktop.
// Receives the filtered anomaly list, the current selection set,
// and toggles for row/select-all. Visual output must stay
// pixel-identical to the original page.
// ============================================================

interface AnomalyTableProps {
  anomalies: AnomalyRow[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
}

export function AnomalyTable({
  anomalies,
  selectedIds,
  onToggleSelect,
  onToggleAll,
}: AnomalyTableProps) {
  return (
    <div className="hidden md:block bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)]">
            <th className="text-center px-3 py-3 w-10">
              <input
                type="checkbox"
                checked={
                  selectedIds.size === anomalies.length &&
                  anomalies.length > 0
                }
                onChange={onToggleAll}
                className="rounded border-[var(--anna-border)]"
              />
            </th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Type
            </th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Message
            </th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Household
            </th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Vendor
            </th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Severity
            </th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Status
            </th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              When
            </th>
          </tr>
        </thead>
        <tbody>
          {anomalies.map((a) => {
            const sevStyle = ANOMALY_SEVERITY_STYLES[a.severity] || {};
            const StatusIcon = STATUS_ICONS[a.status] || Clock;
            return (
              <tr
                key={a.id}
                className={cn(
                  "border-b border-[var(--anna-border)] last:border-0 transition-colors",
                  selectedIds.has(a.id)
                    ? "bg-[var(--anna-sage-light)]/50"
                    : "hover:bg-[var(--anna-sage-light)]/20"
                )}
              >
                <td className="px-3 py-3 text-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(a.id)}
                    onChange={() => onToggleSelect(a.id)}
                    className="rounded border-[var(--anna-border)]"
                  />
                </td>
                <td className="px-4 py-3">
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                    {ANOMALY_TYPE_LABELS[a.type] || a.type}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <p className="text-xs text-[var(--anna-slate)] max-w-xs">
                    {a.message}
                  </p>
                  {a.task && (
                    <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">
                      {a.task.category.replace(/_/g, " ")} &middot;{" "}
                      {formatCents(a.task.amountCents)}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <p className="text-xs text-[var(--anna-slate-light)]">
                    {a.household?.name}
                  </p>
                  {a.household?.postalCode && (
                    <p className="text-[10px] text-[var(--anna-muted)] font-data">
                      {a.household.postalCode}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--anna-muted)]">
                  {a.vendor?.name || "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full",
                        sevStyle.dot
                      )}
                    />
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] border",
                        sevStyle.bg,
                        sevStyle.text,
                        sevStyle.border
                      )}
                    >
                      {a.severity}
                    </Badge>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <StatusIcon size={12} />
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] border",
                        STATUS_STYLES[a.status] || ""
                      )}
                    >
                      {a.status}
                    </Badge>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <p className="text-[10px] text-[var(--anna-slate-light)] font-data">
                    {timeAgo(a.createdAt)}
                  </p>
                  <p className="text-[10px] text-[var(--anna-muted)]">
                    {formatDateTime(a.createdAt)}
                  </p>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
