"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { ACTIVE_CATEGORIES } from "@/lib/constants";
import { OpsPageHeader, OpsSearchInput } from "@/components/ops/ops-page-header";
import { OpsLoadingCards } from "@/components/ops/ops-loading-skeleton";
import { AutonomySummaryCards } from "@/components/ops/autonomy/autonomy-summary-cards";
import {
  PromotionEngine,
  type PromotionCandidate,
} from "@/components/ops/autonomy/promotion-engine";
import {
  AutonomyHouseholdTable,
  type HouseholdRow,
} from "@/components/ops/autonomy/autonomy-household-table";
import { AutonomyDetailSheet } from "@/components/ops/autonomy/autonomy-detail-sheet";
import { LevelDistributionChart } from "@/components/ops/autonomy/level-distribution-chart";
import { PromotionPipelineCard } from "@/components/ops/autonomy/promotion-pipeline-card";

// ============================================================
// Anna.I — Ops Autonomy Page
// ============================================================
// Household autonomy ladder view: KPI summary, promotion engine,
// level distribution + pipeline grid, household table, and an
// inline per-household detail panel with pause/resume toggles.
// All data fetching & mutations live here; presentation is
// delegated to sub-components under @/components/ops/autonomy/.
// ============================================================

export default function AutonomyPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<PromotionCandidate[]>([]);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (categoryFilter && categoryFilter !== "all_categories")
      params.set("category", categoryFilter);
    return params.toString();
  }, [search, categoryFilter]);

  const { data, isLoading } = useQuery({
    queryKey: ["ops-autonomy", buildParams()],
    queryFn: async () => {
      const qs = buildParams();
      const res = await fetch(`/api/ops/autonomy${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const households: HouseholdRow[] = data?.households || [];
  const summary = data?.summary || {};

  const scanMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ops/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan" }),
      });
      if (!res.ok) throw new Error("Scan failed");
      return res.json();
    },
    onSuccess: (data) => {
      setScanResults(data.candidates || []);
      toast.success(`Found ${data.candidates?.length || 0} eligible promotions`);
    },
    onError: () => toast.error("Promotion scan failed"),
  });

  const executeMutation = useMutation({
    mutationFn: async (candidates: PromotionCandidate[]) => {
      const res = await fetch("/api/ops/promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "execute", candidates }),
      });
      if (!res.ok) throw new Error("Execute failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast.success(`${data.promoted} promoted, ${data.failed} failed`);
      setScanResults([]);
      qc.invalidateQueries({ queryKey: ["ops-autonomy"] });
    },
    onError: () => toast.error("Promotion execution failed"),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({
      householdId,
      category,
      promotionPaused,
    }: {
      householdId: string;
      category: string;
      promotionPaused: boolean;
    }) => {
      const res = await fetch("/api/ops/autonomy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdId, category, promotionPaused }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops-autonomy"] });
      toast.success("Promotion updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const levelDistribution = summary.levelDistribution || {};
  const maxDistLevel = Math.max(
    ...Object.keys(levelDistribution).map(Number),
    1
  );
  const pipeline = summary.pipeline || [];

  const selectedHousehold = detailId
    ? households.find((h) => h.id === detailId) ?? null
    : null;

  return (
    <div className="space-y-5 pb-20 md:pb-0 anna-fade-in">
      <OpsPageHeader
        title="Autonomy"
        subtitle="Household autonomy ladder · Promotion pipeline"
        actions={
          <>
            <OpsSearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search household..."
              className="w-52"
            />
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-40 rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-xs">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_categories">All Categories</SelectItem>
                {ACTIVE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          <OpsLoadingCards count={4} />
          <Skeleton className="h-64 rounded-2xl bg-[var(--anna-border)]" />
        </div>
      ) : (
        <>
          <AutonomySummaryCards summary={summary} />

          <PromotionEngine
            scanMutation={scanMutation}
            executeMutation={executeMutation}
            scanResults={scanResults}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <LevelDistributionChart
              distribution={levelDistribution}
              maxLevel={maxDistLevel}
            />
            <PromotionPipelineCard pipeline={pipeline} />
          </div>

          <AutonomyHouseholdTable
            households={households}
            onSelect={setDetailId}
          />

          <AutonomyDetailSheet
            open={!!selectedHousehold}
            onOpenChange={(open) => !open && setDetailId(null)}
            household={selectedHousehold}
            onTogglePause={(householdId, category, promotionPaused) =>
              toggleMutation.mutate({ householdId, category, promotionPaused })
            }
            togglePending={toggleMutation.isPending}
          />
        </>
      )}
    </div>
  );
}
