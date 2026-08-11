"use client";

import { Button } from "@/components/ui/button";
import { Zap, Loader2, ChevronRight, TrendingUp } from "lucide-react";

// ============================================================
// Anna.I — Ops Promotion Engine
// ============================================================
// Card containing:
//   - "Scan for Promotions" button (calls scanMutation.mutate())
//   - Scan results table (per-candidate household + category +
//     level transition + verified cycles + per-row Promote button)
//   - "Promote All" button (calls executeMutation.mutate(scanResults))
//
// The `PromotionCandidate` interface is exported from this file and
// imported by the page (used as the type of `scanResults` state and
// as the payload for the execute mutation).
// ============================================================

export interface PromotionCandidate {
  householdId: string;
  householdName: string;
  category: string;
  currentLevel: number;
  currentLevelName: string;
  newLevel: number;
  newLevelName: string;
  verifiedCyclesAtLevel: number;
  cyclesRequired: number;
}

interface ScanMutationLike {
  isPending: boolean;
  mutate: () => void;
}

interface ExecuteMutationLike {
  isPending: boolean;
  mutate: (candidates: PromotionCandidate[]) => void;
}

interface PromotionEngineProps {
  scanMutation: ScanMutationLike;
  executeMutation: ExecuteMutationLike;
  scanResults: PromotionCandidate[];
}

export function PromotionEngine({
  scanMutation,
  executeMutation,
  scanResults,
}: PromotionEngineProps) {
  return (
    <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[var(--anna-slate)]">Promotion Engine</h3>
          <p className="text-[10px] text-[var(--anna-muted)]">Rule-based batch promotion scan</p>
        </div>
        <Button
          onClick={() => scanMutation.mutate()}
          disabled={scanMutation.isPending}
          size="sm"
          className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl text-xs font-medium"
        >
          {scanMutation.isPending ? (
            <><Loader2 size={14} className="animate-spin mr-1.5" /> Scanning...</>
          ) : (
            <><Zap size={14} className="mr-1.5" /> Scan for Promotions</>
          )}
        </Button>
      </div>

      {/* Scan results */}
      {scanResults.length === 0 && !scanMutation.isPending && (
        <p className="text-xs text-[var(--anna-muted)] text-center py-6">
          Click &quot;Scan&quot; to check for households eligible for autonomy promotion
        </p>
      )}

      {scanResults.length > 0 && (
        <>
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)]">
                  <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Household</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Category</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Level</th>
                  <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Cycles</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Action</th>
                </tr>
              </thead>
              <tbody>
                {scanResults.map((c, i) => (
                  <tr key={`${c.householdId}-${c.category}-${i}`} className="border-b border-[var(--anna-border)] last:border-0">
                    <td className="px-3 py-2.5 text-xs font-medium text-[var(--anna-slate)]">{c.householdName}</td>
                    <td className="px-3 py-2.5 text-[10px] text-[var(--anna-muted)]">{c.category.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1 text-[10px]">
                        <span className="font-data text-[var(--anna-slate)]">{c.currentLevelName}</span>
                        <ChevronRight size={12} className="text-[var(--anna-sage-dark)]" />
                        <span className="font-data font-semibold text-[var(--anna-sage-dark)]">{c.newLevelName}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-data text-[10px] text-[var(--anna-muted)]">{c.verifiedCyclesAtLevel}/{c.cyclesRequired}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] rounded-lg bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                        disabled={executeMutation.isPending}
                        onClick={() => executeMutation.mutate([c])}
                      >
                        Promote
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => executeMutation.mutate(scanResults)}
              disabled={executeMutation.isPending}
              className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl text-xs font-medium"
            >
              {executeMutation.isPending ? (
                <><Loader2 size={14} className="animate-spin mr-1.5" /> Promoting...</>
              ) : (
                <><TrendingUp size={14} className="mr-1.5" /> Promote All ({scanResults.length})</>
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
