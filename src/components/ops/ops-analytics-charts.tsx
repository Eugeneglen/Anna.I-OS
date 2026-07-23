"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Line,
  LineChart,
  Pie,
  PieChart,
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
import { cn } from "@/lib/utils";
import {
  BarChart3,
  TrendingUp,
  Users,
  PieChart as PieChartIcon,
  CalendarDays,
  Target,
} from "lucide-react";
import { CategoryIcon, getCategoryLabel } from "@/components/anna/category-icon";
import type { ServiceCategory } from "@/lib/types";

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

interface CategoryBreakdownData {
  category: string;
  revenueCents: number;
  count: number;
}

interface DayOfWeekData {
  day: string;
  dayIndex: number;
  tasks: number;
  bookings: number;
  revenueCents: number;
}

interface CompletionTrendData {
  week: string;
  created: number;
  completed: number;
}

interface ChartsData {
  dailyTrend: DailyTrendData[];
  vendorUtilization: VendorUtilData[];
  categoryBreakdown: CategoryBreakdownData[];
  dayOfWeekPattern: DayOfWeekData[];
  completionTrend: CompletionTrendData[];
}

interface OpsAnalyticsChartsProps {
  charts: ChartsData;
}

// ─── Color palettes ──────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  CLEANING: "hsl(152, 30%, 50%)",
  LAUNDRY: "hsl(38, 70%, 55%)",
  AIRCON: "hsl(195, 50%, 50%)",
  PLUMBING: "hsl(210, 50%, 55%)",
  ELECTRICAL: "hsl(45, 65%, 55%)",
  PAINTING: "hsl(345, 55%, 55%)",
  PEST_CONTROL: "hsl(110, 40%, 45%)",
  HANDYMAN: "hsl(30, 15%, 50%)",
  LOCKSMITH: "hsl(270, 40%, 55%)",
  APPLIANCE_REPAIR: "hsl(20, 60%, 55%)",
};

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

const dowChartConfig: ChartConfig = {
  tasks: {
    label: "Tasks",
    color: "hsl(152, 30%, 50%)",
  },
  bookings: {
    label: "Bookings",
    color: "hsl(30, 50%, 60%)",
  },
};

const completionChartConfig: ChartConfig = {
  created: {
    label: "Created",
    color: "hsl(210, 40%, 60%)",
  },
  completed: {
    label: "Completed",
    color: "hsl(152, 30%, 50%)",
  },
  rate: {
    label: "Completion %",
    color: "hsl(30, 60%, 55%)",
  },
};

// ─── Helpers ─────────────────────────────────────────────

function formatDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
}

function formatWeekLabel(weekStart: string): string {
  const d = new Date(weekStart + "T00:00:00");
  const day = d.getDate();
  const month = d.toLocaleDateString("en-SG", { month: "short" });
  return `${month} ${day}`;
}

function formatCentsShort(cents: number): string {
  if (cents >= 10000) return `$${(cents / 100).toLocaleString("en-SG", { maximumFractionDigits: 0 })}`;
  return `$${(cents / 100).toFixed(1)}`;
}

