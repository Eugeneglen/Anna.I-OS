"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Area,
  AreaChart,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { CategoryIcon, getCategoryLabel } from "@/components/anna/category-icon";
import { formatSgd } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  TrendingUp,
  PieChart as PieChartIcon,
  DollarSign,
  Briefcase,
} from "lucide-react";
import type { ServiceCategory } from "@/lib/types";

// ─── Types ───────────────────────────────────────────────

interface CategoryData {
  category: string;
  earned: number;
  commission: number;
  count: number;
}

interface WeeklyData {
  week: string;
  earned: number;
  jobs: number;
}

interface PayoutData {
  state: string;
  payoutCents: number;
  commissionCents: number;
  count: number;
}

interface ChartsData {
  byCategory: CategoryData[];
  weeklyTrend: WeeklyData[];
  payoutDistribution: PayoutData[];
}

interface EarningsChartsProps {
  charts: ChartsData;
  totalEarned: number;
}

// ─── Color palette for categories (Anna sage theme) ──────

const CATEGORY_COLORS = [
  "hsl(152, 20%, 60%)",   // Cleaning — sage
  "hsl(210, 40%, 60%)",   // Laundry — blue-gray
  "hsl(190, 40%, 55%)",   // Aircon — teal
  "hsl(25, 70%, 60%)",    // Plumbing — orange
  "hsl(45, 60%, 55%)",    // Electrical — amber
  "hsl(340, 50%, 60%)",   // Painting — rose
  "hsl(100, 35%, 50%)",   // Pest Control — green
  "hsl(280, 30%, 55%)",   // Handyman — purple-ish
  "hsl(15, 50%, 55%)",    // Locksmith — warm
  "hsl(170, 30%, 50%)",   // Appliance Repair — sea green
];

const PAYOUT_COLORS: Record<string, string> = {
  HELD: "hsl(45, 70%, 55%)",       // Amber — pending
  RELEASED: "hsl(152, 30%, 45%)",  // Sage — paid
  DISPUTED: "hsl(0, 60%, 60%)",    // Red — disputed
  REFUNDED: "hsl(220, 30%, 55%)", // Slate — refunded
};

const PAYOUT_LABELS: Record<string, string> = {
  HELD: "Pending",
  RELEASED: "Paid Out",
  DISPUTED: "Disputed",
  REFUNDED: "Refunded",
};

// ─── Chart configs ──────────────────────────────────────

const categoryChartConfig: ChartConfig = {
  earned: {
    label: "Payout",
    color: "hsl(152, 20%, 60%)",
  },
  commission: {
    label: "Commission",
    color: "hsl(30, 20%, 75%)",
  },
};

const weeklyChartConfig: ChartConfig = {
  earned: {
    label: "Earned",
    color: "hsl(152, 30%, 50%)",
  },
  jobs: {
    label: "Jobs",
    color: "hsl(152, 20%, 60%)",
  },
};

const payoutChartConfig: ChartConfig = {
  HELD: { label: "Pending", color: "hsl(45, 70%, 55%)" },
  RELEASED: { label: "Paid Out", color: "hsl(152, 30%, 45%)" },
  DISPUTED: { label: "Disputed", color: "hsl(0, 60%, 60%)" },
  REFUNDED: { label: "Refunded", color: "hsl(220, 30%, 55%)" },
};

// ─── Helper: format week label ───────────────────────────

function formatWeekLabel(weekStart: string): string {
  const d = new Date(weekStart + "T00:00:00");
  const day = d.getDate();
  const month = d.toLocaleDateString("en-SG", { month: "short" });
  return `${month} ${day}`;
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

// ─── 1. Earnings by Category (Stacked Bar) ──────────────

function CategoryBarChart({ data }: { data: CategoryData[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--anna-muted)] text-sm">
        No earnings data yet
      </div>
    );
  }

  const chartData = data.map((d) => ({
    name: getCategoryLabel(d.category as ServiceCategory),
    earned: Math.round(d.earned / 100) / 100,  // Convert cents to dollars
    commission: Math.round(d.commission / 100) / 100,
    count: d.count,
  }));

  return (
    <ChartContainer config={categoryChartConfig} className="h-56 w-full">
      <BarChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/30" />
        <XAxis
          dataKey="name"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: "var(--anna-muted)" }}
          interval={0}
          angle={data.length > 5 ? -30 : 0}
          textAnchor={data.length > 5 ? "end" : "middle"}
          height={data.length > 5 ? 60 : 30}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: "var(--anna-muted)" }}
          tickFormatter={(v) => `$${v}`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              className="bg-[var(--anna-white)] border-[var(--anna-border)]"
              formatter={(value, name) => (
                <div className="flex items-center justify-between gap-4 min-w-[120px]">
                  <span className="text-[var(--anna-muted)] text-xs capitalize">{name}</span>
                  <span className="font-data text-xs font-semibold text-[var(--anna-slate)]">
                    SGD ${(value as number).toFixed(2)}
                  </span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent className="text-xs" />} />
        <Bar
          dataKey="earned"
          stackId="a"
          fill="var(--color-earned)"
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="commission"
          stackId="a"
          fill="var(--color-commission)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ChartContainer>
  );
}

