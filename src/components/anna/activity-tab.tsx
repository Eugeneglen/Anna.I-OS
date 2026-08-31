"use client";

import { TaskList } from "./task-list";
import { TaskDetailPanel } from "./task-detail";

export function ActivityTab() {
  return (
    <div className="pb-24 md:pb-0">
      <TaskList />
      <TaskDetailPanel />
    </div>
  );
}