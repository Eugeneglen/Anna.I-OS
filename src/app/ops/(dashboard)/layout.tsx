"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  Settings,
  BarChart3,
  Calendar,
  Home,
  Zap,
  Bell,
  AlertTriangle,
  Menu,
  LogOut,
  Wifi,
  WifiOff,
  X,
  ArrowRight,
  Wallet,
  CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OpsAiChat } from "@/components/ops/ops-ai-chat";
import { useOpsEvents, type OpsEvent } from "@/hooks/use-ops-events";

interface OpsUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

const OpsUserContext = createContext<OpsUser | null>(null);
export function useOpsUser() {
  return useContext(OpsUserContext);
}

// ── Real-time event context ──
interface LiveContextType {
  isConnected: boolean;
  activeAnomalyCount: number;
  latestToast: OpsEvent | null;
  dismissToast: () => void;
}
const LiveContext = createContext<LiveContextType>({
  isConnected: false,
  activeAnomalyCount: 0,
  latestToast: null,
  dismissToast: () => {},
});
export function useLiveEvents() {
  return useContext(LiveContext);
}

const NAV_ITEMS = [
  { label: "Analytics", href: "/ops/analytics", icon: BarChart3, active: true },
  { label: "Bookings", href: "/ops/bookings", icon: Calendar, active: true },
  { label: "Households", href: "/ops/households", icon: Home, active: true },
  { label: "Vendors", href: "/ops/vendors", icon: Users, active: true },
  { label: "Escrow", href: "/ops/escrow", icon: Wallet, active: true },
  { label: "Config", href: "/ops/config", icon: Settings, active: true },
  { label: "Autonomy", href: "/ops/autonomy", icon: Zap, active: true },
  { label: "Notifications", href: "/ops/notifications", icon: Bell, active: true },
  { label: "Anomalies", href: "/ops/anomalies", icon: AlertTriangle, active: true },
  { label: "Subscriptions", href: "/ops/subscriptions", icon: CreditCard, active: true },
];

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    ADMIN: "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]",
    COORDINATOR: "bg-amber-50 text-amber-700",
    ANALYST: "bg-[var(--anna-bg)] text-[var(--anna-muted)]",
  };
  return (
    <Badge
      variant="secondary"
      className={cn("text-[10px] font-medium px-1.5 py-0", styles[role] || "bg-[var(--anna-bg)]")}
    >
      {role}
    </Badge>
  );
}

function SidebarNav() {
  const pathname = usePathname();
  const router = useRouter();
  const live = useLiveEvents();

  async function handleLogout() {
    await fetch("/api/ops/auth", { method: "DELETE" });
    router.push("/ops/login");
  }

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="px-4 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-[var(--anna-sage-dark)]">
              Anna.I
            </h1>
            <p className="text-[10px] font-data uppercase tracking-widest text-[var(--anna-muted)] mt-0.5">
              Ops Control Centre
            </p>
          </div>
          {/* Live indicator */}
          <div className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium",
            live.isConnected
              ? "bg-emerald-50 text-emerald-600"
              : "bg-red-50 text-red-500"
          )}>
            {live.isConnected ? <Wifi size={10} /> : <WifiOff size={10} />}
            <span>Live</span>
          </div>
        </div>
      </div>
      <Separator className="bg-[var(--anna-border)]" />

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto anna-scroll">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.active && pathname.startsWith(item.href);
          const showBadge = item.label === "Anomalies" && live.activeAnomalyCount > 0;
          return (
            <button
              key={item.label}
              onClick={() => item.active && router.push(item.href)}
              disabled={!item.active}
              className={cn(
                "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all relative",
                isActive
                  ? "bg-[var(--anna-sage)] text-[var(--anna-white)] shadow-sm"
                  : item.active
                    ? "text-[var(--anna-slate-light)] hover:bg-[var(--anna-sage-light)] hover:text-[var(--anna-slate)]"
                    : "text-[var(--anna-muted)] cursor-not-allowed"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
              {showBadge && (
                <span className={cn(
                  "ml-auto min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold px-1",
                  isActive ? "bg-white/20 text-white" : "bg-red-500 text-white"
                )}>
                  {live.activeAnomalyCount}
                </span>
              )}
              {!item.active && !showBadge && (
                <span className="ml-auto text-[10px] font-data">Soon</span>
              )}
            </button>
          );
        })}
      </nav>

      <Separator className="bg-[var(--anna-border)]" />
      <div className="p-3">
        <UserSection onLogout={handleLogout} />
      </div>
    </div>
  );
}

