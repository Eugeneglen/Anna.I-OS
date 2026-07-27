"use client";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { LevelBar } from "@/components/ops/shared/level-bar";
import type { HouseholdRow } from "./autonomy-household-table";

// ============================================================
// Anna.I — Ops Autonomy Detail Panel
// ============================================================
// Inline panel (NOT a shadcn Sheet modal) that appears below the
// households table when a household is selected. Renders one row
// per active autonomy category, with:
//   - category name
//   - LevelBar (md size) + current level name + verified cycles
//   - next level / cycles remaining (or "Max Level")
//   - Active/Paused toggle (Switch) wired to onTogglePause
//
// Naming: the spec calls this `AutonomyDetailSheet` and the file
// `autonomy-detail-sheet.tsx` to match the conventions used by
// the households / subscriptions / anomalies refactors. However
// the original autonomy page did NOT use a Sheet — it rendered
// an inline panel directly under the table. To preserve
// pixel-identical visual output, this component keeps the inline
// panel markup; the `open`/`onOpenChange` props simply gate
// rendering and forward Close-button clicks back to the page.
// ============================================================

interface AutonomyDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  household: HouseholdRow | null;
  onTogglePause: (
    householdId: string,
    category: string,
    promotionPaused: boolean
  ) => void;
  togglePending: boolean;
}

export function AutonomyDetailSheet({
  open,
  onOpenChange,
  household,
  onTogglePause,
  togglePending,
}: AutonomyDetailSheetProps) {
  if (!open || !household) return null;

  return (
    <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--anna-border)] flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
          {household.name} &mdash; Autonomy Detail
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpenChange(false)}
          className="text-xs text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
        >
          Close
        </Button>
      </div>
      <div className="p-5 space-y-3">
        {household.autonomyLevels.length === 0 ? (
          <p className="text-xs text-[var(--anna-muted)] text-center py-4">
            No autonomy data
          </p>
        ) : (
          household.autonomyLevels.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-4 py-3 px-4 rounded-xl bg-[var(--anna-bg)]"
            >
              <div className="w-28 shrink-0">
                <span className="text-xs font-medium text-[var(--anna-slate)]">
                  {a.category.replace(/_/g, " ")}
                </span>
              </div>
              <div className="flex-1">
                <LevelBar level={a.currentLevel} size="md" />
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[10px] text-[var(--anna-muted)]">
                    {a.currentLevelName}
                  </span>
                  <span className="font-data text-[10px] text-[var(--anna-muted)]">
                    {a.totalVerifiedCycles} verified
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0 w-32">
                {a.nextLevel ? (
                  <>
                    <p className="text-[10px] text-[var(--anna-slate-light)]">
                      Next: {a.nextLevelName}
                    </p>
                    <p className="font-data text-xs text-[var(--anna-sage-dark)]">
                      {a.cyclesRemaining === 0
                        ? "Ready"
                        : `${a.cyclesRemaining} cycle${a.cyclesRemaining !== 1 ? "s" : ""} left`}
                    </p>
                  </>
                ) : (
                  <p className="text-[10px] text-[var(--anna-sage-dark)] font-medium">
                    Max Level
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] text-[var(--anna-muted)]">
                  {a.promotionPaused ? "Paused" : "Active"}
                </span>
                <Switch
                  checked={!a.promotionPaused}
                  onCheckedChange={(v) =>
                    onTogglePause(household.id, a.category, !v)
                  }
                  disabled={togglePending}
                  className="scale-75"
                />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