// Category summary pills below chart
function CategorySummary({ data }: { data: CategoryData[] }) {
  return (
    <div className="flex flex-wrap gap-2 mt-4">
      {data.slice(0, 6).map((item, i) => (
        <div
          key={item.category}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--anna-bg)] border border-[var(--anna-border)]"
        >
          <CategoryIcon category={item.category as ServiceCategory} size={12} />
          <span className="text-[11px] font-medium text-[var(--anna-slate)]">
            {getCategoryLabel(item.category as ServiceCategory)}
          </span>
          <span className="text-[10px] text-[var(--anna-muted)]">×{item.count}</span>
          <span className="font-data text-[10px] font-semibold text-[var(--anna-sage-dark)]">
            {formatSgd(item.earned)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── 2. Weekly Earnings Trend (Area) ─────────────────────

function WeeklyAreaChart({ data }: { data: WeeklyData[] }) {
  const maxEarned = Math.max(...data.map((d) => d.earned), 1);

  const chartData = data.map((d) => ({
    ...d,
    weekLabel: formatWeekLabel(d.week),
    earnedDollars: Math.round(d.earned / 100) / 100,
  }));

  return (
    <ChartContainer config={weeklyChartConfig} className="h-56 w-full">
      <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
        <defs>
          <linearGradient id="earnedGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-earned)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-earned)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/30" />
        <XAxis
          dataKey="weekLabel"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "var(--anna-muted)" }}
          interval={data.length > 8 ? 2 : 0}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: "var(--anna-muted)" }}
          tickFormatter={(v) => `$${v}`}
          domain={[0, Math.ceil(maxEarned / 100) * 100 + 100]}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              className="bg-[var(--anna-white)] border-[var(--anna-border)]"
              formatter={(value, _name, item) => (
                <div className="space-y-1 min-w-[140px]">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[var(--anna-muted)] text-xs">Earned</span>
                    <span className="font-data text-xs font-semibold text-[var(--anna-slate)]">
                      SGD ${(value as number).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-[var(--anna-muted)] text-xs">Jobs</span>
                    <span className="font-data text-xs font-semibold text-[var(--anna-slate)]">
                      {item.payload.jobs}
                    </span>
                  </div>
                </div>
              )}
            />
          }
        />
        <Area
          type="monotone"
          dataKey="earnedDollars"
          stroke="var(--color-earned)"
          fill="url(#earnedGradient)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </AreaChart>
    </ChartContainer>
  );
}

// Weekly trend summary pills
function WeeklySummary({ data }: { data: WeeklyData[] }) {
  const totalWeeks = data.length;
  const earningWeeks = data.filter((d) => d.earned > 0).length;
  const totalJobs = data.reduce((s, d) => s + d.jobs, 0);
  const peakWeek = data.reduce((max, d) => d.earned > max.earned ? d : max, data[0]);

  return (
    <div className="grid grid-cols-3 gap-3 mt-4">
      <div className="text-center px-2 py-1.5 rounded-lg bg-[var(--anna-bg)]">
        <p className="font-data text-sm font-bold text-[var(--anna-slate)]">{earningWeeks}/{totalWeeks}</p>
        <p className="text-[10px] text-[var(--anna-muted)]">Active Weeks</p>
      </div>
      <div className="text-center px-2 py-1.5 rounded-lg bg-[var(--anna-bg)]">
        <p className="font-data text-sm font-bold text-[var(--anna-slate)]">{totalJobs}</p>
        <p className="text-[10px] text-[var(--anna-muted)]">Total Jobs</p>
      </div>
      <div className="text-center px-2 py-1.5 rounded-lg bg-[var(--anna-bg)]">
        <p className="font-data text-sm font-bold text-[var(--anna-sage-dark)]">
          {formatSgd(peakWeek?.earned || 0)}
        </p>
        <p className="text-[10px] text-[var(--anna-muted)]">Peak Week</p>
      </div>
    </div>
  );
}

// ─── 3. Payout Distribution (Donut) ──────────────────────

