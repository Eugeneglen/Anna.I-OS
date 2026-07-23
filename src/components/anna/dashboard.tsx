"use client";

import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAnnaStore } from "@/lib/store";
import { AnomalyBanner } from "./anomaly-banner";
import { RebookingPrompt } from "./rebooking-prompt";
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
  Sparkles,
  X,
  Clock,
  Loader2,
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

// ─── Upcoming Item (shared) ────────────────────────────────

interface UpcomingItem {
  dateLabel: string;
  category: string;
  instructions: string;
  statusLabel: string;
  statusColor: string;
  amount: string;
  vendor: string;
  taskId: string;
  isPredicted: boolean;
  lockAt?: string | null;
}

function computeUpcoming(tasks: Task[]): UpcomingItem[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekEnd = new Date(todayStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  weekEnd.setHours(23, 59, 59, 999);

  // 24-hour freshness window for unscheduled tasks.
  const freshnessCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const statusColors: Record<string, string> = {
    PREDICTED: "text-[var(--anna-sage-dark)]",
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

    const isPredicted = t.status === "PREDICTED";

    // Determine reference date: use scheduledStart if set, else createdAt
    const refDate = new Date(t.scheduledStart ?? t.createdAt);

    // Include if: scheduled within next 7 days
    const isInWindow = refDate >= todayStart && refDate <= weekEnd;

    // Unscheduled CREATED tasks: only show if created within last 24 hours
    const isFreshUnscheduled =
      !t.scheduledStart &&
      t.status === "CREATED" &&
      new Date(t.createdAt) >= freshnessCutoff;

    if (!isInWindow && !isFreshUnscheduled) continue;

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
      statusLabel: isPredicted ? "AI Predicted" : STATUS_LABELS[t.status],
      statusColor: statusColors[t.status] ?? "text-[var(--anna-muted)]",
      amount: formatSgd(t.amountCents),
      vendor: t.bookings?.[0]?.vendor?.name ?? "",
      taskId: t.id,
      isPredicted,
      lockAt: t.lockAt,
    });
  }

  // Sort: predicted first (top), then by reference date
  items.sort((a, b) => {
    const tA = tasks.find((t) => t.id === a.taskId)!;
    const tB = tasks.find((t) => t.id === b.taskId)!;
    // Predicted tasks at the top
    if (a.isPredicted !== b.isPredicted) return a.isPredicted ? -1 : 1;
    return new Date(tA.scheduledStart ?? tA.createdAt).getTime() - new Date(tB.scheduledStart ?? tB.createdAt).getTime();
  });

  return items;
}

// ─── Lock Countdown Helper ────────────────────────────────

function getLockCountdown(lockAt: string): { text: string; isUrgent: boolean } {
  const now = new Date();
  const lock = new Date(lockAt);
  const diffMs = lock.getTime() - now.getTime();

  if (diffMs <= 0) return { text: "Locking soon...", isUrgent: true };

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);
  const remainHours = diffHours % 24;

  if (diffDays > 1) {
    return { text: `Editable for ${diffDays}d ${remainHours}h`, isUrgent: false };
  } else if (diffDays === 1) {
    return { text: `Editable for 1d ${remainHours}h`, isUrgent: false };
  } else if (diffHours >= 1) {
    return { text: `Editable for ${diffHours}h`, isUrgent: diffHours <= 6 };
  } else {
    const diffMin = Math.floor(diffMs / (1000 * 60));
    return { text: `Editable for ${diffMin}m`, isUrgent: true };
  }
}

// ─── Cancel Predicted Button ────────────────────────────────

function CancelPredictedButton({
  taskId,
  onCancel,
  isCancelling,
}: {
  taskId: string;
  onCancel: (id: string) => void;
  isCancelling: boolean;
}) {
  return (
    <button
      type="button"
      disabled={isCancelling}
      onClick={(e) => {
        e.stopPropagation();
        onCancel(taskId);
      }}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all shrink-0",
        "border border-[var(--anna-error)]/20 text-[var(--anna-error)]",
        "hover:bg-[var(--anna-error)]/5 disabled:opacity-50"
      )}
      title="Cancel this prediction"
    >
      {isCancelling ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
      Cancel
    </button>
  );
}

// ─── Dashboard Component ─────────────────────────────────────

