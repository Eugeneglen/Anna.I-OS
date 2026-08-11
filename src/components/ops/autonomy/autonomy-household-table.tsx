"use client";

import { ChevronRight } from "lucide-react";
import { LevelBar } from "@/components/ops/shared/level-bar";

// ============================================================
// Anna.I — Ops Autonomy Household Table
// ============================================================
// Desktop `<table>` of households showing avg autonomy level +
// a per-category chip row. Rows are clickable (calls onSelect
// with the household id) to open the inline detail panel.
//
// The `HouseholdRow` interface is exported from this file and
// imported by the page (used as the type of the `households`
// derived from the query response) and by the detail sheet.
//
// Note: the original page renders this table at all breakpoints
// (with horizontal scroll on mobile via `overflow-x-auto`). To
// preserve pixel-identical behaviour, this component does NOT
// add `hidden md:block`. A dedicated mobile card variant exists
// in `autonomy-household-mobile-card.tsx` for future use but is
// not rendered by the page.
// ============================================================

export interface HouseholdRow {
  id: string;
  name: string;
  email: string;
  avgLevel: number;
  autonomyLevels: {
    id: string;
    category: string;
    currentLevel: number;
    verifiedCyclesAtLevel: number;
    totalVerifiedCycles: number;
    promotionPaused: boolean;
    nextLevel: number | null;
    cyclesRemaining: number | null;
    currentLevelName: string;
    nextLevelName: string | null;
  }[];
}

interface AutonomyHouseholdTableProps {
  households: HouseholdRow[];
  onSelect: (id: string) => void;
}

export function AutonomyHouseholdTable({
  households,
  onSelect,
}: AutonomyHouseholdTableProps) {
  return (
    <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--anna-border)]">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
          Households
        </h3>
      </div>
      {households.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-[var(--anna-muted)]">
            No households found
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)]">
                <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                  Household
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                  Avg Level
                </th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                  Category Levels
                </th>
              </tr>
            </thead>
            <tbody>
              {households.map((h) => (
                <tr
                  key={h.id}
                  onClick={() => onSelect(h.id)}
                  className="border-b border-[var(--anna-border)] last:border-0 hover:bg-[var(--anna-sage-light)]/30 cursor-pointer transition-colors group"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[var(--anna-slate)]">
                        {h.name}
                      </span>
                      <ChevronRight
                        size={14}
                        className="text-[var(--anna-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                      />
                    </div>
                    <p className="text-[10px] text-[var(--anna-muted)]">
                      {h.email}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-data text-sm text-[var(--anna-slate)]">
                        {h.avgLevel}
                      </span>
                      <LevelBar level={Math.round(h.avgLevel)} />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 flex-wrap">
                      {h.autonomyLevels.slice(0, 4).map((a) => (
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
                      {h.autonomyLevels.length > 4 && (
                        <span className="text-[10px] text-[var(--anna-muted)] font-data self-center">
                          +{h.autonomyLevels.length - 4}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
