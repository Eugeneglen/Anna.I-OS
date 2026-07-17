"use client";

import { useQuery } from "@tanstack/react-query";
import { useAnnaStore } from "@/lib/store";
import { AnomalyBanner } from "./anomaly-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSgd, type Task, type Household, type HouseholdCategoryAutonomy, type TaskStatus, CATEGORY_DEFAULTS } from "@/lib/types";
import {
  Activity,
  CheckCircle2,
  Shield,
  Brain,
  ChevronRight,
  Clock,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

async function fetchHouseholdDetail(id: string) {
  const res = await fetch(`/api/households/${id}`);
  if (!res.ok) throw new Error("Failed to fetch household");
  return res.json();
}

// ─── Summary Card (clickable) ────────────────────────────────

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left bg-[var(--anna-white)] rounded-2xl p-4 border border-[var(--anna-border)]",
        "hover:shadow-sm hover:border-[var(--anna-sage)]/40 transition-all cursor-pointer select-none group"
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-xl bg-[var(--anna-sage-light)] flex items-center justify-center">
          <Icon size={16} className="text-[var(--anna-sage-dark)]" />
        </div>
        <span className="text-xs text-[var(--anna-muted)] font-medium">{label}</span>
        {onClick && (
          <ChevronRight
            size={14}
            className="ml-auto text-[var(--anna-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
          />
        )}
      </div>
      <p className="font-data text-xl font-bold text-[var(--anna-slate)]">{value}</p>
      {sub && <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">{sub}</p>}
    </button>
  );
}

// ─── Activity Today Event ────────────────────────────────────

interface TodayEvent {
  time: string;
  label: string;
  detail: string;
  category?: string;
  taskId?: string;
  color: string;
}

function computeTodayEvents(tasks: Task[]): TodayEvent[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const events: TodayEvent[] = [];

  const timeStr = (dateStr?: string | null) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (d < todayStart) return "";
    return d.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" });
  };

  for (const t of tasks) {
    const catLabel = CATEGORY_DEFAULTS[t.category]?.label ?? t.category;
    const prefix = catLabel;

    if (t.verifiedAt && new Date(t.verifiedAt) >= todayStart) {
      events.push({
        time: timeStr(t.verifiedAt),
        label: `${prefix} verified`,
        detail: formatSgd(t.amountCents),
        taskId: t.id,
        color: "text-[var(--anna-success)]",
      });
    } else if (t.completedAt && new Date(t.completedAt) >= todayStart) {
      events.push({
        time: timeStr(t.completedAt),
        label: `${prefix} completed`,
        detail: formatSgd(t.amountCents),
        taskId: t.id,
        color: "text-[var(--anna-sage-dark)]",
      });
    } else if (t.inProgressAt && new Date(t.inProgressAt) >= todayStart) {
      events.push({
        time: timeStr(t.inProgressAt),
        label: `${prefix} started`,
        detail: t.bookings?.[0]?.vendor?.name ?? "",
        taskId: t.id,
        color: "text-[var(--anna-sage)]",
      });
    } else if (t.dispatchedAt && new Date(t.dispatchedAt) >= todayStart) {
      events.push({
        time: timeStr(t.dispatchedAt),
        label: `${prefix} dispatched`,
        detail: t.bookings?.[0]?.vendor?.name ?? "",
        taskId: t.id,
        color: "text-[var(--anna-warning)]",
      });
    } else if (t.disputedAt && new Date(t.disputedAt) >= todayStart) {
      events.push({
        time: timeStr(t.disputedAt),
        label: `${prefix} disputed`,
        detail: "",
        taskId: t.id,
        color: "text-[var(--anna-error)]",
      });
    } else if (new Date(t.createdAt) >= todayStart) {
      events.push({
        time: timeStr(t.createdAt),
        label: `${prefix} created`,
        detail: formatSgd(t.amountCents),
        taskId: t.id,
        color: "text-[var(--anna-slate-light)]",
      });
    }
  }

  // Sort by time, most recent first
  events.sort((a, b) => b.time.localeCompare(a.time));
  return events;
}

// ─── Dashboard Component ─────────────────────────────────────

