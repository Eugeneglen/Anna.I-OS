"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAnnaStore } from "@/lib/store";
import { CategoryIcon, getCategoryLabel } from "./category-icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AUTONOMY_LEVELS,
  type ServiceCategory,
  type HouseholdCategoryAutonomy,
  type AutonomyLevelThreshold,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Lock, ArrowRight, Zap, Pause, Play } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

async function fetchAutonomy(householdId: string) {
  const res = await fetch(`/api/autonomy/${householdId}`);
  if (!res.ok) throw new Error("Failed to fetch autonomy");
  return res.json();
}

async function patchAutonomy(
  householdId: string,
  category: string,
  data: { promotionPaused?: boolean; currentLevel?: number }
) {
  const res = await fetch(`/api/autonomy/${householdId}/${category}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to update autonomy");
  return res.json();
}

function AutonomySegment({
  index,
  filled,
  highlighted,
  locked,
}: {
  index: number;
  filled: boolean;
  highlighted: boolean;
  locked?: boolean;
}) {
  return (
    <div
      className={cn(
        "h-2.5 flex-1 rounded-full transition-all duration-300",
        filled
          ? "bg-[var(--anna-sage)]"
          : locked
            ? "bg-[var(--anna-border)] opacity-50"
            : highlighted
              ? "bg-[var(--anna-sage)]/30 border border-dashed border-[var(--anna-sage)]/50"
              : "bg-[var(--anna-border)]"
      )}
      title={locked ? `${AUTONOMY_LEVELS[index]} (Coming Soon)` : AUTONOMY_LEVELS[index]}
    />
  );
}

function AutonomyCard({
  autonomy,
  thresholds,
  householdId,
}: {
  autonomy: HouseholdCategoryAutonomy;
  thresholds: AutonomyLevelThreshold[];
  householdId: string;
}) {
  const queryClient = useQueryClient();

  const categoryThresholds = thresholds
    .filter((t) => t.category === autonomy.category)
    .sort((a, b) => a.level - b.level);

  const currentLevel = autonomy.currentLevel;
  const nextThreshold = categoryThresholds.find(
    (t) => t.level === currentLevel + 1
  );
  const cyclesNeeded = nextThreshold
    ? nextThreshold.cyclesRequired - autonomy.verifiedCyclesAtLevel
    : 0;
  const isMaxLevel = currentLevel >= 5;

  // Only L3 (Auto-Dispatch) is active. L4/L5 are locked until their phases ship.
  const canAutoDispatch = currentLevel >= 3;
  const isL4Locked = currentLevel >= 3; // L4+ segments show locked for L4/L5
  const isL5Locked = currentLevel >= 4;

  // L4 (Predictive Pre-Booking) and L5 (Full Autonomous) are not yet available.
  // Per CLAUDE.md: L4 unlocked by Phase 4 (Predictive Scheduler),
  // L5 unlocked by Phase 5 (NLU/Write-Capable).
  const activeCapabilityLevel = 3; // Only auto-dispatch is live

  const segments = Array.from({ length: 5 }, (_, i) => ({
    index: i,
    filled: i < currentLevel,
    highlighted: i === currentLevel && !isMaxLevel && currentLevel < activeCapabilityLevel,
    locked: i + 1 > activeCapabilityLevel,
  }));

  const togglePauseMutation = useMutation({
    mutationFn: (paused: boolean) =>
      patchAutonomy(householdId, autonomy.category, {
        promotionPaused: paused,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["autonomy", householdId] });
      toast.success(
        autonomy.promotionPaused
          ? "Promotion resumed"
          : "Promotion paused"
      );
    },
    onError: () => {
      toast.error("Failed to update setting");
    },
  });

  return (
    <div className="bg-[var(--anna-white)] rounded-2xl p-5 border border-[var(--anna-border)] hover:shadow-sm transition-shadow">
      {/* Header: icon + name + level + pause button */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <CategoryIcon category={autonomy.category} size={18} />
          <div>
            <h3 className="text-sm font-semibold text-[var(--anna-slate)]">
              {getCategoryLabel(autonomy.category)}
            </h3>
            <p className="text-xs text-[var(--anna-muted)]">
              {autonomy.promotionPaused && (
                <span className="inline-flex items-center gap-1 mr-2 text-amber-600 dark:text-amber-400">
                  <Lock size={10} />
                  Paused
                </span>
              )}
              Level {currentLevel} &middot;{" "}
              <span className="font-medium text-[var(--anna-sage-dark)]">
                {AUTONOMY_LEVELS[currentLevel - 1]}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-data text-xs text-[var(--anna-muted)]">
            {autonomy.totalVerifiedCycles} verified
          </span>
          <button
            onClick={() =>
              togglePauseMutation.mutate(!autonomy.promotionPaused)
            }
            disabled={togglePauseMutation.isPending}
            className={cn(
              "p-1.5 rounded-lg border transition-colors",
              autonomy.promotionPaused
                ? "border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-400 dark:hover:bg-amber-950"
                : "border-[var(--anna-border)] text-[var(--anna-muted)] hover:bg-[var(--anna-border)]/50 hover:text-[var(--anna-slate)]"
            )}
            title={autonomy.promotionPaused ? "Resume promotion" : "Pause promotion"}
          >
            {autonomy.promotionPaused ? (
              <Play size={13} />
            ) : (
              <Pause size={13} />
            )}
          </button>
        </div>
      </div>

      {/* 5-Segment Progress Bar */}
      <div className="flex items-center gap-1.5 mb-3">
        {segments.map((seg) => (
          <AutonomySegment key={seg.index} {...seg} />
        ))}
      </div>

      {/* Level labels */}
      <div className="flex justify-between text-[9px] text-[var(--anna-muted)] mb-3">
        <span>Manual</span>
        <span>Full Auto</span>
      </div>

      {/* Active automation capability (L3: Auto-Dispatch only) */}
      {canAutoDispatch && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--anna-sage)]/10 text-[var(--anna-sage-dark)]">
            <Zap size={9} />
            Auto-Dispatch
          </span>
        </div>
      )}

      {/* Locked capabilities notice */}
      {(isL4Locked || isL5Locked) && (
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--anna-muted)] mb-3">
          <Lock size={10} />
          <span>
            {isL4Locked && !isL5Locked
              ? "Predictive Pre-Booking — coming soon"
              : isL5Locked
                ? "Predictive Pre-Booking & Full Autonomous — coming soon"
                : "Full Autonomous — coming soon"}
          </span>
        </div>
      )}

      {/* Next level info */}
      {!isMaxLevel && nextThreshold ? (
        <div className="flex items-center gap-2 text-xs text-[var(--anna-slate-light)] bg-[var(--anna-sage-light)] rounded-xl px-3 py-2">
          <ArrowRight size={12} className="text-[var(--anna-sage-dark)]" />
          <span>
            <strong className="font-data">{cyclesNeeded}</strong> more verified
            booking{cyclesNeeded !== 1 ? "s" : ""} to unlock{" "}
            <strong>{AUTONOMY_LEVELS[currentLevel]}</strong>
          </span>
        </div>
      ) : (
        <div className="text-xs text-[var(--anna-success)] bg-[var(--anna-success)]/10 rounded-xl px-3 py-2">
          Maximum autonomy achieved
        </div>
      )}
    </div>
  );
}

export function AutonomyPanel() {
  const { selectedHouseholdId } = useAnnaStore();

  const { data, isLoading } = useQuery({
    queryKey: ["autonomy", selectedHouseholdId],
    queryFn: () => fetchAutonomy(selectedHouseholdId),
    enabled: !!selectedHouseholdId,
  });

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-4">
        <Skeleton className="h-8 w-48 rounded-xl bg-[var(--anna-border)]" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 w-full rounded-2xl bg-[var(--anna-border)]" />
        ))}
      </div>
    );
  }

  const autonomyData: HouseholdCategoryAutonomy[] = data?.autonomy || [];
  const thresholds: AutonomyLevelThreshold[] = data?.thresholds || [];

  return (
    <div className="p-4 lg:p-6 pb-20 md:pb-0 anna-fade-in">
      <h1 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)] mb-1">
        Autonomy Ladder
      </h1>
      <p className="text-sm text-[var(--anna-muted)] mb-6">
        As Anna.I verifies more bookings per category, it earns trust and
        graduates to higher autonomy levels. Verification and escrow release
        remain manual at every level — that protection is constant.
      </p>

      {autonomyData.length === 0 ? (
        <div className="text-center py-16 text-[var(--anna-muted)]">
          <p className="text-sm">No autonomy data yet</p>
          <p className="text-xs mt-1">Complete tasks to start building trust</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-[calc(100vh-240px)] overflow-y-auto anna-scroll pr-1">
          {autonomyData.map((a) => (
            <AutonomyCard
              key={a.id}
              autonomy={a}
              thresholds={thresholds}
              householdId={selectedHouseholdId}
            />
          ))}
        </div>
      )}
    </div>
  );
}