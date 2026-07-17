"use client";

import { useQuery } from "@tanstack/react-query";
import { useAnnaStore } from "@/lib/store";
import { AnomalyBanner } from "./anomaly-banner";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSgd, STATUS_LABELS, type Task, type Household, type HouseholdCategoryAutonomy, type TaskStatus, CATEGORY_DEFAULTS } from "@/lib/types";
import {
  Activity,
  CheckCircle2,
  Shield,
  Brain,
  ChevronRight,
  CalendarClock,
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

// ─── Upcoming (Next 7 Days) ────────────────────────────────

interface UpcomingItem {
 dateLabel: string;
 category: string;
 instructions: string;
 statusLabel: string;
 statusColor: string;
 amount: string;
 vendor: string;
 taskId: string;
}

function computeUpcoming(tasks: Task[]): UpcomingItem[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekEnd = new Date(todayStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  weekEnd.setHours(23, 59, 59, 999);

  const statusColors: Record<string, string> = {
    CREATED: "text-[var(--anna-warning)]",
    DISPATCHED: "text-[var(--anna-sage-dark)]",
    IN_PROGRESS: "text-[var(--anna-sage-dark)]",
    COMPLETED: "text-[var(--anna-slate-light)]",
    DISPUTED: "text-[var(--anna-error)]",
  };

  const items: UpcomingItem[] = [];

  for (const t of tasks) {
    // Only include actionable tasks (not verified/escrow released — those are done)
    if (t.status === "VERIFIED" || t.status === "ESCROW_RELEASED") continue;

    const refDate = new Date(t.scheduledStart ?? t.createdAt);

    // Include if: scheduled within next 7 days, or created today without a schedule
    const isInWindow = refDate >= todayStart && refDate <= weekEnd;
    const isUnscheduledCreated = !t.scheduledStart && t.status === "CREATED" && new Date(t.createdAt) >= todayStart;

    if (!isInWindow && !isUnscheduledCreated) continue;

    // Friendly date label
    let dateLabel: string;
    if (refDate.toDateString() === todayStart.toDateString()) {
      dateLabel = "Today";
    } else {
      const tomorrow = new Date(todayStart);
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (refDate.toDateString() === tomorrow.toDateString()) {
        dateLabel = "Tomorrow";
      } else {
        dateLabel = refDate.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
      }
    }

    items.push({
      dateLabel,
      category: CATEGORY_DEFAULTS[t.category]?.label ?? t.category,
      instructions: t.instructions ?? "",
      statusLabel: STATUS_LABELS[t.status],
      statusColor: statusColors[t.status] ?? "text-[var(--anna-muted)]",
      amount: formatSgd(t.amountCents),
      vendor: t.bookings?.[0]?.vendor?.name ?? "",
      taskId: t.id,
    });
  }

  // Sort by reference date, soonest first
  items.sort((a, b) => {
    const tA = tasks.find((t) => t.id === a.taskId)!;
    const tB = tasks.find((t) => t.id === b.taskId)!;
    return new Date(tA.scheduledStart ?? tA.createdAt).getTime() - new Date(tB.scheduledStart ?? tB.createdAt).getTime();
  });

  return items;
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

  // Upcoming (Next 7 Days)
  const upcomingItems = computeUpcoming(tasks);

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

      {/* Upcoming (Next 7 Days) */}
      <div className="px-4 lg:px-6 pb-4 lg:pb-6">
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
          {/* Section header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--anna-border)]">
            <div className="flex items-center gap-2">
              <CalendarClock size={14} className="text-[var(--anna-sage-dark)]" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-slate)]">
                Upcoming
              </h3>
              <span className="text-[10px] text-[var(--anna-muted)] font-normal normal-case tracking-normal">
                Next 7 Days
              </span>
              {upcomingItems.length > 0 && (
                <span className="font-data text-[10px] text-[var(--anna-muted)] bg-[var(--anna-sage-light)] px-1.5 py-0.5 rounded-md">
                  {upcomingItems.length}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                const from = new Date();
                from.setHours(0, 0, 0, 0);
                const to = new Date(from);
                to.setDate(to.getDate() + 7);
                to.setHours(23, 59, 59, 999);
                navigateToActivity({ dateFrom: from, dateTo: to, sort: "newest" });
              }}
              className="flex items-center gap-1 text-[10px] font-medium text-[var(--anna-sage-dark)] hover:text-[var(--anna-sage)] transition-colors"
            >
              View all
              <ArrowRight size={10} />
            </button>
          </div>

          {/* Upcoming list */}
          {upcomingItems.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-[var(--anna-muted)]">No upcoming tasks in the next 7 days</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--anna-border)] max-h-64 overflow-y-auto anna-scroll">
              {upcomingItems.slice(0, 5).map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    navigateToActivity({ search: "" });
                    const task = tasks.find((t) => t.id === item.taskId);
                    if (task) useAnnaStore.getState().openTaskDetail(task);
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-[var(--anna-sage-light)]/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-data text-[11px] text-[var(--anna-muted)] w-16 shrink-0">
                      {item.dateLabel}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--anna-slate)]">{item.category}</span>
                        <span className={cn("text-[10px] font-medium", item.statusColor)}>
                          {item.statusLabel}
                        </span>
                      </div>
                      {item.instructions && (
                        <p className="text-[11px] text-[var(--anna-muted)] truncate mt-0.5">
                          {item.instructions}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-data text-xs text-[var(--anna-slate)]">{item.amount}</span>
                      {item.vendor && (
                        <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">{item.vendor}</p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}