export function Dashboard() {
  const {
    selectedHouseholdId,
    setActiveTab,
    setPendingTaskFilter,
  } = useAnnaStore();

  const { data, isLoading } = useQuery({
    queryKey: ["household", selectedHouseholdId],
    queryFn: () => fetchHouseholdDetail(selectedHouseholdId),
    enabled: !!selectedHouseholdId,
  });

  const navigateToActivity = (filter: Record<string, unknown>) => {
    setPendingTaskFilter(filter as any);
    setActiveTab("activity");
  };

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-6">
        <Skeleton className="h-8 w-64 rounded-xl bg-[var(--anna-border)]" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl bg-[var(--anna-border)]" />
          ))}
        </div>
        <Skeleton className="h-40 w-full rounded-2xl bg-[var(--anna-border)]" />
      </div>
    );
  }

  const household: Household | undefined = data?.household;
  const tasks: Task[] = data?.tasks || [];
  const autonomy: HouseholdCategoryAutonomy[] = data?.categoryAutonomy || [];
  const members: { name: string; role: string }[] = data?.members || [];

  // M-8 FIX: Use actual member name instead of hardcoded "Sarah"
  const memberName = members.length > 0 ? members[0].name.split(" ")[0] : "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // Compute summary stats
  const activeTasks = tasks.filter(
    (t) => t.status === "CREATED" || t.status === "DISPATCHED" || t.status === "IN_PROGRESS"
  );
  const completedTasks = tasks.filter(
    (t) => t.status === "VERIFIED" || t.status === "ESCROW_RELEASED"
  );
  const completedThisMonth = completedTasks.filter((t) => {
    const d = new Date(t.verifiedAt || t.escrowReleasedAt || t.createdAt);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const escrowHeld = tasks.reduce((sum, t) => {
    const entry = t.escrowEntries?.[0];
    if (entry && entry.state === "HELD") return sum + entry.amountCents;
    return sum;
  }, 0);
  const avgAutonomy =
    autonomy.length > 0
      ? (autonomy.reduce((s, a) => s + a.currentLevel, 0) / autonomy.length).toFixed(1)
      : "0.0";

  // Activity Today
  const todayEvents = computeTodayEvents(tasks);

  return (
    <div className="pb-20 md:pb-0">
      {/* Header */}
      <div className="p-4 lg:p-6 pb-0">
        <h1 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
          {greeting}, {memberName}
        </h1>
        {household && (
          <p className="text-sm text-[var(--anna-muted)] mt-0.5">
            {household.name} &middot; {household.address}
          </p>
        )}
      </div>

      {/* Anomaly Alerts */}
      <AnomalyBanner />

      {/* Summary Cards — clickable */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 lg:p-6">
        <SummaryCard
          icon={Activity}
          label="Active Tasks"
          value={String(activeTasks.length)}
          sub="In progress now"
          onClick={() => navigateToActivity({ statuses: ["CREATED", "DISPATCHED", "IN_PROGRESS"] as TaskStatus[] })}
        />
        <SummaryCard
          icon={CheckCircle2}
          label="Completed"
          value={String(completedThisMonth.length)}
          sub="This month"
          onClick={() => navigateToActivity({ statuses: ["COMPLETED", "VERIFIED", "ESCROW_RELEASED"] as TaskStatus[] })}
        />
        <SummaryCard
          icon={Shield}
          label="Escrow Held"
          value={formatSgd(escrowHeld)}
          sub="Pending release"
          onClick={() => navigateToActivity({ statuses: ["VERIFIED"] as TaskStatus[] })}
        />
        <SummaryCard
          icon={Brain}
          label="Autonomy Level"
          value={avgAutonomy}
          sub="Average across categories"
          onClick={() => setActiveTab("autonomy")}
        />
      </div>

      {/* Activity Today */}
      <div className="px-4 lg:px-6 pb-4 lg:pb-6">
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
          {/* Section header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--anna-border)]">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-[var(--anna-sage-dark)]" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-slate)]">
                Activity Today
              </h3>
              {todayEvents.length > 0 && (
                <span className="font-data text-[10px] text-[var(--anna-muted)] bg-[var(--anna-sage-light)] px-1.5 py-0.5 rounded-md">
                  {todayEvents.length}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                navigateToActivity({ dateFrom: today, sort: "newest" });
              }}
              className="flex items-center gap-1 text-[10px] font-medium text-[var(--anna-sage-dark)] hover:text-[var(--anna-sage)] transition-colors"
            >
              View all
              <ArrowRight size={10} />
            </button>
          </div>

          {/* Events list */}
          {todayEvents.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-[var(--anna-muted)]">No activity today yet</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--anna-border)] max-h-48 overflow-y-auto anna-scroll">
              {todayEvents.slice(0, 5).map((event, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    if (event.taskId) {
                      navigateToActivity({ search: "" });
                      // Also select the task for detail view after navigation
                      const task = tasks.find((t) => t.id === event.taskId);
                      if (task) {
                        useAnnaStore.getState().openTaskDetail(task);
                      }
                    }
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-[var(--anna-sage-light)]/30 transition-colors flex items-center gap-3"
                >
                  <span className="font-data text-[10px] text-[var(--anna-muted)] w-12 shrink-0">
                    {event.time}
                  </span>
                  <span className={cn("text-xs font-medium", event.color)}>
                    {event.label}
                  </span>
                  {event.detail && (
                    <span className="text-[10px] text-[var(--anna-muted)] ml-auto shrink-0">
                      {event.detail}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}