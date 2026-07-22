import { create } from "zustand";
import type { TabType, Task, ServiceCategory, TaskStatus } from "./types";
import type { TaskFilters } from "@/components/anna/task-filters";

export interface RebookData {
  category: ServiceCategory;
  instructions: string;
  amountCents: number;
}

interface AnnaStore {
  // Selected household
  selectedHouseholdId: string;
  setSelectedHouseholdId: (id: string) => void;

  // Active tab
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;

  // Selected task for detail view
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;

  // Task detail panel open (mobile sheet)
  taskDetailOpen: boolean;
  setTaskDetailOpen: (open: boolean) => void;

  // Ask Anna chat panel
  askAnnaOpen: boolean;
  setAskAnnaOpen: (open: boolean) => void;

  // Household list cache
  householdNames: Record<string, string>;
  setHouseholdNames: (names: Record<string, string>) => void;

  // Notification panel
  notificationPanelOpen: boolean;
  setNotificationPanelOpen: (open: boolean) => void;

  // Pending task filter (set by Dashboard cards, consumed by Activity tab)
  pendingTaskFilter: Partial<TaskFilters> | null;
  setPendingTaskFilter: (filter: Partial<TaskFilters> | null) => void;

  // Rebook data (set by Dashboard, consumed by Services)
  rebookData: RebookData | null;
  setRebookData: (data: RebookData | null) => void;

  // Helper: select a task and open detail
  openTaskDetail: (task: Task) => void;
  closeTaskDetail: () => void;
}

export const useAnnaStore = create<AnnaStore>((set) => ({
  selectedHouseholdId: "",
  setSelectedHouseholdId: (id) => set({ selectedHouseholdId: id }),

  activeTab: "dashboard",
  setActiveTab: (tab) => set({ activeTab: tab }),

  selectedTaskId: null,
  setSelectedTaskId: (id) => set({ selectedTaskId: id }),

  taskDetailOpen: false,
  setTaskDetailOpen: (open) => set({ taskDetailOpen: open }),

  askAnnaOpen: false,
  setAskAnnaOpen: (open) => set({ askAnnaOpen: open }),

  householdNames: {},
  setHouseholdNames: (names) => set({ householdNames: names }),

  rebookData: null,
  setRebookData: (data) => set({ rebookData: data }),

  notificationPanelOpen: false,
  setNotificationPanelOpen: (open) => set({ notificationPanelOpen: open }),

  pendingTaskFilter: null,
  setPendingTaskFilter: (filter) => set({ pendingTaskFilter: filter }),

  openTaskDetail: (task) =>
    set({ selectedTaskId: task.id, taskDetailOpen: true }),
  closeTaskDetail: () =>
    set({ selectedTaskId: null, taskDetailOpen: false }),
}));