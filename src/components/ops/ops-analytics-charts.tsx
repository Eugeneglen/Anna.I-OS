"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  TrendingUp,
  Users,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────

interface DailyTrendData {
  date: string;
  tasksCreated: number;
  revenueCents: number;
  tasksCompleted: number;
}

interface VendorUtilData {
  vendorId: string;
  vendorName: string;
  total: number;
  completed: number;
  inProgress: number;
  cancelled: number;
}

interface ChartsData {
  dailyTrend: DailyTrendData[];
  vendorUtilization: VendorUtilData[];
}

interface OpsAnalyticsChartsProps {
  charts: ChartsData;
}

// ─── Chart configs ──────────────────────────────────────

const dailyChartConfig: ChartConfig = {
  tasksCreated: {
    label: "Created",
    color: "hsl(152, 20%, 60%)",
  },
  revenue: {
    label: "Revenue",
    color: "hsl(30, 60%, 55%)",
  },
  tasksCompleted: {
    label: "Completed",
    color: "hsl(210, 40%, 60%)",
  },
};

const utilChartConfig: ChartConfig = {
  completed: {
    label: "Completed",
    color: "hsl(152, 30%, 50%)",
  },
  inProgress: {
    label: "In Progress",
    color: "hsl(210, 40%, 60%)",
  },
  cancelled: {
    label: "Cancelled",
    color: "hsl(0, 55%, 55%)",
  },
};

// ─── Helpers ─────────────────────────────────────────────

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
}

function formatCentsShort(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

// ─── Chart Card wrapper ──────────────────────────────────

function ChartCard({
  title,
  subtitle,
  icon: Icon,
  children,
  className,
}: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(
      "bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 lg:p-5",
      className
    )}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-xl bg-[var(--anna-sage-light)] flex items-center justify-center">
          <Icon size={16} className="text-[var(--anna-sage-dark)]" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-[var(--anna-slate)]">{title}</h3>
          <p className="text-[10px] text-[var(--anna-muted)]">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

// ─── 1. 30-Day Revenue & Bookings Trend (Dual-Axis Area) ──

function DailyTrendChart({ data }: { data: DailyTrendData[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--anna-muted)] text-sm">
        No data in the last 30 days
      </div>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    dayLabel: formatDay(d.date),
    revenueDollars: Math.round(d.revenueCents / 100) / 100,
  }));

  const maxRevenue = Math.max(...chartData.map((d) => d.revenueDollars), 1);

  return (
    <ChartContainer config={dailyChartConfig} className="h-64 w-full">
      <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
        <defs>
          <linearGradient id="tasksGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-tasksCreated)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-tasksCreated)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-revenue)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-revenue)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/30" />
        <XAxis
          dataKey="dayLabel"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "var(--anna-muted)" }}
          interval={4}
        />
        <YAxis
          yAxisId="tasks"
          orientation="left"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "var(--anna-muted)" }}
          allowDecimals={false}
        />
        <YAxis
          yAxisId="revenue"
          orientation="right"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "var(--anna-muted)" }}
          tickFormatter={(v) => `$${v}`}
          domain={[0, Math.ceil(maxRevenue) + 5]}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              className="bg-[var(--anna-white)] border-[var(--anna-border)]"
              formatter={(value, name) => (
                <div className="space-y-0.5 min-w-[130px]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[var(--anna-muted)] text-xs">{name}</span>
                    <span className="font-data text-xs font-semibold text-[var(--anna-slate)]">
                      {value}
                    </span>
                  </div>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent className="text-xs" />} />
        <Area
          yAxisId="revenue"
          type="monotone"
          dataKey="revenueDollars"
          stroke="var(--color-revenue)"
          fill="url(#revenueGradient)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
        <Area
          yAxisId="tasks"
          type="monotone"
          dataKey="tasksCreated"
          stroke="var(--color-tasksCreated)"
          fill="url(#tasksGradient)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
        <Area
          yAxisId="tasks"
          type="stepAfter"
          dataKey="tasksCompleted"
          stroke="var(--color-tasksCompleted)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={false}
          fillOpacity={0}
        />
      </AreaChart>
    </ChartContainer>
  );
}

