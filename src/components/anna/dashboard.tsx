"use client";

import { useQuery } from "@tanstack/react-query";
import { useAnnaStore } from "@/lib/store";
import { TaskList } from "./task-list";
import { TaskDetailPanel } from "./task-detail";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSgd, type Task, type Household, type HouseholdCategoryAutonomy } from "@/lib/types";
import { Activity, CheckCircle2, Shield, Brain } from "lucide-react";

async function fetchHouseholdDetail(id: string) {
  const res = await fetch(`/api/households/${id}`);
  if (!res.ok) throw new Error("Failed to fetch household");
  return res.json();
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-[var(--anna-white)] rounded-2xl p-4 border border-[var(--anna-border)] hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-xl bg-[var(--anna-sage-light)] flex items-center justify-center">
          <Icon size={16} className="text-[var(--anna-sage-dark)]" />
        </div>
        <span className="text-xs text-[var(--anna-muted)] font-medium">{label}</span>
      </div>
      <p className="font-data text-xl font-bold text-[var(--anna-slate)]">{value}</p>
      {sub && <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">{sub}</p>}
    </div>
  );
}

export function Dashboard() {
  const { selectedHouseholdId, selectedTaskId, setSelectedTaskId } = useAnnaStore();

  const { data, isLoading } = useQuery({
    queryKey: ["household", selectedHouseholdId],
    queryFn: () => fetchHouseholdDetail(selectedHouseholdId),
    enabled: !!selectedHouseholdId,
  });

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-6">
        <Skeleton className="h-8 w-64 rounded-xl bg-[var(--anna-border)]" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl bg-[var(--anna-border)]" />
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-2xl bg-[var(--anna-border)]" />
      </div>
    );
  }

  const household: Household | undefined = data?.household;
  const tasks: Task[] = data?.tasks || [];
  const autonomy: HouseholdCategoryAutonomy[] = data?.categoryAutonomy || [];

  // Compute summary stats
  const activeTasks = tasks.filter(
    (t) => t.status === "CREATED" || t.status === "DISPATCHED" || t.status === "IN_PROGRESS"
  );
  const completedThisMonth = tasks.filter((t) => {
    if (t.status !== "VERIFIED" && t.status !== "ESCROW_RELEASED") return false;
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

  const memberName = "Sarah"; // Phase 1 hardcoded

  return (
    <div className="pb-20 md:pb-0">
      {/* Header */}
      <div className="p-4 lg:p-6 pb-0">
        <h1 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
          Good morning, {memberName}
        </h1>
        {household && (
          <p className="text-sm text-[var(--anna-muted)] mt-0.5">
            {household.name} &middot; {household.address}
          </p>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 lg:p-6">
        <SummaryCard
          icon={Activity}
          label="Active Tasks"
          value={String(activeTasks.length)}
          sub="In progress now"
        />
        <SummaryCard
          icon={CheckCircle2}
          label="Completed"
          value={String(completedThisMonth.length)}
          sub="This month"
        />
        <SummaryCard
          icon={Shield}
          label="Escrow Held"
          value={formatSgd(escrowHeld)}
          sub="Pending release"
        />
        <SummaryCard
          icon={Brain}
          label="Autonomy Level"
          value={avgAutonomy}
          sub="Average across categories"
        />
      </div>

      {/* Task List */}
      {!selectedTaskId ? (
        <TaskList />
      ) : (
        <div className="md:hidden">
          <TaskList />
        </div>
      )}

      {/* Task Detail (desktop: inline below list) */}
      <div className="hidden md:block">
        <TaskDetailPanel />
      </div>

      {/* Task Detail (mobile: sheet) */}
      <div className="md:hidden">
        <TaskDetailPanel />
      </div>
    </div>
  );
}