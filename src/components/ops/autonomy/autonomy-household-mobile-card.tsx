"use client";

import { ChevronRight } from "lucide-react";
import { LevelBar } from "@/components/ops/shared/level-bar";
import type { HouseholdRow } from "./autonomy-household-table";

// ============================================================
// Anna.I — Ops Autonomy Household Mobile Card List
// ============================================================
// Mobile-friendly card variant of the household autonomy table.
// Mirrors the desktop table's columns: household name + email,
// avg level + LevelBar, and the per-category chip row.
//
// Note: the original page rendered only a desktop `<table>` (with
// horizontal scroll on small screens) — it did NOT have a mobile
// card variant. This component exists for spec parity with the
// other Ops refactors (households / subscriptions / anomalies all
// ship a `md:hidden` mobile list) and is provided for future use.
// It is currently NOT rendered by the page so that visual output
// stays pixel-identical to the pre-refactor page.
// ============================================================

interface AutonomyHouseholdMobileListProps {
  households: HouseholdRow[];
  onSelect: (id: string) => void;
}

export function AutonomyHouseholdMobileList({
  households,
  onSelect,
}: AutonomyHouseholdMobileListProps) {
  return (
    <div className="md:hidden space-y-2">
      {households.map((h) => (
        <div
          key={h.id}
          onClick={() => onSelect(h.id)}
          className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 hover:shadow-sm transition-all cursor-pointer"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-[var(--anna-slate)]">{h.name}</p>
              <p className="text-xs text-[var(--anna-muted)] mt-0.5">{h.email}</p>
            </div>
            <ChevronRight size={16} className="text-[var(--anna-muted)] shrink-0 mt-0.5" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Avg
            </span>
            <span className="font-data text-sm text-[var(--anna-slate)]">{h.avgLevel}</span>
            <LevelBar level={Math.round(h.avgLevel)} />
          </div>
          <div className="mt-2 flex gap-1.5 flex-wrap">
            {h.autonomyLevels.slice(0, 3).map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-lg bg-[var(--anna-bg)]"
                title={`${a.category.replace(/_/g, " ")}: ${a.currentLevelName} (${a.totalVerifiedCycles} cycles)`}
              >
                <LevelBar level={a.currentLevel} />
                <span className="text-[var(--anna-muted)]">
                  {a.category.replace(/_/g, " ")}
                </span>
              </div>
            ))}
            {h.autonomyLevels.length > 3 && (
              <span className="text-[10px] text-[var(--anna-muted)] font-data self-center">
                +{h.autonomyLevels.length - 3}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