function formatCentsDollar(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
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

// ─── 3. Category Revenue Breakdown (Donut) ──────────────

function CategoryDonutChart({ data }: { data: CategoryBreakdownData[] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--anna-muted)] text-sm">
        No completed tasks yet
      </div>
    );
  }

  const totalRevenue = data.reduce((s, d) => s + d.revenueCents, 0);
  const totalTasks = data.reduce((s, d) => s + d.count, 0);

  const chartData = data.map((d) => ({
    name: getCategoryLabel(d.category as ServiceCategory),
    value: Math.round(d.revenueCents / 100) / 100,
    count: d.count,
    fill: CATEGORY_COLORS[d.category] || "hsl(0, 0%, 60%)",
  }));

  return (
    <div className="flex flex-col lg:flex-row items-center gap-6">
      <ChartContainer config={{}} className="h-48 w-48 flex-shrink-0">
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
                        {formatCentsDollar((value as number) * 100)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-[var(--anna-muted)] text-xs">Tasks</span>
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
        {data.slice(0, 6).map((d) => {
          const percentage = totalRevenue > 0 ? Math.round((d.revenueCents / totalRevenue) * 100) : 0;
          const color = CATEGORY_COLORS[d.category] || "hsl(0, 0%, 60%)";
          return (
            <div key={d.category} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <CategoryIcon category={d.category as ServiceCategory} size={11} />
                <span className="text-sm text-[var(--anna-slate)]">
                  {getCategoryLabel(d.category as ServiceCategory)}
                </span>
                <span className="text-[10px] text-[var(--anna-muted)]">({d.count})</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-16 h-1.5 rounded-full bg-[var(--anna-border)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${percentage}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
                <span className="font-data text-xs font-semibold text-[var(--anna-slate)] min-w-[55px] text-right">
                  {formatCentsShort(d.revenueCents)}
                </span>
              </div>
            </div>
          );
        })}

        <div className="pt-2 border-t border-[var(--anna-border)] space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--anna-muted)]">Total Revenue</span>
            <span className="font-data font-bold text-[var(--anna-slate)]">{formatCentsDollar(totalRevenue)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-[var(--anna-muted)]">Categories</span>
            <span className="font-data font-medium text-[var(--anna-muted)]">{data.length} active · {totalTasks} tasks</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 4. Day-of-Week Pattern (Grouped Bar) ──────────────────

function DayOfWeekChart({ data }: { data: DayOfWeekData[] }) {
  if (data.every((d) => d.tasks === 0)) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--anna-muted)] text-sm">
        No task data yet
      </div>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    revenueDollars: Math.round(d.revenueCents / 100) / 100,
  }));

  return (
    <ChartContainer config={dowChartConfig} className="h-56 w-full">
      <BarChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/30" />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: "var(--anna-muted)" }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "var(--anna-muted)" }}
          allowDecimals={false}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              className="bg-[var(--anna-white)] border-[var(--anna-border)]"
              formatter={(value, name, item) => (
                <div className="space-y-0.5 min-w-[130px]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[var(--anna-muted)] text-xs capitalize">{name}</span>
                    <span className="font-data text-xs font-semibold text-[var(--anna-slate)]">{value}</span>
                  </div>
                  {(name === "Tasks") && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[var(--anna-muted)] text-xs">Revenue</span>
                      <span className="font-data text-xs text-[var(--anna-slate)]">
                        {formatCentsDollar((item.payload.revenueCents as number))}
                      </span>
                    </div>
                  )}
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent className="text-xs" />} />
        <Bar
          dataKey="tasks"
          fill="var(--color-tasks)"
          radius={[4, 4, 0, 0]}
        />
        <Bar
          dataKey="bookings"
          fill="var(--color-bookings)"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ChartContainer>
  );
}

function DayOfWeekSummary({ data }: { data: DayOfWeekData[] }) {
  const busiestDay = data.reduce((max, d) => d.tasks > max.tasks ? d : max, data[0]);
  const quietestDay = data.reduce((min, d) => d.tasks < min.tasks ? d : min, data[0]);
  const weekdayTasks = data.slice(0, 5).reduce((s, d) => s + d.tasks, 0);
  const weekendTasks = data.slice(5).reduce((s, d) => s + d.tasks, 0);

  return (
    <div className="grid grid-cols-3 gap-3 mt-4">
      <div className="text-center px-2 py-1.5 rounded-lg bg-[var(--anna-bg)]">
        <p className="font-data text-sm font-bold text-[var(--anna-slate)]">{busiestDay.day}</p>
        <p className="text-[10px] text-[var(--anna-muted)]">Busiest Day</p>
        <p className="text-[9px] text-[var(--anna-muted)] font-data">{busiestDay.tasks} tasks</p>
      </div>
      <div className="text-center px-2 py-1.5 rounded-lg bg-[var(--anna-bg)]">
        <p className="font-data text-sm font-bold text-[var(--anna-slate)]">{weekdayTasks + weekendTasks > 0 ? Math.round((weekendTasks / (weekdayTasks + weekendTasks)) * 100) : 0}%</p>
        <p className="text-[10px] text-[var(--anna-muted)]">Weekend Share</p>
        <p className="text-[9px] text-[var(--anna-muted)] font-data">{weekendTasks} tasks</p>
      </div>
      <div className="text-center px-2 py-1.5 rounded-lg bg-[var(--anna-bg)]">
        <p className="font-data text-sm font-bold text-[var(--anna-sage-dark)]">{quietestDay.day}</p>
        <p className="text-[10px] text-[var(--anna-muted)]">Quietest Day</p>
        <p className="text-[9px] text-[var(--anna-muted)] font-data">{quietestDay.tasks} tasks</p>
      </div>
    </div>
  );
}

// ─── 5. Weekly Completion Trend (Dual-Line) ──────────────

