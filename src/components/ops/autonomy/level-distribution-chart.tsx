"use client";

import { AUTONOMY_LEVEL_NAMES, MAX_AUTONOMY_LEVEL } from "@/lib/constants";

// ============================================================
// Anna.I — Ops Level Distribution Chart
// ============================================================
// Horizontal bar chart showing the count of households at each
// autonomy level (1..MAX_AUTONOMY_LEVEL). Each row is:
//   - 32-wide level-name label (AUTONOMY_LEVEL_NAMES[i])
//   - flex-1 progress bar (sage/70 fill, width % = count/maxLevel)
//   - 8-wide count number
//
// `maxLevel` is the max count across levels (used as the
// denominator for the bar width). When distribution is empty,
// renders an "No data yet" placeholder.
// ============================================================

interface LevelDistributionChartProps {
  distribution: Record<string, number>;
  maxLevel: number;
}

export function LevelDistributionChart({
  distribution,
  maxLevel,
}: LevelDistributionChartProps) {
  return (
    <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-5">
      <h3 className="text-sm font-semibold text-[var(--anna-slate)] mb-4">
        Level Distribution
      </h3>
      {Object.keys(distribution).length === 0 ? (
        <p className="text-xs text-[var(--anna-muted)] py-6 text-center">
          No data yet
        </p>
      ) : (
        <div className="space-y-2.5">
          {Array.from({ length: MAX_AUTONOMY_LEVEL }).map((_, i) => {
            const lvl = i + 1;
            const count = distribution[lvl] || 0;
            return (
              <div key={lvl} className="flex items-center gap-3">
                <div className="w-32 shrink-0">
                  <span className="text-[11px] text-[var(--anna-slate-light)]">
                    {AUTONOMY_LEVEL_NAMES[i]}
                  </span>
                </div>
                <div className="flex-1 h-6 bg-[var(--anna-bg)] rounded-lg overflow-hidden">
                  <div
                    className="h-full rounded-lg bg-[var(--anna-sage)]/70 transition-all duration-700"
                    style={{
                      width: `${(count / Math.max(maxLevel, 1)) * 100}%`,
                      minWidth: count > 0 ? "8px" : "0px",
                    }}
                  />
                </div>
                <span className="font-data text-xs text-[var(--anna-slate)] w-8 text-right">
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
