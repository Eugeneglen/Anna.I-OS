"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Bell, LayoutDashboard, Layers, Brain, ListChecks, Landmark, Settings, Home } from "lucide-react";
import { useAnnaStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

async function fetchHouseholds(): Promise<Household[]> {
  const res = await fetch("/api/households");
  if (!res.ok) throw new Error("Failed to fetch households");
  const data = await res.json();
  return data.households;
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
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

  const { data: households, isLoading: householdsLoading } = useQuery({
    queryKey: ["households"],
    queryFn: fetchHouseholds,
    staleTime: 60_000,
  });

  // Unread notification count (runs in background for badge)
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

  const isEmptyDb = !householdsLoading && households?.length === 0;

  // Auto-select first household and cache names (handles stale IDs after re-seed)
  useEffect(() => {
    if (!households || households.length === 0) return;
    const names: Record<string, string> = {};
    households.forEach((h) => (names[h.id] = h.name));
    setHouseholdNames(names);
    // If selected household doesn't exist in the list (e.g. after re-seed), auto-select first
    const validId = households.some((h) => h.id === selectedHouseholdId);
    if (!validId) {
      setSelectedHouseholdId(households[0].id);
    }
  }, [households, selectedHouseholdId, setHouseholdNames, setSelectedHouseholdId]);

  const currentHouseholdName = householdNames[selectedHouseholdId] || (householdsLoading ? "Loading..." : "");



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

          {/* Center: Household Selector */}
          <div className="flex items-center gap-2">
            <Select
              value={selectedHouseholdId}
              onValueChange={setSelectedHouseholdId}
            >
              <SelectTrigger
                size="sm"
                className="w-auto min-w-[140px] border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm font-medium"
              >
                <SelectValue placeholder="Select household" />
              </SelectTrigger>
              <SelectContent>
                {households?.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Right: Mobile Settings + Notification Bell */}
          <div className="flex items-center gap-1">
            {/* Mobile-only Settings button (top-right on mobile) */}
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
            <p className="text-xs text-[var(--anna-muted)] px-3 mt-2">{currentHouseholdName}</p>
          </div>
        </aside>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto anna-scroll">
          {isEmptyDb ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[60vh] px-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[var(--anna-sage-light)] flex items-center justify-center mb-6">
                <Home size={28} className="text-[var(--anna-sage-dark)]" />
              </div>
              <h2 className="text-xl font-semibold text-[var(--anna-slate)] mb-2">
                Welcome to Anna.I
              </h2>
              <p className="text-sm text-[var(--anna-muted)] max-w-sm mb-8">
                Your household management system is ready. Seed the database with sample data to explore the dashboard.
              </p>
              <div className="bg-[var(--anna-bg)] rounded-2xl border border-[var(--anna-border)] p-5 max-w-md text-left">
                <p className="text-xs font-semibold text-[var(--anna-slate)] mb-2 uppercase tracking-wider">
                  Railway Console
                </p>
                <code className="text-xs text-[var(--anna-sage-dark)] font-mono leading-relaxed block whitespace-pre-wrap">
{`npx prisma migrate deploy
npx prisma db seed`}
                </code>
              </div>
            </div>
          ) : (
            children
          )}
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

      {/* Ask Anna Chat */}
      <AskAnna />

      {/* Notification Panel */}
      <NotificationPanel />

      {/* Real-Time Toasts */}
      <RealtimeToasts />
    </div>
  );
}