function UserSection({ onLogout }: { onLogout: () => void }) {
  const user = useOpsUser();
  if (!user) return null;
  const initials = user.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <div className="flex items-center gap-3">
      <Avatar className="h-8 w-8">
        <AvatarFallback className="text-xs bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)] font-medium">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--anna-slate)] truncate">
          {user.name}
        </p>
        <RoleBadge role={user.role} />
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 hover:bg-[var(--anna-sage-light)] text-[var(--anna-slate-light)]"
        onClick={onLogout}
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Anomaly severity → toast style mapping
// ─────────────────────────────────────────────────────────────

const SEVERITY_TOAST: Record<string, { bg: string; border: string; icon: string }> = {
  CRITICAL: { bg: "bg-red-50", border: "border-red-200", icon: "text-red-600" },
  HIGH: { bg: "bg-orange-50", border: "border-orange-200", icon: "text-orange-600" },
  MEDIUM: { bg: "bg-amber-50", border: "border-amber-200", icon: "text-amber-600" },
  LOW: { bg: "bg-blue-50", border: "border-blue-200", icon: "text-blue-600" },
};

// ─────────────────────────────────────────────────────────────
// Live Toast Component
// ─────────────────────────────────────────────────────────────

function LiveToast({
  event,
  onDismiss,
  onView,
}: {
  event: OpsEvent;
  onDismiss: () => void;
  onView: () => void;
}) {
  const severity = (event.data.severity as string) || "MEDIUM";
  const styles = SEVERITY_TOAST[severity] || SEVERITY_TOAST.MEDIUM;

  // Auto-dismiss after 8s
  useEffect(() => {
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, x: 20 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      exit={{ opacity: 0, x: 40 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className={cn(
        "w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border shadow-lg p-3 flex gap-3",
        styles.bg,
        styles.border
      )}
    >
      <div className="flex-shrink-0 mt-0.5">
        <AlertTriangle size={18} className={styles.icon} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={cn("text-[10px] font-bold uppercase tracking-wider", styles.icon)}>
            {event.type.replace(":", " ")}
          </span>
          <span className="text-[10px] text-[var(--anna-muted)]">
            {new Date(event.timestamp).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <p className="text-xs text-[var(--anna-slate)] leading-relaxed line-clamp-2">
          {event.data.message as string || (event.data.title as string) || "New event detected"}
        </p>
        <button
          onClick={onView}
          className="mt-1.5 text-[10px] font-semibold text-[var(--anna-sage-dark)] hover:underline inline-flex items-center gap-0.5"
        >
          View details <ArrowRight size={10} />
        </button>
      </div>
      <button
        onClick={onDismiss}
        className="flex-shrink-0 text-[var(--anna-muted)] hover:text-[var(--anna-slate)] mt-0.5"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// Dashboard Layout
// ─────────────────────────────────────────────────────────────

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [timedOut, setTimedOut] = useState(false);
  const mounted = useRef(false);
  const [activeAnomalyCount, setActiveAnomalyCount] = useState(0);
  const [latestToast, setLatestToast] = useState<OpsEvent | null>(null);
  const [toastKey, setToastKey] = useState(0);

  const dismissToast = useCallback(() => {
    setLatestToast(null);
    setToastKey((k) => k + 1);
  }, []);

  // Fetch active anomaly count on mount from statusCounts in anomalies API
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/ops/anomalies?status=ACTIVE&limit=1");
        if (res.ok) {
          const data = await res.json();
          const activeStatus = data.statusCounts?.find(
            (s: { status: string; _count: number }) => s.status === "ACTIVE"
          );
          setActiveAnomalyCount(activeStatus?._count || 0);
        }
      } catch {
        // Non-critical
      }
    })();
  }, []);

  // WebSocket event handlers
  const handleEvent = useCallback((event: OpsEvent) => {
    // Increment anomaly count when a new anomaly is detected
    if (event.type === "anomaly:detected") {
      setActiveAnomalyCount((prev) => prev + 1);

      // Show toast for HIGH/CRITICAL
      const severity = event.data.severity as string;
      if (severity === "HIGH" || severity === "CRITICAL") {
        setLatestToast(event);
        setToastKey((k) => k + 1);
      }
    }

    // Refresh relevant queries when events arrive
    if (event.type === "anomaly:detected" || event.type === "anomaly:resolved") {
      queryClient.invalidateQueries({ queryKey: ["ops-anomalies"] });
    }
    if (event.type === "notification:created") {
      queryClient.invalidateQueries({ queryKey: ["ops-notifications"] });
    }
    if (event.type === "booking:status_changed") {
      queryClient.invalidateQueries({ queryKey: ["ops-bookings"] });
    }
  }, [queryClient]);

  // Connect to ops-events WebSocket
  const { isConnected } = useOpsEvents({
    enabled: true,
    onEvent: handleEvent,
  });

  const {
    data: user,
    isLoading,
    error,
    isError,
  } = useQuery<OpsUser | null>({
    queryKey: ["ops-session"],
    queryFn: async () => {
      const res = await fetch("/api/ops/session");
      if (res.status === 401) {
        window.location.replace("/ops/login");
        return null;
      }
      if (!res.ok) return null;
      const data = await res.json();
      return data.user as OpsUser;
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    mounted.current = true;
    if (isError || (!isLoading && !user && mounted.current)) {
      window.location.replace("/ops/login");
    }
  }, [isError, error, isLoading, user]);

  useEffect(() => {
    if (!isLoading && !user) return;
    const timer = setTimeout(() => {
      setTimedOut(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [isLoading, user]);

  // Navigate to anomalies page when toast is clicked
  const handleViewToast = useCallback(() => {
    dismissToast();
    router.push("/ops/anomalies");
  }, [dismissToast, router]);

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--anna-bg)]">
        <div className="text-center">
          {timedOut ? (
            <>
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
                <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <p className="text-sm font-medium text-[var(--anna-slate)]">Unable to load session</p>
              <p className="text-xs text-[var(--anna-muted)] mt-1 mb-3">Your session may have expired</p>
              <button
                onClick={() => window.location.replace("/ops/login")}
                className="text-xs font-medium text-[var(--anna-sage-dark)] hover:underline underline-offset-2"
              >
                Sign in again
              </button>
            </>
          ) : (
            <>
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto border-[var(--anna-sage-dark)]" />
              <p className="mt-3 text-sm text-[var(--anna-muted)]">Loading...</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const liveContextValue: LiveContextType = {
    isConnected,
    activeAnomalyCount,
    latestToast,
    dismissToast,
  };

  return (
    <LiveContext.Provider value={liveContextValue}>
      <OpsUserContext.Provider value={user}>
        <div className="min-h-screen flex bg-[var(--anna-bg)]">
          {/* Desktop Sidebar */}
          <aside className="hidden md:flex md:w-60 lg:w-64 md:flex-col border-r border-[var(--anna-border)] bg-[var(--anna-white)]">
            <SidebarNav />
          </aside>

          {/* Main Content */}
          <main className="flex-1 min-w-0 overflow-auto">
            {/* Mobile Header */}
            <div className="md:hidden flex items-center justify-between border-b border-[var(--anna-border)] bg-[var(--anna-white)]/80 backdrop-blur-lg px-4 py-3 sticky top-0 z-40">
              <div className="flex items-center gap-2">
                <Sheet>
                  <SheetTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 hover:bg-[var(--anna-sage-light)]"
                    >
                      <Menu className="h-4 w-4 text-[var(--anna-slate-light)]" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-60 p-0 bg-[var(--anna-white)]">
                    <SidebarNav />
                  </SheetContent>
                </Sheet>
                <h1 className="text-sm font-bold text-[var(--anna-sage-dark)]">
                  Anna.I
                </h1>
              </div>
              <div className="flex items-center gap-2">
                {/* Mobile live indicator */}
                <div className={cn(
                  "flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium",
                  isConnected ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"
                )}>
                  {isConnected ? <Wifi size={8} /> : <WifiOff size={8} />}
                </div>
                <RoleBadge role={user.role} />
              </div>
            </div>

            {/* Page Content */}
            <div className="p-4 md:p-6 anna-fade-in">{children}</div>
          </main>
        </div>

        {/* Live Toast Notifications (top-right) */}
        <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-auto">
          <AnimatePresence>
            {latestToast && (
              <LiveToast
                key={toastKey}
                event={latestToast}
                onDismiss={dismissToast}
                onView={handleViewToast}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Ops AI Chat */}
        <OpsAiChat />
      </OpsUserContext.Provider>
    </LiveContext.Provider>
  );
}