function PayoutDonutChart({ data }: { data: PayoutData[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--anna-muted)] text-sm">
        No payout data yet
      </div>
    );
  }

  const totalPayout = data.reduce((s, d) => s + d.payoutCents, 0);
  const totalCommission = data.reduce((s, d) => s + d.commissionCents, 0);

  const chartData = data.map((d) => ({
    name: PAYOUT_LABELS[d.state] || d.state,
    value: Math.round(d.payoutCents / 100) / 100,
    count: d.count,
    fill: PAYOUT_COLORS[d.state] || "hsl(0, 0%, 60%)",
  }));

  return (
    <div className="flex flex-col lg:flex-row items-center gap-6">
      <ChartContainer config={payoutChartConfig} className="h-48 w-48 flex-shrink-0">
        <PieChart>
          <ChartTooltip
            content={
              <ChartTooltipContent
                className="bg-[var(--anna-white)] border-[var(--anna-border)]"
                formatter={(value, _name, item) => (
                  <div className="space-y-1 min-w-[140px]">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs font-medium text-[var(--anna-slate)]">
                        {item.payload.name}
                      </span>
                      <span className="font-data text-xs font-semibold text-[var(--anna-slate)]">
                        SGD ${(value as number).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[var(--anna-muted)] text-xs">Count</span>
                      <span className="font-data text-xs text-[var(--anna-muted)]">
                        {item.payload.count}
                      </span>
                    </div>
                  </div>
                )}
              />
            }
          />
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
            strokeWidth={0}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.fill} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>

      {/* Legend + totals */}
      <div className="flex-1 space-y-3 w-full">
        {data.map((d) => {
          const percentage = totalPayout > 0 ? Math.round((d.payoutCents / totalPayout) * 100) : 0;
          return (
            <div key={d.state} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: PAYOUT_COLORS[d.state] || "hsl(0,0%,60%)" }}
                />
                <span className="text-sm text-[var(--anna-slate)]">
                  {PAYOUT_LABELS[d.state] || d.state}
                </span>
                <span className="text-[10px] text-[var(--anna-muted)]">({d.count})</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-20 h-1.5 rounded-full bg-[var(--anna-border)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${percentage}%`,
                      backgroundColor: PAYOUT_COLORS[d.state] || "hsl(0,0%,60%)",
                    }}
                  />
                </div>
                <span className="font-data text-xs font-semibold text-[var(--anna-slate)] min-w-[60px] text-right">
                  {formatSgd(d.payoutCents)}
                </span>
              </div>
            </div>
          );
        })}

        <div className="pt-2 border-t border-[var(--anna-border)] space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--anna-muted)] flex items-center gap-1">
              <DollarSign size={11} />
              Total Payouts
            </span>
            <span className="font-data font-bold text-[var(--anna-slate)]">{formatSgd(totalPayout)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--anna-muted)] flex items-center gap-1">
              <DollarSign size={11} />
              Platform Commission
            </span>
            <span className="font-data font-medium text-[var(--anna-muted)]">{formatSgd(totalCommission)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────

export function EarningsCharts({ charts, totalEarned }: EarningsChartsProps) {
  const hasCategoryData = charts.byCategory.length > 0;
  const hasWeeklyData = charts.weeklyTrend.some((d) => d.earned > 0 || d.jobs > 0);
  const hasPayoutData = charts.payoutDistribution.length > 0;
  const hasAnyData = hasCategoryData || hasWeeklyData || hasPayoutData;

  if (!hasAnyData) {
    return (
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-12 text-center">
        <BarChart3 size={32} className="mx-auto mb-3 text-[var(--anna-muted)] opacity-30" />
        <p className="text-sm font-medium text-[var(--anna-muted)]">No chart data yet</p>
        <p className="text-xs text-[var(--anna-muted)] mt-1">
          Charts will appear as you complete jobs and earn payouts
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Charts grid: 2-column on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Category breakdown — takes full width on lg */}
        <ChartCard
          title="Earnings by Category"
          subtitle="Payout + commission breakdown"
          icon={Briefcase}
          className={cn("lg:col-span-2", !hasCategoryData && "hidden")}
        >
          <CategoryBarChart data={charts.byCategory} />
          <CategorySummary data={charts.byCategory} />
        </ChartCard>

        {/* Weekly trend */}
        <ChartCard
          title="12-Week Trend"
          subtitle="Weekly earnings over time"
          icon={TrendingUp}
          className={!hasWeeklyData ? "hidden" : ""}
        >
          <WeeklyAreaChart data={charts.weeklyTrend} />
          <WeeklySummary data={charts.weeklyTrend} />
        </ChartCard>

        {/* Payout distribution */}
        <ChartCard
          title="Payout Breakdown"
          subtitle="Distribution by escrow state"
          icon={PieChartIcon}
          className={!hasPayoutData ? "hidden" : ""}
        >
          <PayoutDonutChart data={charts.payoutDistribution} />
        </ChartCard>
      </div>
    </div>
  );
}
