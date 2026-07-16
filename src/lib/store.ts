import { create } from "zustand";
import type { TabType, Task, ServiceCategory } from "./types";

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

  openTaskDetail: (task) =>
    set({ selectedTaskId: task.id, taskDetailOpen: true }),
  closeTaskDetail: () =>
    set({ selectedTaskId: null, taskDetailOpen: false }),
}));