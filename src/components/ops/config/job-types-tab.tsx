"use client";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatSgd } from "@/lib/ops-format";

// ============================================================
// Anna.I — Ops Config: Job Types Tab
// ============================================================
// Table of billable service job types. Admins get a Switch to toggle
// each job type's active state inline; non-admins see a static On/Off
// badge. The header carries the effective platform commission rate
// badge so the prices always have a frame of reference.
// ============================================================

interface JobTypesTabProps {
  jobTypes: Record<string, unknown>[];
  effectiveCommission: number;
  isAdmin: boolean;
  onToggle: (id: string, isActive: boolean) => void;
}

export function JobTypesTab({
  jobTypes,
  effectiveCommission,
  isAdmin,
  onToggle,
}: JobTypesTabProps) {
  return (
    <div className="mt-4">
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--anna-border)] flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
            Service Job Types
          </h3>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="text-[10px] font-data border-[var(--anna-border)] text-[var(--anna-slate-light)]"
            >
              Commission: {effectiveCommission}%
            </Badge>
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto anna-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)] sticky top-0">
                <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                  Category
                </th>
                <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                  Service
                </th>
                <th className="text-right px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                  Price
                </th>
                <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                  Unit
                </th>
                <th className="text-center px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                  Active
                </th>
              </tr>
            </thead>
            <tbody>
              {jobTypes.map((j: Record<string, unknown>) => (
                <tr
                  key={j.id as string}
                  className="border-b border-[var(--anna-border)] last:border-0 hover:bg-[var(--anna-sage-light)]/30 transition-colors"
                >
                  <td className="px-5 py-2.5 text-xs text-[var(--anna-muted)]">
                    {(j.category as string).replace(/_/g, " ")}
                  </td>
                  <td className="px-5 py-2.5 font-medium text-[var(--anna-slate)]">
                    {j.name as string}
                  </td>
                  <td className="px-5 py-2.5 text-right font-data text-sm text-[var(--anna-slate)]">
                    {formatSgd(j.basePriceCents as number)}
                  </td>
                  <td className="px-5 py-2.5 text-xs text-[var(--anna-muted)]">
                    {j.unitLabel as string}
                  </td>
                  <td className="px-5 py-2.5 text-center">
                    {isAdmin ? (
                      <Switch
                        checked={j.isActive as boolean}
                        onCheckedChange={(v) =>
                          onToggle(j.id as string, v)
                        }
                        className="mx-auto"
                      />
                    ) : (
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] font-medium",
                          j.isActive
                            ? "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
                            : "bg-[var(--anna-bg)] text-[var(--anna-muted)]"
                        )}
                      >
                        {j.isActive ? "On" : "Off"}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