// Summary cards below daily chart
function DailySummary({ data }: { data: DailyTrendData[] }) {
  const totalCreated = data.reduce((s, d) => s + d.tasksCreated, 0);
  const totalCompleted = data.reduce((s, d) => s + d.tasksCompleted, 0);
  const totalRevenue = data.reduce((s, d) => s + d.revenueCents, 0);
  const peakDay = data.reduce((max, d) => d.revenueCents > max.revenueCents ? d : max, data[0]);
  const activeDays = data.filter((d) => d.tasksCreated > 0).length;

  return (
    <div className="grid grid-cols-4 gap-3 mt-4">
      {[
        { label: "Total Tasks", value: totalCreated, sub: `in 30 days` },
        { label: "Completed", value: totalCompleted, sub: `${totalCreated > 0 ? Math.round((totalCompleted / totalCreated) * 100) : 0}% rate` },
        { label: "Revenue", value: formatCentsShort(totalRevenue), sub: "completed tasks" },
        { label: "Peak Day", value: formatCentsShort(peakDay.revenueCents), sub: formatDay(peakDay.date) },
      ].map((item) => (
        <div key={item.label} className="text-center px-2 py-2 rounded-lg bg-[var(--anna-bg)]">
          <p className="font-data text-sm font-bold text-[var(--anna-slate)]">{item.value}</p>
          <p className="text-[10px] text-[var(--anna-muted)]">{item.label}</p>
          <p className="text-[9px] text-[var(--anna-muted)] font-data">{item.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ─── 2. Vendor Utilization (Stacked Bar) ─────────────────

function VendorUtilizationChart({ data }: { data: VendorUtilData[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--anna-muted)] text-sm">
        No bookings in the last 30 days
      </div>
    );
  }

  const chartData = data.map((d) => ({
    name: d.vendorName.length > 14 ? d.vendorName.slice(0, 12) + "…" : d.vendorName,
    fullName: d.vendorName,
    completed: d.completed,
    inProgress: d.inProgress,
    cancelled: d.cancelled,
  }));

  return (
    <ChartContainer config={utilChartConfig} className="h-56 w-full">
      <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border/30" />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "var(--anna-muted)" }}
          tickFormatter={(v) => String(v)}
        />
        <YAxis
          dataKey="name"
          type="category"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "var(--anna-muted)" }}
          width={80}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              className="bg-[var(--anna-white)] border-[var(--anna-border)]"
              formatter={(value, name) => (
                <div className="flex items-center justify-between gap-3 min-w-[120px]">
                  <span className="text-[var(--anna-muted)] text-xs capitalize">{name}</span>
                  <span className="font-data text-xs font-semibold text-[var(--anna-slate)]">{value}</span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent className="text-xs" />} />
        <Bar
          dataKey="completed"
          stackId="a"
          fill="var(--color-completed)"
          radius={[0, 4, 4, 0]}
        />
        <Bar
          dataKey="inProgress"
          stackId="a"
          fill="var(--color-inProgress)"
          radius={[0, 4, 4, 0]}
        />
        <Bar
          dataKey="cancelled"
          stackId="a"
          fill="var(--color-cancelled)"
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ChartContainer>
  );
}

function VendorUtilSummary({ data }: { data: VendorUtilData[] }) {
  const total = data.reduce((s, d) => s + d.total, 0);
  const avgCompletion = total > 0 ? ((data.reduce((s, d) => s + d.completed, 0) / data.length) * 100).toFixed(0) : "0";

  return (
    <div className="grid grid-cols-3 gap-3 mt-4">
      <div className="text-center px-2 py-1.5 rounded-lg bg-[var(--anna-bg)]">
        <p className="font-data text-sm font-bold text-[var(--anna-slate)]">{data.length}</p>
        <p className="text-[10px] text-[var(--anna-muted)]">Active Vendors</p>
      </div>
      <div className="text-center px-2 py-1.5 rounded-lg bg-[var(--anna-bg)]">
        <p className="font-data text-sm font-bold text-[var(--anna-slate)]">{total}</p>
        <p className="text-[10px] text-[var(--anna-muted)]">Total Bookings</p>
      </div>
      <div className="text-center px-2 py-1.5 rounded-lg bg-[var(--anna-bg)]">
        <p className="font-data text-sm font-bold text-[var(--anna-sage-dark)]">{avgCompletion}%</p>
        <p className="text-[10px] text-[var(--anna-muted)]">Avg Completion</p>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────

export function OpsAnalyticsCharts({ charts }: OpsAnalyticsChartsProps) {
  const hasDailyData = charts.dailyTrend.some((d) => d.tasksCreated > 0 || d.revenueCents > 0);
  const hasUtilData = charts.vendorUtilization.length > 0;
  const hasAnyData = hasDailyData || hasUtilData;

  if (!hasAnyData) {
    return (
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-12 text-center">
        <BarChart3 size={32} className="mx-auto mb-3 text-[var(--anna-muted)] opacity-30" />
        <p className="text-sm font-medium text-[var(--anna-muted)]">No chart data yet</p>
        <p className="text-xs text-[var(--anna-muted)] mt-1">
          Charts will appear as tasks and bookings accumulate
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 30-Day Trend */}
        <ChartCard
          title="30-Day Trend"
          subtitle="Tasks created, revenue & completions"
          icon={TrendingUp}
          className={!hasDailyData ? "hidden" : ""}
        >
          <DailyTrendChart data={charts.dailyTrend} />
          <DailySummary data={charts.dailyTrend} />
        </ChartCard>

        {/* Vendor Utilization */}
        <ChartCard
          title="Vendor Utilization"
          subtitle="Booking volume & completion rate (30d)"
          icon={Users}
          className={!hasUtilData ? "hidden" : ""}
        >
          <VendorUtilizationChart data={charts.vendorUtilization} />
          <VendorUtilSummary data={charts.vendorUtilization} />
        </ChartCard>
      </div>
    </div>
  );
}