export function Dashboard() {
  const {
    selectedHouseholdId,
    setActiveTab,
    setPendingTaskFilter,
  } = useAnnaStore();
  const queryClient = useQueryClient();

  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["household", selectedHouseholdId],
    queryFn: () => fetchHouseholdDetail(selectedHouseholdId),
    enabled: !!selectedHouseholdId,
  });

  const navigateToActivity = useCallback((filter: Record<string, unknown>) => {
    setPendingTaskFilter(filter as any);
    setActiveTab("activity");
  }, [setPendingTaskFilter, setActiveTab]);

  const handleCancelPredicted = useCallback(async (taskId: string) => {
    setCancellingId(taskId);
    try {
      const res = await fetch(`/api/tasks/${taskId}/cancel-predictive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Cancelled by household" }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to cancel");
        return;
      }
      // Refetch household data
      queryClient.invalidateQueries({ queryKey: ["household", selectedHouseholdId] });
    } catch {
      alert("Failed to cancel prediction");
    } finally {
      setCancellingId(null);
    }
  }, [queryClient, selectedHouseholdId]);

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

  const memberName = members.length > 0 ? members[0].name.split(" ")[0] : "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // Compute summary stats
  const activeTasks = tasks.filter(
    (t) => t.status === "CREATED" || t.status === "DISPATCHED" || t.status === "IN_PROGRESS"
  );
  const predictedTasks = tasks.filter((t) => t.status === "PREDICTED");
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

  // Predicted items for the dedicated section
  const predictedItems = upcomingItems.filter((i) => i.isPredicted);
  const regularItems = upcomingItems.filter((i) => !i.isPredicted);

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
          onClick={() => setActiveTab("escrow")}
        />
        <SummaryCard
          icon={Brain}
          label="Autonomy Level"
          value={avgAutonomy}
          sub="Average across categories"
          onClick={() => setActiveTab("autonomy")}
        />
      </div>

      {/* ── AI Predicted Bookings ── */}
      {predictedItems.length > 0 && (
        <div className="px-4 lg:px-6 pb-3 lg:pb-4">
          <div className="rounded-2xl border-2 border-[var(--anna-sage)]/30 overflow-hidden bg-gradient-to-br from-[var(--anna-sage-light)]/40 to-[var(--anna-white)]">
            {/* Section header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--anna-sage)]/20">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-[var(--anna-sage)] flex items-center justify-center">
                  <Sparkles size={12} className="text-white" />
                </div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-sage-dark)]">
                  AI Predicted
                </h3>
                <span className="text-[10px] text-[var(--anna-sage-dark)]/70 font-normal normal-case tracking-normal">
                  Pre-booked by Anna.I
                </span>
                <span className="font-data text-[10px] text-[var(--anna-sage-dark)] bg-[var(--anna-sage)]/10 px-1.5 py-0.5 rounded-md">
                  {predictedItems.length}
                </span>
              </div>
            </div>

            {/* Predicted task list */}
            <div className="divide-y divide-[var(--anna-sage)]/10 max-h-72 overflow-y-auto anna-scroll">
              {predictedItems.map((item, idx) => {
                const countdown = item.lockAt ? getLockCountdown(item.lockAt) : null;
                return (
                  <div
                    key={idx}
                    className="px-4 py-3 hover:bg-[var(--anna-sage-light)]/30 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      {/* Date column */}
                      <div className="shrink-0 w-16 pt-0.5">
                        <span className="font-data text-[11px] text-[var(--anna-muted)]">
                          {item.dateLabel}
                        </span>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-[var(--anna-slate)]">
                            {item.category}
                          </span>
                          {/* AI badge */}
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] px-1.5 py-0.5 rounded-md">
                            <Brain size={9} />
                            Predicted
                          </span>
                        </div>
                        {item.instructions && (
                          <p className="text-[11px] text-[var(--anna-muted)] truncate mt-0.5">
                            {item.instructions}
                          </p>
                        )}

                        {/* Lock countdown */}
                        {countdown && (
                          <div className={cn(
                            "flex items-center gap-1 mt-1.5",
                            countdown.isUrgent ? "text-[var(--anna-error)]" : "text-[var(--anna-muted)]"
                          )}>
                            <Clock size={10} />
                            <span className="text-[10px] font-medium">{countdown.text}</span>
                          </div>
                        )}
                      </div>

                      {/* Right column: amount + cancel */}
                      <div className="text-right shrink-0 flex flex-col items-end gap-1.5">
                        <span className="font-data text-xs text-[var(--anna-slate)]">{item.amount}</span>
                        <CancelPredictedButton
                          taskId={item.taskId}
                          onCancel={handleCancelPredicted}
                          isCancelling={cancellingId === item.taskId}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2 border-t border-[var(--anna-sage)]/20">
              <p className="text-[10px] text-[var(--anna-sage-dark)]/60 text-center">
                Based on your booking patterns. Cancel or edit anytime before the lock deadline.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Rebooking Prompt ── */}
      <RebookingPrompt tasks={tasks} />

      {/* Upcoming (Next 7 Days) — Regular tasks only */}
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
              {regularItems.length > 0 && (
                <span className="font-data text-[10px] text-[var(--anna-muted)] bg-[var(--anna-sage-light)] px-1.5 py-0.5 rounded-md">
                  {regularItems.length}
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
          {regularItems.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-xs text-[var(--anna-muted)]">
                {upcomingItems.length === 0
                  ? "No upcoming tasks in the next 7 days"
                  : "All upcoming tasks are shown above"}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--anna-border)] max-h-64 overflow-y-auto anna-scroll">
              {regularItems.slice(0, 5).map((item, idx) => (
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
