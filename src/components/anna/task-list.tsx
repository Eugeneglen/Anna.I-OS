"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAnnaStore } from "@/lib/store";
import { TaskCard } from "./task-card";
import { TaskFiltersBar, applyTaskFilters, DEFAULT_FILTERS, type TaskFilters } from "./task-filters";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchX } from "lucide-react";
import type { Task, TaskStatus } from "@/lib/types";
import { useHouseholdEvents, type HouseholdEvent } from "@/hooks/use-household-events";

const STATUS_GROUPS: { statuses: TaskStatus[]; title: string; emptyText: string; isPredicted?: boolean }[] = [
  {
    statuses: ["PREDICTED"],
    title: "AI Predicted",
    emptyText: "No predicted bookings",
    isPredicted: true,
  },
  {
    statuses: ["CREATED", "MATCHING"],
    title: "Pending",
    emptyText: "No pending tasks",
  },
  {
    statuses: ["ACCEPTED", "SCHEDULED"],
    title: "Confirmed",
    emptyText: "No confirmed bookings",
  },
  {
    statuses: ["IN_PROGRESS"],
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

// ── Event-driven refresh (audit FIX-1b: stale list) ──────────
// The task list used to show stale statuses after vendor-side mutations
// (accept / complete / photo upload / escrow flips) until a manual reload.
// These are the backend event types that change task-facing data — see
// src/lib/events.ts (emitTaskStatusChanged, emitBookingStatusChanged,
// emitWorkCompleted, emitPhotosUploaded, emitEscrowStateChanged,
// emitDisputeRaised/Resolved, emitTaskDispatched).
const TASK_REFRESH_EVENT_PREFIXES = [
  "task:",      // task:status_changed, task:dispatched
  "booking:",   // booking:status_changed (vendor accept/reject/void)
  "work:",      // work:completed
  "photos:",    // photos:uploaded
  "escrow:",    // escrow:state_changed
  "dispute:",   // dispute:raised / dispute:resolved
  "verification:",
] as const;

const REFRESH_DEBOUNCE_MS = 300;

function isTaskRefreshEvent(event: HouseholdEvent): boolean {
  return TASK_REFRESH_EVENT_PREFIXES.some((prefix) => event.type.startsWith(prefix));
}

export function TaskList() {
  const { selectedHouseholdId } = useAnnaStore();
  const queryClient = useQueryClient();
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize filters — consume pending filter from store if set by dashboard cards.
  // NOTE: We read the pending filter via useAnnaStore.getState() (a non-reactive read)
  // in a lazy useState initializer. This runs only on first mount, never during a
  // re-render, so it cannot trigger the "Cannot update a component while rendering a
  // different component" error. The store-clearing is deferred to a useEffect.
  const [filters, setFilters] = useState<TaskFilters>(() => {
    const pending = useAnnaStore.getState().pendingTaskFilter;
    if (pending) {
      return { ...DEFAULT_FILTERS, ...pending };
    }
    return DEFAULT_FILTERS;
  });

  // Clear the consumed pending filter after mount so it doesn't get re-applied
  // if TaskList remounts. Using getState() (not the hook) avoids subscribing to
  // the store here, which would cause re-renders.
  useEffect(() => {
    const pending = useAnnaStore.getState().pendingTaskFilter;
    if (pending) {
      useAnnaStore.getState().setPendingTaskFilter(null);
    }
  }, []);

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks", selectedHouseholdId],
    queryFn: () => fetchTasks(selectedHouseholdId),
    enabled: !!selectedHouseholdId,
  });

  // ── Event-driven refetch ──
  // Listen to the household realtime room (authenticated via the session
  // cookie on the websocket handshake) and invalidate the tasks query when
  // a task-relevant event arrives. Bursts (e.g. dispatch fires
  // task:status_changed + task:dispatched + notification in quick
  // succession) collapse into ONE refetch via a 300 ms debounce. Refetches
  // emit no events, so there is no feedback loop.
  const handleRefreshEvent = useCallback(
    (event: HouseholdEvent) => {
      if (!isTaskRefreshEvent(event)) return;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }, REFRESH_DEBOUNCE_MS);
    },
    [queryClient]
  );

  useHouseholdEvents(selectedHouseholdId || null, {
    enabled: !!selectedHouseholdId,
    onEvent: handleRefreshEvent,
  });

  // Clear any pending debounce timer on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, []);

  // Apply filters client-side
  const filteredTasks = useMemo(
    () => (tasks ? applyTaskFilters(tasks, filters) : []),
    [tasks, filters]
  );

  const handleFiltersChange = useCallback((next: TaskFilters) => {
    setFilters(next);
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        {/* Skeleton for search bar */}
        <Skeleton className="h-10 w-full rounded-xl bg-[var(--anna-border)]" />
        {/* Skeleton for filter row */}
        <div className="flex gap-2">
          <Skeleton className="h-8 w-32 rounded-lg bg-[var(--anna-border)]" />
          <Skeleton className="h-8 w-32 rounded-lg bg-[var(--anna-border)]" />
          <Skeleton className="h-8 w-28 rounded-lg bg-[var(--anna-border)]" />
        </div>
        {/* Skeleton for cards */}
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

  const hasActiveFilters = filteredTasks.length !== tasks.length;

  return (
    <div>
      {/* Filter bar */}
      <TaskFiltersBar
        filters={filters}
        onChange={handleFiltersChange}
        resultCount={filteredTasks.length}
        totalCount={tasks.length}
      />

      {/* No results */}
      {hasActiveFilters && filteredTasks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-[var(--anna-muted)] px-4">
          <SearchX size={32} className="mb-2 opacity-40" />
          <p className="text-sm font-medium">No tasks match your filters</p>
          <p className="text-xs mt-1">Try adjusting your search or filter criteria</p>
        </div>
      )}

      {/* Task groups */}
      <div className="space-y-6 p-4 lg:p-6 pt-3 lg:pt-3">
        {STATUS_GROUPS.map((group) => {
          const groupTasks = filteredTasks.filter((t) =>
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
    </div>
  );
}