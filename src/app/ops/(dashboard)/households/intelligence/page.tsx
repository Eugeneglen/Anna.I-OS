"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Home, Users, AlertCircle, Calendar, MapPin, Sparkles, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OpsPageHeader } from "@/components/ops/ops-page-header";
import { OpsKpiCard } from "@/components/ops/ops-kpi-card";
import {
  HOME_TYPE_LABELS,
  ACQUISITION_LABELS,
  PAIN_POINT_LABELS,
  PET_LABELS,
  FREQUENCY_LABELS,
  MEMBER_LABELS,
  SCHEDULE_LABELS,
} from "@/lib/household-labels";

// ── Types ──

interface IntelligenceData {
  overview: {
    totalHouseholds: number;
    activeSubscriptions: number;
    completedOnboarding: number;
    avgOnboardingStep: number;
    completionRate: number;
  };
  homeTypeDistribution: Record<string, number>;
  acquisitionSources: Record<string, number>;
  painPointsRanking: Array<{ task: string; count: number; percentage: number }>;
  petOwnership: { hasPets: number; noPets: number; types: Record<string, number> };
  serviceFrequency: Record<string, Record<string, number>>;
  memberTypes: Record<string, number>;
  scheduleDistribution: Record<string, number>;
}

// ── Helper: render a distribution bar ──

function DistributionBar({ items, labels }: { items: Record<string, number>; labels: Record<string, string> }) {
  const total = Object.values(items).reduce((sum, n) => sum + n, 0);
  if (total === 0) return <p className="text-xs text-[var(--anna-muted)]">No data</p>;

  return (
    <div className="space-y-1.5">
      {Object.entries(items)
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => {
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs text-[var(--anna-slate-light)] w-32 shrink-0 truncate">
                {labels[key] || key}
              </span>
              <div className="flex-1 h-5 rounded-md bg-[var(--anna-bg)] overflow-hidden">
                <div
                  className="h-full bg-[var(--anna-sage)] rounded-md transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[10px] font-data text-[var(--anna-muted)] w-16 text-right shrink-0">
                {count} ({pct.toFixed(0)}%)
              </span>
            </div>
          );
        })}
    </div>
  );
}

// ── Main Page ──