function CompletionTrendChart({ data }: { data: CompletionTrendData[] }) {
  if (data.every((d) => d.created === 0)) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--anna-muted)] text-sm">
        No tasks in the last 12 weeks
      </div>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    weekLabel: formatWeekLabel(d.week),
    rate: d.created > 0 ? Math.round((d.completed / d.created) * 100) : 0,
  }));

  const maxRate = Math.max(...chartData.map((d) => d.rate), 100);

  return (
    <ChartContainer config={completionChartConfig} className="h-56 w-full">
      <LineChart data={chartData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
        <defs>
          <linearGradient id="rateGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-rate)" stopOpacity={0.15} />
            <stop offset="95%" stopColor="var(--color-rate)" stopOpacity={0} />
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
          yAxisId="tasks"
          orientation="left"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "var(--anna-muted)" }}
          allowDecimals={false}
        />
        <YAxis
          yAxisId="rate"
          orientation="right"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "var(--anna-muted)" }}
          tickFormatter={(v) => `${v}%`}
          domain={[0, Math.max(maxRate + 10, 100)]}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              className="bg-[var(--anna-white)] border-[var(--anna-border)]"
              formatter={(value, name, item) => (
                <div className="space-y-0.5 min-w-[130px]">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[var(--anna-muted)] text-xs capitalize">{name}</span>
                    <span className="font-data text-xs font-semibold text-[var(--anna-slate)]">
                      {name === "Completion %" ? `${value}%` : String(value)}
                    </span>
                  </div>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent className="text-xs" />} />
        <Line
          yAxisId="tasks"
          type="monotone"
          dataKey="created"
          stroke="var(--color-created)"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
        <Line
          yAxisId="tasks"
          type="monotone"
          dataKey="completed"
          stroke="var(--color-completed)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
        <Area
          yAxisId="rate"
          type="monotone"
          dataKey="rate"
          stroke="var(--color-rate)"
          fill="url(#rateGradient)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0 }}
        />
      </LineChart>
    </ChartContainer>
  );
}

function CompletionTrendSummary({ data }: { data: CompletionTrendData[] }) {
  const totalCreated = data.reduce((s, d) => s + d.created, 0);
  const totalCompleted = data.reduce((s, d) => s + d.completed, 0);
  const overallRate = totalCreated > 0 ? Math.round((totalCompleted / totalCreated) * 100) : 0;
  const bestWeek = data.reduce((max, d) => {
    const r = d.created > 0 ? (d.completed / d.created) * 100 : 0;
    const maxR = max.created > 0 ? (max.completed / max.created) * 100 : 0;
    return r > maxR ? d : max;
  }, data[0]);

  return (
    <div className="grid grid-cols-3 gap-3 mt-4">
      <div className="text-center px-2 py-1.5 rounded-lg bg-[var(--anna-bg)]">
        <p className="font-data text-sm font-bold text-[var(--anna-slate)]">{overallRate}%</p>
        <p className="text-[10px] text-[var(--anna-muted)]">Overall Rate</p>
      </div>
      <div className="text-center px-2 py-1.5 rounded-lg bg-[var(--anna-bg)]">
        <p className="font-data text-sm font-bold text-[var(--anna-slate)]">{totalCompleted}/{totalCreated}</p>
        <p className="text-[10px] text-[var(--anna-muted)]">Completed / Created</p>
      </div>
      <div className="text-center px-2 py-1.5 rounded-lg bg-[var(--anna-bg)]">
        <p className="font-data text-sm font-bold text-[var(--anna-sage-dark)]">{formatWeekLabel(bestWeek.week)}</p>
        <p className="text-[10px] text-[var(--anna-muted)]">Best Week</p>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────

export function OpsAnalyticsCharts({ charts }: OpsAnalyticsChartsProps) {
  const hasDailyData = charts.dailyTrend.some((d) => d.tasksCreated > 0 || d.revenueCents > 0);
  const hasUtilData = charts.vendorUtilization.length > 0;
  const hasCategoryData = charts.categoryBreakdown.length > 0;
  const hasDowData = charts.dayOfWeekPattern.some((d) => d.tasks > 0);
  const hasCompletionData = charts.completionTrend.some((d) => d.created > 0);
  const hasAnyData = hasDailyData || hasUtilData || hasCategoryData || hasDowData || hasCompletionData;

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
      {/* Row 1: 30-Day Trend + Vendor Utilization */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="30-Day Trend"
          subtitle="Tasks created, revenue & completions"
          icon={TrendingUp}
          className={!hasDailyData ? "hidden" : ""}
        >
          <DailyTrendChart data={charts.dailyTrend} />
          <DailySummary data={charts.dailyTrend} />
        </ChartCard>

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

      {/* Row 2: Category Donut + Day-of-Week Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard
          title="Revenue by Category"
          subtitle="All-time completed task revenue"
          icon={PieChartIcon}
          className={!hasCategoryData ? "hidden" : ""}
        >
          <CategoryDonutChart data={charts.categoryBreakdown} />
        </ChartCard>

        <ChartCard
          title="Day-of-Week Pattern"
          subtitle="Task & booking volume by weekday"
          icon={CalendarDays}
          className={!hasDowData ? "hidden" : ""}
        >
          <DayOfWeekChart data={charts.dayOfWeekPattern} />
          <DayOfWeekSummary data={charts.dayOfWeekPattern} />
        </ChartCard>
      </div>

      {/* Row 3: Completion Trend (full width) */}
      <ChartCard
        title="Completion Pipeline"
        subtitle="12-week created vs completed + completion rate"
        icon={Target}
        className={!hasCompletionData ? "hidden" : ""}
      >
        <CompletionTrendChart data={charts.completionTrend} />
        <CompletionTrendSummary data={charts.completionTrend} />
      </ChartCard>
    </div>
  );
}
