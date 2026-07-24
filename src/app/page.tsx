"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LayoutShell } from "@/components/anna/layout-shell";
import { Dashboard } from "@/components/anna/dashboard";
import { TaskServices } from "@/components/anna/task-services";
import { AutonomyPanel } from "@/components/anna/autonomy-panel";
import { ActivityTab } from "@/components/anna/activity-tab";
import { EscrowPanel } from "@/components/anna/escrow-panel";
import { SettingsPanel } from "@/components/anna/settings-panel";
import { OnboardingWizard, type OnboardingHousehold } from "@/components/anna/onboarding-wizard";
import { useAnnaStore } from "@/lib/store";
import { AnimatePresence, motion } from "framer-motion";

const VIEWS: Record<string, React.ComponentType> = {
  dashboard: Dashboard,
  services: TaskServices,
  autonomy: AutonomyPanel,
  activity: ActivityTab,
  escrow: EscrowPanel,
  settings: SettingsPanel,
};

async function fetchSession() {
  const res = await fetch("/api/household/session");
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

async function fetchHouseholdDetail(id: string) {
  const res = await fetch(`/api/households/${id}`);
  if (!res.ok) throw new Error("Failed to fetch household");
  return res.json();
}

export default function Home() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { selectedHouseholdId, activeTab } = useAnnaStore();
  const ActiveView = VIEWS[activeTab];

  // Check auth session
  const { data: sessionData, isLoading: sessionLoading, isError: sessionError } = useQuery({
    queryKey: ["household-session"],
    queryFn: fetchSession,
    retry: false,
    staleTime: 60_000,
  });

  // Redirect if not authenticated
  useEffect(() => {
    if (!sessionLoading && !sessionData?.authenticated) {
      router.push("/login");
    }
  }, [sessionLoading, sessionData, router]);

  // Fetch household detail to check onboarding status
  const { data: householdData, isLoading: householdLoading } = useQuery({
    queryKey: ["household", selectedHouseholdId],
    queryFn: () => fetchHouseholdDetail(selectedHouseholdId),
    enabled: !!selectedHouseholdId,
    staleTime: 30_000,
  });

  const household: OnboardingHousehold | undefined = householdData?.household;
  const needsOnboarding = household && household.onboardingStep < 8;

  // When onboarding completes, refetch
  const handleOnboardingComplete = () => {
    queryClient.invalidateQueries({ queryKey: ["household", selectedHouseholdId] });
    queryClient.invalidateQueries({ queryKey: ["household-session"] });
  };

  // Loading state
  if (sessionLoading || !sessionData?.authenticated) {
    return (
      <LayoutShell>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="flex flex-col items-center gap-3">
            <img src="/brain-icon.png" alt="Anna.I" className="w-8 h-8 animate-pulse" />
            <p className="text-sm text-[var(--anna-muted)]">Loading your household...</p>
          </div>
        </div>
      </LayoutShell>
    );
  }

  // Show onboarding wizard for households that haven't completed setup
  if (needsOnboarding) {
    return (
      <OnboardingWizard
        household={household}
        onComplete={handleOnboardingComplete}
      />
    );
  }

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
