"use client";

import { Badge } from "@/components/ui/badge";

// ============================================================
// Anna.I — Ops Promotion Pipeline Card
// ============================================================
// Right-hand card of the two-column "Level Distribution +
// Promotion Pipeline" grid. Lists one row per category that
// has pipeline data, sorted by `ready` count desc. Each row
// shows:
//   - category name (sage-light chip)
//   - "N ready" emerald badge (only if ready > 0)
//   - "N in progress" muted text (only if inProgress > 0)
//   - "No active progress" italic placeholder if both are 0
//
// Empty state: "No pipeline data" centred placeholder.
// ============================================================

export interface PipelineEntry {
  category: string;
  ready: number;
  inProgress: number;
}

interface PromotionPipelineCardProps {
  pipeline: PipelineEntry[];
}

export function PromotionPipelineCard({ pipeline }: PromotionPipelineCardProps) {
  return (
    <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-5">
      <h3 className="text-sm font-semibold text-[var(--anna-slate)] mb-4">
        Promotion Pipeline
      </h3>
      {pipeline.length === 0 ? (
        <p className="text-xs text-[var(--anna-muted)] py-6 text-center">
          No pipeline data
        </p>
      ) : (
        <div className="space-y-1.5 max-h-80 overflow-y-auto anna-scroll">
          {[...pipeline]
            .sort((a, b) => b.ready - a.ready)
            .map((p) => (
              <div
                key={p.category}
                className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-[var(--anna-bg)] transition-colors"
              >
                <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)] w-36 shrink-0 truncate">
                  {p.category.replace(/_/g, " ")}
                </span>
                {p.ready > 0 && (
                  <Badge
                    variant="secondary"
                    className="bg-emerald-50 text-emerald-700 text-[10px] font-data"
                  >
                    {p.ready} ready
                  </Badge>
                )}
                {p.inProgress > 0 && (
                  <span className="font-data text-[10px] text-[var(--anna-muted)]">
                    {p.inProgress} in progress
                  </span>
                )}
                {p.ready === 0 && p.inProgress === 0 && (
                  <span className="text-[10px] text-[var(--anna-muted)] italic">
                    No active progress
                  </span>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
