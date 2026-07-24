"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, LayoutDashboard, Layers, Brain, ListChecks, Landmark, Settings, Home, LogOut, User } from "lucide-react";
import { useAnnaStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { TabType, Household } from "@/lib/types";
import { AskAnna } from "@/components/anna/ask-anna";
import { NotificationPanel } from "@/components/anna/notification-panel";
import { RealtimeToasts } from "@/components/anna/realtime-toasts";

const TABS: { key: TabType; label: string; icon: React.ElementType }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "services", label: "Services", icon: Layers },
  { key: "autonomy", label: "Autonomy", icon: Brain },
  { key: "activity", label: "Activity", icon: ListChecks },
  { key: "escrow", label: "Escrow", icon: Landmark },
];

async function fetchSession() {
  const res = await fetch("/api/household/session");
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

async function fetchHouseholdDetail(id: string) {
  const res = await fetch(`/api/households/${id}`);
  if (!res.ok) throw new Error("Failed to fetch household");
  const data = await res.json();
  return data.household as Household;
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const {
    selectedHouseholdId,
    setSelectedHouseholdId,
    activeTab,
    setActiveTab,
    householdNames,
    setHouseholdNames,
    notificationPanelOpen,
    setNotificationPanelOpen,
  } = useAnnaStore();

  // Auth check: fetch session
  const { data: sessionData, isLoading: sessionLoading, isError: sessionError } = useQuery({
    queryKey: ["household-session"],
    queryFn: fetchSession,
    retry: false,
    staleTime: 60_000,
  });

  const isAuthenticated = !!sessionData?.authenticated;
  const member = sessionData?.member;
  const householdFromSession = sessionData?.household;

  // Redirect to login if not authenticated (after loading completes)
  useEffect(() => {
    if (!sessionLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [sessionLoading, isAuthenticated, router]);

  // Auto-set household ID from session
  useEffect(() => {
    if (isAuthenticated && householdFromSession?.id) {
      setSelectedHouseholdId(householdFromSession.id);
      setHouseholdNames({ [householdFromSession.id]: householdFromSession.name });
    }
  }, [isAuthenticated, householdFromSession, setSelectedHouseholdId, setHouseholdNames]);

  // Fetch detailed household data (for onboardingStep check, etc.)
  const { data: householdDetail } = useQuery({
    queryKey: ["household", selectedHouseholdId],
    queryFn: () => fetchHouseholdDetail(selectedHouseholdId),
    enabled: !!selectedHouseholdId,
    staleTime: 60_000,
  });

  // Expose household detail for children via data attribute / context approach
  // (children components can query directly)

  // Unread notification count
  const { data: notifData } = useQuery({
    queryKey: ["notifications", selectedHouseholdId, "count"],
    queryFn: async () => {
      if (!selectedHouseholdId) return { unreadCount: 0 };
      const res = await fetch(`/api/notifications?householdId=${selectedHouseholdId}`);
      if (!res.ok) return { unreadCount: 0 };
      return res.json();
    },
    enabled: !!selectedHouseholdId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  const unreadCount = notifData?.unreadCount || 0;

  const currentHouseholdName = householdNames[selectedHouseholdId] || (sessionLoading ? "Loading..." : "");

  async function handleLogout() {
    try {
      await fetch("/api/household/auth", { method: "DELETE" });
      queryClient.clear();
      toast.success("Logged out");
      router.push("/login");
    } catch {
      toast.error("Failed to logout");
    }
  }

  // Loading state while checking auth
  if (sessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--anna-bg)]">
        <div className="flex flex-col items-center gap-4">
          <img src="/brain-icon.png" alt="Anna.I" className="w-10 h-10 animate-pulse" />
          <p className="text-sm text-[var(--anna-muted)]">Loading...</p>
        </div>
      </div>
    );
  }

  // Not authenticated — redirect handled by useEffect
  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--anna-bg)]">
      {/* Top Nav */}
      <header className="sticky top-0 z-40 bg-[var(--anna-white)]/80 backdrop-blur-lg border-b border-[var(--anna-border)]">
        <div className="flex items-center justify-between h-14 px-4 lg:px-6">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold tracking-tight text-[var(--anna-sage-dark)]">
              Anna.I
            </span>
            <span className="hidden sm:inline text-[10px] font-data uppercase tracking-widest text-[var(--anna-muted)] bg-[var(--anna-sage-light)] px-2 py-0.5 rounded-md">
              Beta
            </span>
          </div>

          {/* Center: User + Household name */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[var(--anna-bg)] border border-[var(--anna-border)]">
              <div className="w-6 h-6 rounded-lg bg-[var(--anna-sage-light)] flex items-center justify-center">
                <User size={12} className="text-[var(--anna-sage-dark)]" />
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-medium text-[var(--anna-slate)] leading-tight">
                  {currentHouseholdName}
                </span>
                <span className="text-[10px] text-[var(--anna-muted)] leading-tight">
                  {member?.role === "OWNER" ? "Owner" : "Member"}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Logout + Mobile Settings + Notification Bell */}
          <div className="flex items-center gap-1">
            {/* Logout button — hidden on mobile (moved to Settings page) */}
            <button
              onClick={() => setLogoutDialogOpen(true)}
              className="hidden md:flex p-2 rounded-xl hover:bg-red-50 hover:text-red-500 text-[var(--anna-slate-light)] transition-colors"
              title="Sign out"
            >
              <LogOut size={18} />
            </button>
            {/* Mobile-only Settings button */}
            <button
              onClick={() => setActiveTab("settings")}
              className={cn(
                "md:hidden p-2 rounded-xl transition-colors",
                activeTab === "settings"
                  ? "bg-[var(--anna-sage)] text-white"
                  : "hover:bg-[var(--anna-sage-light)]"
              )}
            >
              <Settings size={18} className={cn(
                activeTab === "settings" ? "text-white" : "text-[var(--anna-slate-light)]"
              )} />
            </button>
            <button
              onClick={() => setNotificationPanelOpen(!notificationPanelOpen)}
              className="relative p-2 rounded-xl hover:bg-[var(--anna-sage-light)] transition-colors"
            >
              <Bell size={18} className="text-[var(--anna-slate-light)]" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-[var(--anna-sage-dark)] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex flex-col w-56 lg:w-64 border-r border-[var(--anna-border)] bg-[var(--anna-white)] p-3 gap-1">
          {/* User info card */}
          <div className="flex items-center gap-3 px-3 py-3 mb-2 rounded-xl bg-[var(--anna-bg)] border border-[var(--anna-border)]">
            <div className="w-9 h-9 rounded-xl bg-[var(--anna-sage-light)] flex items-center justify-center">
              <User size={16} className="text-[var(--anna-sage-dark)]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--anna-slate)] truncate">
                {member?.name || "User"}
              </p>
              <p className="text-[10px] text-[var(--anna-muted)] truncate">
                {currentHouseholdName}
              </p>
            </div>
            <span className={cn(
              "text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md",
              member?.role === "OWNER"
                ? "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
                : "bg-gray-100 text-gray-500"
            )}>
              {member?.role === "OWNER" ? "Owner" : "Member"}
            </span>
          </div>

          <nav className="flex flex-col gap-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                    isActive
                      ? "bg-[var(--anna-sage)] text-[var(--anna-white)] shadow-sm"
                      : "text-[var(--anna-slate-light)] hover:bg-[var(--anna-sage-light)] hover:text-[var(--anna-slate)]"
                  )}
                >
                  <Icon size={18} />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          {/* Settings — separated from main nav */}
          <div className="mt-auto pt-2 border-t border-[var(--anna-border)]">
            <button
              onClick={() => setActiveTab("settings")}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all w-full",
                activeTab === "settings"
                  ? "bg-[var(--anna-sage)] text-[var(--anna-white)] shadow-sm"
                  : "text-[var(--anna-slate-light)] hover:bg-[var(--anna-sage-light)] hover:text-[var(--anna-slate)]"
              )}
            >
              <Settings size={18} />
              Settings
            </button>
          </div>
        </aside>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto anna-scroll">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--anna-white)]/95 backdrop-blur-lg border-t border-[var(--anna-border)] safe-area-inset-bottom">
        <div className="flex items-center justify-around h-14">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-xl transition-all min-w-[56px]",
                  isActive
                    ? "text-[var(--anna-sage-dark)]"
                    : "text-[var(--anna-muted)]"
                )}
              >
                <Icon size={20} />
                <span className="text-[10px] font-medium">{tab.label}</span>
                {isActive && (
                  <span className="absolute -top-px w-8 h-0.5 bg-[var(--anna-sage)] rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* L-3 FIX: Footer inside flex container with mt-auto for sticky behavior */}
      <footer className="hidden md:flex border-t border-[var(--anna-border)] bg-[var(--anna-white)] mt-auto flex-shrink-0">
        <div className="w-full px-6 py-4 flex items-center justify-between">
          <p className="text-xs text-[var(--anna-muted)]">
            Anna.I — The Operating System for the Modern Household
          </p>
          <p className="text-[10px] font-data text-[var(--anna-muted)]">
            v0.1.0-beta
          </p>
        </div>
      </footer>

      {/* Logout Confirmation Dialog */}
      <AlertDialog open={logoutDialogOpen} onOpenChange={setLogoutDialogOpen}>
        <AlertDialogContent className="rounded-2xl border-[var(--anna-border)]">
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              You will need to sign in again to access your household dashboard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLogout}
              className="bg-red-500 hover:bg-red-600 text-white rounded-xl"
            >
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Ask Anna Chat */}
      <AskAnna />

      {/* Notification Panel */}
      <NotificationPanel />

      {/* Real-Time Toasts */}
      <RealtimeToasts />
    </div>
  );
}