export default function IntelligenceDashboardPage() {
  const { data, isLoading, isError } = useQuery<IntelligenceData>({
    queryKey: ["ops-household-intelligence"],
    queryFn: async () => {
      const res = await fetch("/api/ops/households/intelligence");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  async function handleBulkExport() {
    try {
      const res = await fetch("/api/ops/households/export-all?format=csv");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `all-households-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // toast handled by caller
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
        <OpsPageHeader title="Intelligence Dashboard" subtitle="Loading..." />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
        <OpsPageHeader title="Intelligence Dashboard" />
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-8 text-center">
          <AlertCircle size={32} className="mx-auto mb-3 text-[var(--anna-muted)]" />
          <p className="text-sm font-medium text-[var(--anna-slate)]">
            Failed to load intelligence data
          </p>
          <p className="text-xs text-[var(--anna-muted)] mt-1">
            Your session may have expired. Please refresh the page or re-login.
          </p>
        </div>
      </div>
    );
  }

  const d = data!;
  const ov = d.overview;

  return (
    <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
      <OpsPageHeader
        title="Intelligence Dashboard"
        subtitle={
          <>
            <span className="font-data">{ov.totalHouseholds}</span> households ·{" "}
            <span className="font-data">{ov.completedOnboarding}</span> onboarded
          </>
        }
        actions={
          <Button
            onClick={handleBulkExport}
            className="rounded-xl bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white"
          >
            <Download size={14} className="mr-1" />
            Export All (CSV)
          </Button>
        }
      />

      {/* Overview KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <OpsKpiCard
          label="Total Households"
          icon={<Home size={16} />}
          cardBg="bg-[var(--anna-white)]"
          iconBg="bg-[var(--anna-sage-light)]"
          iconColor="text-[var(--anna-sage-dark)]"
          amount={ov.totalHouseholds}
          sublabel={`${ov.activeSubscriptions} active subs`}
        />
        <OpsKpiCard
          label="Onboarded"
          icon={<Sparkles size={16} />}
          cardBg="bg-[var(--anna-white)]"
          iconBg="bg-emerald-50"
          iconColor="text-emerald-700"
          amount={ov.completedOnboarding}
          sublabel={`${(ov.completionRate * 100).toFixed(0)}% completion`}
        />
        <OpsKpiCard
          label="Avg Onboarding Step"
          icon={<TrendingUp size={16} />}
          cardBg="bg-[var(--anna-white)]"
          iconBg="bg-[var(--anna-sage-light)]"
          iconColor="text-[var(--anna-sage-dark)]"
          amount={ov.avgOnboardingStep.toFixed(1)}
          sublabel="out of 9 steps"
        />
        <OpsKpiCard
          label="Pet Owners"
          icon={<Users size={16} />}
          cardBg="bg-[var(--anna-white)]"
          iconBg="bg-amber-50"
          iconColor="text-amber-700"
          amount={d.petOwnership.hasPets}
          sublabel={`${ov.totalHouseholds > 0 ? ((d.petOwnership.hasPets / ov.totalHouseholds) * 100).toFixed(0) : 0}% of households`}
        />
      </div>

      {/* Two-column distributions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Home Type Distribution */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3 flex items-center gap-1.5">
            <Home size={12} /> Home Type Distribution
          </h3>
          <DistributionBar items={d.homeTypeDistribution} labels={HOME_TYPE_LABELS} />
        </div>

        {/* Acquisition Sources */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3 flex items-center gap-1.5">
            <MapPin size={12} /> Acquisition Sources
          </h3>
          <DistributionBar items={d.acquisitionSources} labels={ACQUISITION_LABELS} />
        </div>

        {/* Pain Points Ranking */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3 flex items-center gap-1.5">
            <AlertCircle size={12} /> Top Pain Points
          </h3>
          {d.painPointsRanking.length === 0 ? (
            <p className="text-xs text-[var(--anna-muted)]">No pain points recorded</p>
          ) : (
            <div className="space-y-1.5">
              {d.painPointsRanking.map((pp, i) => (
                <div key={pp.task} className="flex items-center gap-2">
                  <span className="text-[10px] font-data text-[var(--anna-muted)] w-4">#{i + 1}</span>
                  <span className="text-xs text-[var(--anna-slate-light)] flex-1 truncate">
                    {PAIN_POINT_LABELS[pp.task] || pp.task}
                  </span>
                  <div className="flex-1 h-4 rounded-md bg-[var(--anna-bg)] overflow-hidden max-w-[100px]">
                    <div
                      className="h-full bg-amber-400 rounded-md"
                      style={{ width: `${pp.percentage * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] font-data text-[var(--anna-muted)] w-12 text-right">
                    {pp.count} ({(pp.percentage * 100).toFixed(0)}%)
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Service Frequency Expectations */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3 flex items-center gap-1.5">
            <Calendar size={12} /> Service Frequency Expectations
          </h3>
          {Object.keys(d.serviceFrequency).length === 0 ? (
            <p className="text-xs text-[var(--anna-muted)]">No service habits recorded</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(d.serviceFrequency).map(([cat, freqs]) => (
                <div key={cat}>
                  <p className="text-[10px] font-medium text-[var(--anna-slate)] mb-1">
                    {cat.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
                  </p>
                  <div className="flex gap-1.5 flex-wrap">
                    {Object.entries(freqs).sort((a, b) => b[1] - a[1]).map(([freq, count]) => (
                      <span
                        key={freq}
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-data bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
                      >
                        {FREQUENCY_LABELS[freq] || freq}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Member Types + Schedule + Pet Types (3-col) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
            Member Types
          </h3>
          <DistributionBar items={d.memberTypes} labels={MEMBER_LABELS} />
        </div>
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
            Schedule
          </h3>
          <DistributionBar items={d.scheduleDistribution} labels={SCHEDULE_LABELS} />
        </div>
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
            Pet Types
          </h3>
          <DistributionBar items={d.petOwnership.types} labels={PET_LABELS} />
        </div>
      </div>
    </div>
  );
}
