"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, TrendingUp, Users, DollarSign, Zap, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──

interface BehaviourData {
  overview: {
    totalHouseholds: number;
    activeCustomers: number;
    lapsedCustomers: number;
    newCustomers: number;
    neverOrdered: number;
    avgOrdersPerHousehold: number;
    avgSpendPerHouseholdCents: number;
    totalRevenueCents: number;
  };
  rfmDistribution: Record<string, number>;
  lapseAnalysis: Record<string, number>;
  categoryUsage: Record<string, number>;
  crossSellOpportunities: Array<{ from: string; to: string; eligibleHouseholds: number }>;
  churnRisk: Record<string, number>;
  lifecycleStages: Record<string, number>;
  insights: Array<{
    type: string;
    title: string;
    detail: string;
    householdIds: string[];
    priority: string;
  }>;
}

// ── Helpers ──

function formatSgd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function DistributionBar({ items, max }: { items: Array<[string, number]>; max: number }) {
  if (items.length === 0 || max === 0) return <p className="text-xs text-[var(--anna-muted)]">No data</p>;
  return (
    <div className="space-y-1.5">
      {items.map(([key, count]) => {
        const pct = max > 0 ? (count / max) * 100 : 0;
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="text-xs text-[var(--anna-slate-light)] w-32 shrink-0 truncate">{key}</span>
            <div className="flex-1 h-5 rounded-md bg-[var(--anna-bg)] overflow-hidden">
              <div className="h-full bg-[var(--anna-sage)] rounded-md transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] font-data text-[var(--anna-muted)] w-12 text-right shrink-0">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

function KpiCard({ label, icon: Icon, iconBg, iconColor, value, sublabel }: {
  label: string;
  icon: typeof Users;
  iconBg: string;
  iconColor: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">{label}</span>
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", iconBg, iconColor)}>
          <Icon size={16} />
        </div>
      </div>
      <p className="text-lg font-bold font-data text-[var(--anna-slate)]">{value}</p>
      {sublabel && <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">{sublabel}</p>}
    </div>
  );
}

// ── Main ──

export function InsightsTab() {
  const { data, isLoading, isError } = useQuery<BehaviourData>({
    queryKey: ["ops-marketing-behaviour"],
    queryFn: async () => {
      const res = await fetch("/api/ops/marketing/behaviour");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-8 text-center">
        <AlertCircle size={32} className="mx-auto mb-3 text-[var(--anna-muted)]" />
        <p className="text-sm font-medium text-[var(--anna-slate)]">Failed to load insights</p>
        <p className="text-xs text-[var(--anna-muted)] mt-1">Your session may have expired.</p>
      </div>
    );
  }

  const ov = data.overview;
  const rfmEntries = Object.entries(data.rfmDistribution).sort((a, b) => b[1] - a[1]);
  const churnEntries = Object.entries(data.churnRisk);
  const lifecycleEntries = Object.entries(data.lifecycleStages);

  return (
    <div className="space-y-4">
      {/* Overview KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total Households" icon={Users} iconBg="bg-[var(--anna-sage-light)]" iconColor="text-[var(--anna-sage-dark)]" value={ov.totalHouseholds} sublabel={`${ov.activeCustomers} active`} />
        <KpiCard label="Avg Orders / HH" icon={TrendingUp} iconBg="bg-[var(--anna-sage-light)]" iconColor="text-[var(--anna-sage-dark)]" value={ov.avgOrdersPerHousehold} sublabel={`${ov.newCustomers} new customers`} />
        <KpiCard label="Avg Spend / HH" icon={DollarSign} iconBg="bg-emerald-50" iconColor="text-emerald-700" value={formatSgd(ov.avgSpendPerHouseholdCents)} sublabel={`${ov.lapsedCustomers} lapsed`} />
        <KpiCard label="Never Ordered" icon={AlertCircle} iconBg="bg-amber-50" iconColor="text-amber-700" value={ov.neverOrdered} sublabel={`${ov.totalHouseholds > 0 ? Math.round((ov.neverOrdered / ov.totalHouseholds) * 100) : 0}% of total`} />
      </div>

      {/* Two-column: RFM + Lapse */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">RFM Segments</h3>
          <DistributionBar items={rfmEntries} max={Math.max(...rfmEntries.map((e) => e[1]), 1)} />
        </div>
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">Lapse Analysis</h3>
          <div className="space-y-2">
            {Object.entries(data.lapseAnalysis).map(([key, count]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-xs text-[var(--anna-slate-light)]">
                  No order in {key.replace("days", " days")}
                </span>
                <span className={cn("text-sm font-data font-bold", count > 0 ? "text-amber-600" : "text-[var(--anna-muted)]")}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Two-column: Churn + Lifecycle */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">Churn Risk</h3>
          <div className="grid grid-cols-2 gap-2">
            {churnEntries.map(([level, count]) => (
              <div key={level} className={cn("rounded-xl p-3 border text-center", level === "CRITICAL" ? "bg-red-50 border-red-200" : level === "HIGH" ? "bg-orange-50 border-orange-200" : level === "MEDIUM" ? "bg-amber-50 border-amber-200" : "bg-emerald-50 border-emerald-200")}>
                <p className={cn("text-xl font-bold font-data", level === "CRITICAL" ? "text-red-600" : level === "HIGH" ? "text-orange-600" : level === "MEDIUM" ? "text-amber-600" : "text-emerald-600")}>{count}</p>
                <p className="text-[10px] text-[var(--anna-muted)] uppercase tracking-wider">{level}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">Lifecycle Stages</h3>
          <DistributionBar items={lifecycleEntries} max={Math.max(...lifecycleEntries.map((e) => e[1]), 1)} />
        </div>
      </div>

      {/* Category Usage + Cross-sell */}
      {data.crossSellOpportunities.length > 0 && (
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3 flex items-center gap-1.5">
            <Zap size={12} /> Cross-Sell Opportunities
          </h3>
          <div className="space-y-1.5">
            {data.crossSellOpportunities.slice(0, 5).map((opp, i) => (
              <div key={i} className="flex items-center justify-between py-1">
                <span className="text-xs text-[var(--anna-slate-light)]">
                  <span className="font-medium">{opp.from}</span> → <span className="font-medium">{opp.to}</span>
                </span>
                <span className="text-xs font-data text-[var(--anna-sage-dark)]">{opp.eligibleHouseholds} eligible</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Insights */}
      {data.insights.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
            <Lightbulb size={12} /> AI Recommendations
          </h3>
          {data.insights.map((ins, i) => (
            <div key={i} className={cn("rounded-2xl border p-4", ins.priority === "HIGH" ? "border-amber-200 bg-amber-50/50" : "border-[var(--anna-border)] bg-[var(--anna-white)]")}>
              <div className="flex items-start gap-3">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", ins.priority === "HIGH" ? "bg-amber-100" : "bg-[var(--anna-sage-light)]")}>
                  <Lightbulb size={14} className={ins.priority === "HIGH" ? "text-amber-600" : "text-[var(--anna-sage-dark)]"} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn("text-[10px] font-bold uppercase tracking-wider", ins.priority === "HIGH" ? "text-amber-600" : "text-[var(--anna-sage-dark)]")}>{ins.type.replace(/_/g, " ")}</span>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", ins.priority === "HIGH" ? "bg-amber-100 text-amber-700" : "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]")}>{ins.priority}</span>
                  </div>
                  <p className="text-sm font-medium text-[var(--anna-slate)] mb-0.5">{ins.title}</p>
                  <p className="text-xs text-[var(--anna-muted)]">{ins.detail}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
