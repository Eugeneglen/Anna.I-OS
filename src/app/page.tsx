"use client";

import { LayoutShell } from "@/components/anna/layout-shell";
import { Dashboard } from "@/components/anna/dashboard";
import { TaskServices } from "@/components/anna/task-services";
import { AutonomyPanel } from "@/components/anna/autonomy-panel";
import { ActivityTab } from "@/components/anna/activity-tab";
import { SettingsPanel } from "@/components/anna/settings-panel";
import { useAnnaStore } from "@/lib/store";
import { AnimatePresence, motion } from "framer-motion";

const VIEWS: Record<string, React.ComponentType> = {
  dashboard: Dashboard,
  services: TaskServices,
  autonomy: AutonomyPanel,
  activity: ActivityTab,
  settings: SettingsPanel,
};

export default function Home() {
  const { activeTab } = useAnnaStore();
  const ActiveView = VIEWS[activeTab];

  return (
    <LayoutShell>
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="min-h-[calc(100vh-3.5rem)] md:min-h-[calc(100vh-3.5rem-3.25rem)]"
        >
          <ActiveView />
        </motion.div>
      </AnimatePresence>
    </LayoutShell>
  );
}