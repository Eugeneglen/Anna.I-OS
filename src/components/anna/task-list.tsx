"use client";

import { useQuery } from "@tanstack/react-query";
import { useAnnaStore } from "@/lib/store";
import { TaskCard } from "./task-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Task, TaskStatus } from "@/lib/types";

const STATUS_GROUPS: { statuses: TaskStatus[]; title: string; emptyText: string }[] = [
  {
    statuses: ["CREATED"],
    title: "Awaiting Dispatch",
    emptyText: "No pending tasks",
  },
  {
    statuses: ["DISPATCHED", "IN_PROGRESS"],
    title: "In Progress",
    emptyText: "No active jobs",
  },
  {
    statuses: ["COMPLETED", "VERIFIED", "ESCROW_RELEASED"],
    title: "Completed",
    emptyText: "No completed tasks",
  },
  {
    statuses: ["DISPUTED"],
    title: "Disputed",
    emptyText: "No disputes",
  },
];

async function fetchTasks(householdId: string): Promise<Task[]> {
  const res = await fetch(`/api/tasks?householdId=${householdId}`);
  if (!res.ok) throw new Error("Failed to fetch tasks");
  const data = await res.json();
  return data.tasks;
}

export function TaskList() {
  const { selectedHouseholdId } = useAnnaStore();

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks", selectedHouseholdId],
    queryFn: () => fetchTasks(selectedHouseholdId),
    enabled: !!selectedHouseholdId,
  });

  if (isLoading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        {[1, 2, 3].map((i) => (
          <Skeleton
            key={i}
            className="h-24 w-full rounded-2xl bg-[var(--anna-border)]"
          />
        ))}
      </div>
    );
  }

  if (!tasks || tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[var(--anna-muted)]">
        <p className="text-sm">No tasks yet</p>
        <p className="text-xs mt-1">Create your first task to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 lg:p-6">
      {STATUS_GROUPS.map((group) => {
        const groupTasks = tasks.filter((t) =>
          group.statuses.includes(t.status)
        );

        if (groupTasks.length === 0) return null;

        return (
          <div key={group.title}>
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                {group.title}
              </h3>
              <span className="font-data text-[10px] text-[var(--anna-muted)] bg-[var(--anna-sage-light)] px-1.5 py-0.5 rounded-md">
                {groupTasks.length}
              </span>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto anna-scroll">
              {groupTasks.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}