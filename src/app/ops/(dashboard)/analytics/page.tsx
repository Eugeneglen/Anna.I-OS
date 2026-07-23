"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Home,
  Users,
  ClipboardCheck,
  TrendingUp,
  Star,
  Shield,
  DollarSign,
  AlertTriangle,
 ArrowUpRight,
 Activity,
 Trophy,
 ArrowDownRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OpsAnalyticsCharts } from "@/components/ops/ops-analytics-charts";

function formatCents(cents: number) {
  return `$${(cents / 100).toLocaleString("en-SG", { minimumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_COLORS: Record<string, string> = {
  CREATED: "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)]",
  DISPATCHED: "bg-blue-50 text-blue-700",
  IN_PROGRESS: "bg-purple-50 text-purple-700",
  COMPLETED: "bg-[var(--anna-success)]/15 text-[var(--anna-success)]",
  VERIFIED: "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]",
  ESCROW_RELEASED: "bg-emerald-50 text-emerald-700",
  DISPUTED: "bg-red-50 text-red-700",
};

const SEVERITY_DOT: Record<string, string> = {
  CRITICAL: "bg-red-500",
  HIGH: "bg-orange-500",
  MEDIUM: "bg-amber-500",
  LOW: "bg-blue-500",
};

interface KpiData {
  householdCount: number;
  activeVendorCount: number;
  tasksThisMonth: number;
  tasksThisMonthChange: number | null;
  completionRate: number;
  avgRating: number;
  escrowHeldCents: number;
  revenueThisMonthCents: number;
  revenueThisMonthChange: number | null;
  activeAnomalyCount: number;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  trend?: "up" | "down" | "neutral";
  accent?: string;
}) {
  return (
    <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 lg:p-5 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between">
        <div
          className={cn(
            "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
            accent || "bg-[var(--anna-sage-light)]"
          )}
        >
          <Icon
            size={18}
            className={cn(
              accent?.includes("red")
                ? "text-red-600"
                : accent?.includes("amber")
                  ? "text-amber-600"
                  : "text-[var(--anna-sage-dark)]"
            )}
          />
        </div>
        {trend && (
          <span
            className={cn(
              "text-[10px] font-data font-medium flex items-center gap-0.5",
              trend === "up"
                ? "text-[var(--anna-success)]"
                : trend === "down"
                  ? "text-[var(--anna-error)]"
                  : "text-[var(--anna-muted)]"
            )}
          >
            {trend === "up" ? (
              <ArrowUpRight size={10} />
            ) : trend === "down" ? (
              <ArrowDownRight size={10} />
            ) : (
              <Activity size={10} className="opacity-50" />
            )}
          </span>
        )}
      </div>
      <p className="mt-3 font-data text-2xl font-bold text-[var(--anna-slate)] leading-none">
        {value}
      </p>
      <p className="mt-1 text-xs text-[var(--anna-muted)]">{label}</p>
      {sub && (
        <p className="mt-0.5 text-[10px] text-[var(--anna-muted)] font-data">
          {sub}
        </p>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["ops-analytics"],
    queryFn: async () => {
      const res = await fetch("/api/ops/analytics");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4 pb-20 md:pb-0">
        <div>
          <Skeleton className="h-7 w-40 bg-[var(--anna-border)]" />
          <Skeleton className="h-4 w-56 mt-1 bg-[var(--anna-border)]" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-28 rounded-2xl bg-[var(--anna-border)]"
            />
          ))}
        </div>
      </div>
    );
  }

  const kpis: KpiData = data?.kpis || {};
  const tasksByStatus = data?.tasksByStatus || [];
  const tasksByCategory = data?.tasksByCategory || [];
  const vendorPerformance = data?.vendorPerformance || [];
  const recentTasks = data?.recentTasks || [];
  const anomalies = data?.anomalies || [];
  const anomalySeverityCounts = data?.anomalySeverityCounts || {};
  const subscriptionsByTier = data?.subscriptionsByTier || [];

  const maxCategoryCount = Math.max(
    ...tasksByCategory.map((c: { count: number }) => c.count),
    1
  );

  return (
    <div className="space-y-5 pb-20 md:pb-0 anna-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
          Analytics
        </h2>
        <p className="text-sm text-[var(--anna-muted)] mt-0.5">
          Platform overview · Live data
        </p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={Home}
          label="Households"
          value={kpis.householdCount || 0}
          sub={`${subscriptionsByTier.find((s: { tier: string }) => s.tier === "HOME")?.count || 0} HOME · ${subscriptionsByTier.find((s: { tier: string }) => s.tier === "CARE")?.count || 0} CARE`}
        />
        <KpiCard
          icon={Users}
          label="Active Vendors"
          value={kpis.activeVendorCount || 0}
        />
        <KpiCard
          icon={ClipboardCheck}
          label="Tasks This Month"
          value={kpis.tasksThisMonth || 0}
          sub={`${formatCents(kpis.revenueThisMonthCents || 0)} GMV`}
          trend={kpis.tasksThisMonthChange !== null ? (kpis.tasksThisMonthChange >= 0 ? "up" : "down") : undefined}
        />
        <KpiCard
          icon={DollarSign}
          label="Revenue (Month)"
          value={formatCents(kpis.revenueThisMonthCents || 0)}
          sub={kpis.revenueThisMonthChange !== null ? `${kpis.revenueThisMonthChange >= 0 ? "+" : ""}${Math.abs(kpis.revenueThisMonthChange).toFixed(1)}% vs last month` : "completed tasks"}
          trend={kpis.revenueThisMonthChange !== null ? (kpis.revenueThisMonthChange >= 0 ? "up" : "down") : undefined}
        />
        <KpiCard
          icon={TrendingUp}
          label="Completion Rate"
          value={`${kpis.completionRate || 0}%`}
        />
        <KpiCard
          icon={Star}
          label="Avg Rating"
          value={kpis.avgRating || "0.0"}
          sub="across all bookings"
        />
        <KpiCard
          icon={Shield}
          label="Escrow Held"
          value={formatCents(kpis.escrowHeldCents || 0)}
        />
        <KpiCard
          icon={AlertTriangle}
          label="Active Anomalies"
          value={kpis.activeAnomalyCount || 0}
          accent={
            (kpis.activeAnomalyCount || 0) > 0
              ? "bg-red-50"
              : "bg-[var(--anna-sage-light)]"
          }
          sub={
            anomalySeverityCounts.CRITICAL
              ? `${anomalySeverityCounts.CRITICAL} critical`
              : undefined
          }
          trend={
            (kpis.activeAnomalyCount || 0) > 0 ? "down" : "neutral"
          }
        />
      </div>

      {/* Analytics Charts */}
      <OpsAnalyticsCharts charts={data?.charts || { dailyTrend: [], vendorUtilization: [] }} />

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Task Status Distribution */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-5">
          <h3 className="text-sm font-semibold text-[var(--anna-slate)] mb-4">
            Task Status Distribution
          </h3>
          {tasksByStatus.length === 0 ? (
            <p className="text-xs text-[var(--anna-muted)] py-6 text-center">
              No tasks yet
            </p>
          ) : (
            <div className="space-y-2.5">
              {tasksByStatus.map((s: { status: string; count: number }) => {
                const maxCount = Math.max(
                  ...tasksByStatus.map((t: { count: number }) => t.count),
                  1
                );
                return (
                  <div key={s.status} className="flex items-center gap-3">
                    <div className="w-28 shrink-0">
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] font-medium",
                          STATUS_COLORS[s.status] || ""
                        )}
                      >
                        {s.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <div className="flex-1 h-6 bg-[var(--anna-bg)] rounded-lg overflow-hidden">
                      <div
                        className="h-full rounded-lg bg-[var(--anna-sage)]/70 transition-all duration-700"
                        style={{
                          width: `${(s.count / maxCount) * 100}%`,
                          minWidth: s.count > 0 ? "8px" : "0px",
                        }}
                      />
                    </div>
                    <span className="font-data text-xs text-[var(--anna-slate)] w-8 text-right">
                      {s.count}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Category Breakdown */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-5">
          <h3 className="text-sm font-semibold text-[var(--anna-slate)] mb-4">
            Tasks by Category
          </h3>
          {tasksByCategory.length === 0 ? (
            <p className="text-xs text-[var(--anna-muted)] py-6 text-center">
              No tasks yet
            </p>
          ) : (
            <div className="space-y-2">
              {tasksByCategory
                .sort(
                  (a: { count: number }, b: { count: number }) =>
                    b.count - a.count
                )
                .map((c: { category: string; count: number }) => (
                  <div key={c.category} className="flex items-center gap-3">
                    <span className="text-[11px] text-[var(--anna-slate-light)] w-32 shrink-0 truncate">
                      {c.category.replace(/_/g, " ")}
                    </span>
                    <div className="flex-1 h-5 bg-[var(--anna-bg)] rounded-md overflow-hidden">
                      <div
                        className="h-full rounded-md bg-[var(--anna-sage-dark)]/60 transition-all duration-700"
                        style={{
                          width: `${(c.count / maxCategoryCount) * 100}%`,
                          minWidth: c.count > 0 ? "6px" : "0px",
                        }}
                      />
                    </div>
                    <span className="font-data text-xs text-[var(--anna-slate)] w-8 text-right">
                      {c.count}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Vendor Performance + Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Vendor Leaderboard */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Trophy size={15} className="text-[var(--anna-sage-dark)]" />
            <h3 className="text-sm font-semibold text-[var(--anna-slate)]">
              Vendor Leaderboard
            </h3>
          </div>
          {vendorPerformance.length === 0 ? (
            <p className="text-xs text-[var(--anna-muted)] py-6 text-center">
              No completed bookings yet
            </p>
          ) : (
            <div className="space-y-2">
              {vendorPerformance.map(
                (
                  v: {
                    vendorId: string;
                    vendorName: string;
                    completedBookings: number;
                    avgRating: number | null;
                  },
                  i: number
                ) => (
                  <div
                    key={v.vendorId}
                    className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-[var(--anna-sage-light)]/30 transition-colors"
                  >
                    <span className="font-data text-xs text-[var(--anna-muted)] w-5 text-center">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--anna-slate)] truncate">
                        {v.vendorName}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-data text-xs text-[var(--anna-slate)]">
                        {v.completedBookings}
                      </p>
                      <p className="text-[10px] text-[var(--anna-muted)]">
                        completed
                      </p>
                    </div>
                    {v.avgRating && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Star
                          size={12}
                          className="text-amber-500 fill-amber-500"
                        />
                        <span className="font-data text-xs text-[var(--anna-slate)]">
                          {v.avgRating}
                        </span>
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          )}
        </div>

        {/* Recent Activity Feed */}
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={15} className="text-[var(--anna-sage-dark)]" />
            <h3 className="text-sm font-semibold text-[var(--anna-slate)]">
              Recent Tasks
            </h3>
          </div>
          {recentTasks.length === 0 ? (
            <p className="text-xs text-[var(--anna-muted)] py-6 text-center">
              No tasks yet
            </p>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto anna-scroll">
              {recentTasks.map(
                (t: {
                  id: string;
                  category: string;
                  status: string;
                  amountCents: number;
                  createdAt: string;
                  household: { name: string };
                }) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-[var(--anna-bg)] transition-colors"
                  >
                    <div className="w-2 h-2 rounded-full shrink-0 bg-[var(--anna-sage-dark)]" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[var(--anna-slate)] truncate">
                        <span className="font-medium">
                          {t.household.name}
                        </span>{" "}
                        — {t.category.replace(/_/g, " ")}
                      </p>
                      <p className="text-[10px] text-[var(--anna-muted)]">
                        {formatDate(t.createdAt)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px]",
                          STATUS_COLORS[t.status] || ""
                        )}
                      >
                        {t.status.replace(/_/g, " ")}
                      </Badge>
                      <p className="font-data text-[10px] text-[var(--anna-muted)] mt-0.5">
                        {formatCents(t.amountCents || 0)}
                      </p>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* Active Anomalies */}
      {anomalies.length > 0 && (
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle
              size={15}
              className={cn(
                anomalySeverityCounts.CRITICAL
                  ? "text-red-500"
                  : "text-amber-500"
              )}
            />
            <h3 className="text-sm font-semibold text-[var(--anna-slate)]">
              Active Anomalies
            </h3>
            <span className="font-data text-[10px] text-[var(--anna-muted)]">
              {anomalies.length} total
            </span>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto anna-scroll">
            {anomalies.slice(0, 8).map(
              (a: {
                id: string;
                type: string;
                severity: string;
                createdAt: string;
              }) => (
                <div
                  key={a.id}
                  className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-[var(--anna-bg)] transition-colors"
                >
                  <div
                    className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      SEVERITY_DOT[a.severity] || "bg-gray-400"
                    )}
                  />
                  <span className="text-xs font-medium text-[var(--anna-slate)] capitalize">
                    {a.type.replace(/_/g, " ")}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      a.severity === "CRITICAL"
                        ? "text-red-600 border-red-200"
                        : a.severity === "HIGH"
                          ? "text-orange-600 border-orange-200"
                          : "text-amber-600 border-amber-200"
                    )}
                  >
                    {a.severity}
                  </Badge>
                  <span className="ml-auto text-[10px] text-[var(--anna-muted)] font-data">
                    {formatDate(a.createdAt)}
                  </span>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}