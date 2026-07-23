"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Search,
  Zap,
  TrendingUp,
  Users,
  BarChart3,
  Pause,
  Play,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AUTONOMY_LEVEL_NAMES,
  MAX_AUTONOMY_LEVEL,
  ACTIVE_CATEGORIES,
} from "@/lib/constants";

function formatCents(cents: number) {
  return `$${(cents / 100).toLocaleString("en-SG", { minimumFractionDigits: 2 })}`;
}

function LevelBar({
  level,
  max = MAX_AUTONOMY_LEVEL,
  size = "sm",
}: {
  level: number;
  max?: number;
  size?: "sm" | "md";
}) {
  const height = size === "sm" ? "h-3" : "h-4";
  return (
    <div className={cn("flex gap-0.5", height)}>
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "rounded-full transition-all duration-500",
            height,
            i < level
              ? "bg-[var(--anna-sage-dark)]"
              : "bg-[var(--anna-border)]"
          )}
        />
      ))}
    </div>
  );
}

interface PromotionCandidate {
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

interface HouseholdRow {
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

export default function AutonomyPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<PromotionCandidate[]>([]);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (categoryFilter && categoryFilter !== "all_categories") params.set("category", categoryFilter);
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
    ? households.find((h) => h.id === detailId)
    : null;

  return (
    <div className="space-y-5 pb-20 md:pb-0 anna-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
            Autonomy
          </h2>
          <p className="text-sm text-[var(--anna-muted)] mt-0.5">
            Household autonomy ladder &middot; Promotion pipeline
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--anna-muted)]"
            />
            <Input
              placeholder="Search household..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-52 rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30"
            />
          </div>
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
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-24 rounded-2xl bg-[var(--anna-border)]"
              />
            ))}
          </div>
          <Skeleton className="h-64 rounded-2xl bg-[var(--anna-border)]" />
        </div>
      ) : (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 hover:shadow-sm transition-shadow">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-[var(--anna-sage-light)]">
                <Users size={18} className="text-[var(--anna-sage-dark)]" />
              </div>
              <p className="mt-3 font-data text-2xl font-bold text-[var(--anna-slate)] leading-none">
                {summary.totalHouseholds || 0}
              </p>
              <p className="mt-1 text-xs text-[var(--anna-muted)]">Households</p>
            </div>
            <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 hover:shadow-sm transition-shadow">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-[var(--anna-sage-light)]">
                <BarChart3 size={18} className="text-[var(--anna-sage-dark)]" />
              </div>
              <p className="mt-3 font-data text-2xl font-bold text-[var(--anna-slate)] leading-none">
                {summary.avgLevel || 0}
              </p>
              <p className="mt-1 text-xs text-[var(--anna-muted)]">Avg Level</p>
            </div>
            <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 hover:shadow-sm transition-shadow">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-[var(--anna-sage-light)]">
                <TrendingUp size={18} className="text-[var(--anna-sage-dark)]" />
              </div>
              <p className="mt-3 font-data text-2xl font-bold text-[var(--anna-slate)] leading-none">
                {summary.atMaxLevel || 0}
              </p>
              <p className="mt-1 text-xs text-[var(--anna-muted)]">
                At Max Level
              </p>
            </div>
            <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 hover:shadow-sm transition-shadow">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-amber-50">
                <Zap size={18} className="text-amber-600" />
              </div>
              <p className="mt-3 font-data text-2xl font-bold text-[var(--anna-slate)] leading-none">
                {pipeline.reduce((s: number, p) => s + p.ready, 0)}
              </p>
              <p className="mt-1 text-xs text-[var(--anna-muted)]">
                Ready to Promote
              </p>
            </div>
          </div>

          {/* Promotion Engine */}
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
                Click "Scan" to check for households eligible for autonomy promotion
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

          {/* Two Column: Level Distribution + Promotion Pipeline */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Level Distribution */}
            <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-5">
              <h3 className="text-sm font-semibold text-[var(--anna-slate)] mb-4">
                Level Distribution
              </h3>
              {Object.keys(levelDistribution).length === 0 ? (
                <p className="text-xs text-[var(--anna-muted)] py-6 text-center">
                  No data yet
                </p>
              ) : (
                <div className="space-y-2.5">
                  {Array.from({ length: MAX_AUTONOMY_LEVEL }).map((_, i) => {
                    const lvl = i + 1;
                    const count = levelDistribution[lvl] || 0;
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
                              width: `${(count / Math.max(maxDistLevel, 1)) * 100}%`,
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

            {/* Promotion Pipeline */}
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
                  {pipeline
                    .sort((a: { ready: number }, b: { ready: number }) => b.ready - a.ready)
                    .map(
                      (p: {
                        category: string;
                        ready: number;
                        inProgress: number;
                      }) => (
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
                      )
                    )}
                </div>
              )}
            </div>
          </div>

          {/* Household Autonomy Table */}
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
                    {households.map((h: HouseholdRow) => (
                      <tr
                        key={h.id}
                        onClick={() => setDetailId(h.id)}
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

          {/* Household Detail Panel */}
          {selectedHousehold && (
            <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
              <div className="px-5 py-3 border-b border-[var(--anna-border)] flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                  {selectedHousehold.name} &mdash; Autonomy Detail
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDetailId(null)}
                  className="text-xs text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
                >
                  Close
                </Button>
              </div>
              <div className="p-5 space-y-3">
                {selectedHousehold.autonomyLevels.length === 0 ? (
                  <p className="text-xs text-[var(--anna-muted)] text-center py-4">
                    No autonomy data
                  </p>
                ) : (
                  selectedHousehold.autonomyLevels.map((a) => (
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
                            toggleMutation.mutate({
                              householdId: selectedHousehold.id,
                              category: a.category,
                              promotionPaused: !v,
                            })
                          }
                          disabled={toggleMutation.isPending}
                          className="scale-75"
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}