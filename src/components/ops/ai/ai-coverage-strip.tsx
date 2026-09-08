"use client";

import { useEffect, useState } from "react";
import { Bot, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatSgd } from "@/lib/ops-format";

// ============================================================
// Anna.I — Ops AI Case Brief Coverage Strip (Phase 2 · §8)
// ============================================================
// Live coverage metrics: 100% of qualifying disputes must hold
// an active brief. Generation failures, retries, expired briefs
// and manual-review fallbacks are all visible — nothing hidden.
// ============================================================

interface CoverageStats {
  currentlyQualifyingDisputes: number;
  disputesWithActiveBrief: number;
  coveragePercent: number;
  totalQualifyingDisputesHistorical: number;
  briefsGenerated: number;
  generationFailures: number;
  generationFailuresActive: number;
  retries: number;
  expiredBriefs: number;
  supersededBriefs: number;
  manualReviewFallbacks: number;
  decided: { accepted: number; rejected: number; overridden: number };
}

export function AiCoverageStrip({ refreshKey }: { refreshKey?: number }) {
  const [stats, setStats] = useState<CoverageStats | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/ops/ai/cases/stats");
        if (res.status === 403) {
          if (!cancelled) setForbidden(true);
          return;
        }
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setStats(data.stats);
          setForbidden(false);
        }
      } catch {
        /* keep previous */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (forbidden) return null;

  const full = stats ? stats.coveragePercent >= 100 : false;

  return (
    <div className="rounded-2xl border border-[var(--anna-sage)]/25 bg-[var(--anna-sage-light)]/20 px-4 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[var(--anna-sage)]/15 flex items-center justify-center">
            <Bot size={14} className="text-[var(--anna-sage-dark)]" />
          </div>
          <div>
            <p className="text-xs font-semibold text-[var(--anna-slate)]">
              AI dispute coverage
              {loading && <span className="ml-2 font-normal text-[var(--anna-muted)]">…</span>}
            </p>
            <p className="text-[10px] text-[var(--anna-muted)]">
              Every qualifying dispute must hold a case brief within 60s
            </p>
          </div>
        </div>
        {stats && (
          <div
            className={cn(
              "text-[10px] font-data font-bold px-2 py-1 rounded-lg border",
              full
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-amber-50 text-amber-700 border-amber-200"
            )}
          >
            {stats.disputesWithActiveBrief}/{stats.currentlyQualifyingDisputes} ·{" "}
            {stats.coveragePercent}%
          </div>
        )}
      </div>
      {stats && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[10px] text-[var(--anna-muted)] font-data">
          <span>generated {stats.briefsGenerated}</span>
          <span className={stats.generationFailuresActive > 0 ? "text-red-600 font-semibold" : ""}>
            failures {stats.generationFailures}
            {stats.generationFailuresActive > 0 ? ` (${stats.generationFailuresActive} active)` : ""}
          </span>
          <span>retries {stats.retries}</span>
          <span>expired {stats.expiredBriefs}</span>
          <span>superseded {stats.supersededBriefs}</span>
          <span>fallbacks {stats.manualReviewFallbacks}</span>
          <span>
            decided {stats.decided.accepted + stats.decided.rejected + stats.decided.overridden} (A
            {stats.decided.accepted}/R{stats.decided.rejected}/O{stats.decided.overridden})
          </span>
        </div>
      )}
      {stats && stats.generationFailuresActive > 0 && (
        <p className="text-[10px] text-red-600 mt-1.5">
          Active generation failures stay in the manual-review queue with the error visible —
          failures are never hidden. The 60s sweep retries automatically.
        </p>
      )}
    </div>
  );
}
