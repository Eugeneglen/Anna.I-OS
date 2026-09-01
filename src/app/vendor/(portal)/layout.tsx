"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  CalendarDays,
  CalendarRange,
  Wallet,
  Settings,
  Menu,
  LogOut,
  Briefcase,
  ArrowLeft,
  Bell,
  Wifi,
  WifiOff,
  X,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
  CreditCard,
  Camera,
  Clock,
  Users,
  Shield,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VendorAiChat } from "@/components/vendor/vendor-ai-chat";
import { VendorNotificationPanel } from "@/components/vendor/vendor-notification-panel";
import {
  useVendorEvents,
  type VendorEvent,
  getVendorEventLabel,
  getVendorEventToastVariant,
} from "@/hooks/use-vendor-events";
import {
  setExpectedVendorId,
  clearExpectedVendorId,
  clearVendorToken,
  vendorFetch,
  installVendorFetchPatch,
} from "@/lib/vendor-fetch";

interface VendorRole {
  id: string;
  name: string;
  slug: string;
  level: number;
}

interface VendorUser {
  id: string;
  name: string;
  email: string;
  vendorType: string;
  status: string;
  roleId: string | null;
  role: VendorRole | null;
}

interface VendorUserContextType {
  user: VendorUser;
  role: VendorRole | null;
  can: (module: string, action: string) => boolean;
}

const VendorUserContext = createContext<VendorUserContextType | null>(null);
export function useVendorUser() {
  return useContext(VendorUserContext);
}

// ── Real-time event context ──
interface VendorLiveContextType {
  isConnected: boolean;
  latestToast: VendorEvent | null;
  dismissToast: () => void;
}
const VendorLiveContext = createContext<VendorLiveContextType>({
  isConnected: false,
  latestToast: null,
  dismissToast: () => {},
});
export function useVendorLive() {
  return useContext(VendorLiveContext);
}

const NAV_ITEMS: { label: string; href: string; icon: LucideIcon; exact?: boolean; permission?: string }[] = [
    { label: "Dashboard", href: "/vendor/", icon: LayoutDashboard, exact: true },
    { label: "Schedule", href: "/vendor/schedule", icon: CalendarDays, permission: "v_schedule:view" },
  { label: "Calendar", href: "/vendor/calendar", icon: CalendarRange, permission: "v_calendar:view" },
  { label: "Earnings", href: "/vendor/earnings", icon: Wallet, permission: "v_earnings:view" },
  { label: "Staff Roster", href: "/vendor/staff-roster", icon: Users, permission: "v_staff:view" },
  { label: "Settings", href: "/vendor/settings", icon: Settings, permission: "v_settings:view" },
  { label: "User Management", href: "/vendor/users", icon: UserCog, permission: "v_users:view" },
  { label: "Role Management", href: "/vendor/roles", icon: Shield, permission: "v_roles:view" },
];

// Live indicator for the sidebar — shows WebSocket connection status
function LiveIndicator({ isConnected }: { isConnected: boolean }) {
  return (
    <div className={cn(
      "flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium",
      isConnected
        ? "bg-emerald-50 text-emerald-600"
        : "bg-red-50 text-red-500"
    )}>
      {isConnected ? <Wifi size={10} /> : <WifiOff size={10} />}
      <span>Live</span>
    </div>
  );
}

// Simple notification indicator for the sidebar (no polling — uses WebSocket for invalidation)
function NotificationIndicator({ vendorId }: { vendorId: string }) {
  const { data } = useQuery({
    queryKey: ["vendor-notifications-count", vendorId],
    queryFn: async () => {
      const res = await vendorFetch(`/api/vendors/${vendorId}/notifications?unread=true`);
      if (!res.ok) return { unreadCount: 0, notifications: [] };
      return res.json();
    },
    enabled: !!vendorId,
    // No refetchInterval — real-time invalidation via useVendorEvents in the layout
    staleTime: 60_000,
    select: (d) => d.unreadCount,
  });

  const unread = data ?? 0;

  return (
    <div className="flex items-center gap-2 text-[var(--anna-slate-light)]">
      <Bell size={14} className="text-[var(--anna-muted)]" />
      <span className="text-xs font-medium">
        {unread > 0 ? (
          <span className="flex items-center gap-1.5">
            Notifications
            <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-[var(--anna-error)] text-white text-[9px] font-bold">
              {unread > 9 ? "9+" : unread}
            </span>
          </span>
        ) : (
          "No new notifications"
        )}
      </span>
    </div>
  );
}

function SidebarNav({ vendorId }: { vendorId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const live = useVendorLive();
  const vendorCtx = useVendorUser();
  const can = vendorCtx?.can;

  // Filter nav items by permission
  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (!item.permission || !can) return true;
    return can(item.permission.split(":")[0], item.permission.split(":")[1]);
  });

  async function handleLogout() {
    // Clear tab-scoped session state only.
    // We do NOT call DELETE /api/vendor/auth because that would clear
    // the shared cookie and break other tabs' middleware access.
    clearExpectedVendorId();
    clearVendorToken();
    router.push("/vendor/login");
  }

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="px-4 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[var(--anna-sage)] flex items-center justify-center">
              <Briefcase size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-[var(--anna-sage-dark)]">
                Anna.I
              </h1>
              <p className="text-[10px] font-data uppercase tracking-widest text-[var(--anna-muted)]">
                Vendor Portal
              </p>
            </div>
          </div>
          {/* Live indicator */}
          <LiveIndicator isConnected={live.isConnected} />
        </div>
      </div>
      <Separator className="bg-[var(--anna-border)]" />

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto anna-scroll">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.exact
            ? pathname === item.href || pathname === "/vendor"
            : pathname.startsWith(item.href);
          return (
            <button
              key={item.label}
              onClick={() => router.push(item.exact ? "/vendor" : item.href)}
              className={cn(
                "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-[var(--anna-sage)] text-[var(--anna-white)] shadow-sm"
                  : "text-[var(--anna-slate-light)] hover:bg-[var(--anna-sage-light)] hover:text-[var(--anna-slate)]"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <Separator className="bg-[var(--anna-border)]" />

      {/* Back to household link */}
      <div className="px-2 py-2">
        <button
          onClick={() => router.push("/")}
          className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-[var(--anna-muted)] hover:text-[var(--anna-slate)] hover:bg-[var(--anna-bg)] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
          <span>Household Portal</span>
        </button>
      </div>

      <Separator className="bg-[var(--anna-border)]" />

      {/* Notifications indicator */}
      <div className="px-3 pt-2">
        <NotificationIndicator vendorId={vendorId} />
      </div>
      <Separator className="bg-[var(--anna-border)]" />

      {/* User section */}
      <div className="p-3">
        <UserSection onLogout={handleLogout} />
      </div>
    </div>
  );
}

function UserSection({ onLogout }: { onLogout: () => void }) {
  const ctx = useVendorUser();
  const user = ctx?.user;
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
        <Badge
          variant="secondary"
          className="text-[10px] font-medium px-1.5 py-0 bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
        >
          {ctx?.role?.name || user.vendorType}
        </Badge>
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
// Real-time toast (mirrors Ops LiveToast pattern)
// ─────────────────────────────────────────────────────────────

const VENDOR_TOAST_STYLES: Record<string, { bg: string; border: string; icon: string }> = {
  success: { bg: "bg-emerald-50", border: "border-emerald-200", icon: "text-emerald-600" },
  warning: { bg: "bg-amber-50", border: "border-amber-200", icon: "text-amber-600" },
  error: { bg: "bg-red-50", border: "border-red-200", icon: "text-red-600" },
  info: { bg: "bg-[var(--anna-sage-light)]", border: "border-[var(--anna-border)]", icon: "text-[var(--anna-sage-dark)]" },
};

const VENDOR_EVENT_ICONS: Record<string, React.ElementType> = {
  "vendor:notification": Bell,
  "booking:status_changed": CalendarDays,
  "task:status_changed": Clock,
  "task:dispatched": Briefcase,
  "escrow:state_changed": CreditCard,
  "dispute:raised": AlertTriangle,
  "dispute:resolved": CheckCircle2,
  "work:completed": CheckCircle2,
  "photos:uploaded": Camera,
};

function VendorLiveToast({
  event,
  onDismiss,
}: {
  event: VendorEvent;
  onDismiss: () => void;
}) {
  const variant = getVendorEventToastVariant(event.type);
  const styles = VENDOR_TOAST_STYLES[variant] || VENDOR_TOAST_STYLES.info;
  const Icon = VENDOR_EVENT_ICONS[event.type] || Info;

  // Auto-dismiss after 8s
  useEffect(() => {
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  // Extract title/body from event data (works for vendor:notification + generic events)
  const title = (event.data.title as string) || getVendorEventLabel(event.type);
  const body = (event.data.body as string) || (event.data.message as string) || "";

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
        <Icon size={18} className={styles.icon} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={cn("text-[10px] font-bold uppercase tracking-wider", styles.icon)}>
            {title}
          </span>
          <span className="text-[10px] text-[var(--anna-muted)]">
            {new Date(event.timestamp).toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        {body && (
          <p className="text-xs text-[var(--anna-slate)] leading-relaxed line-clamp-2">
            {body}
          </p>
        )}
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

export default function VendorPortalLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [timedOut, setTimedOut] = useState(false);
  const mounted = useRef(false);
  const [latestToast, setLatestToast] = useState<VendorEvent | null>(null);
  const [toastKey, setToastKey] = useState(0);

  // Install global fetch patch for multi-tab Authorization header injection.
  // This ensures ALL fetch() calls to vendor API routes include the tab's
  // own JWT, preventing cookie collision between tabs.
  useEffect(() => {
    const cleanup = installVendorFetchPatch();
    return cleanup;
  }, []);

  const dismissToast = useCallback(() => {
    setLatestToast(null);
    setToastKey((k) => k + 1);
  }, []);

  // ── Single session fetch: captures identity + role + permissions together ──
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [vendorRole, setVendorRole] = useState<VendorRole | null>(null);

  const {
    data: user,
    isLoading,
    error,
    isError,
  } = useQuery<VendorUser | null>({
    queryKey: ["vendor-session"],
    queryFn: async () => {
      const res = await vendorFetch("/api/vendor/session");
      if (res.status === 401) {
        clearExpectedVendorId();
        clearVendorToken();
        window.location.replace("/vendor/login");
        return null;
      }
      if (!res.ok) return null;
      const data = await res.json();
      const vendor = data.vendor as VendorUser;
      // Store expected vendorId for cookie-overwrite detection
      if (vendor?.id) setExpectedVendorId(vendor.id);
      // Hydrate RBAC state from the same response (no second fetch)
      setPermissions(data.permissions ?? []);
      if (data.role) {
        setVendorRole({
          id: data.role.id,
          name: data.role.name,
          slug: data.role.slug,
          level: data.role.level,
        });
      } else {
        setVendorRole(null);
      }
      return vendor;
    },
    retry: false,
    staleTime: 30 * 1000, // 30s — low enough to detect cookie overwrite on refocus
  });

  // Deny-by-default RBAC gate.
  // - While permissions are still loading (null), grant all access so the
  //   nav renders on first paint without flashing empty.
  // - Once loaded, an EMPTY permissions array means the user has NO role /
  //   no permissions — deny everything except the always-visible Dashboard.
  const can = useCallback(
    (module: string, action: string) => {
      if (permissions === null) return true; // still loading
      if (permissions.length === 0) {
        // No role assigned → only allow viewing the Dashboard.
        return module === "v_dashboard" && action === "view";
      }
      return permissions.includes(`${module}:${action}`);
    },
    [permissions]
  );

  // ── Real-time event handler: invalidate React Query caches + show toasts ──
  const handleVendorEvent = useCallback((event: VendorEvent) => {
    if (event.type === "vendor:notification") {
      queryClient.invalidateQueries({ queryKey: ["vendor-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-notifications-count"] });
    }
    if (
      event.type.startsWith("booking") ||
      event.type.startsWith("task") ||
      event.type === "task:dispatched"
    ) {
      queryClient.invalidateQueries({ queryKey: ["vendor-dashboard", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["vendor-schedule", user?.id] });
    }
    if (event.type.startsWith("escrow")) {
      queryClient.invalidateQueries({ queryKey: ["vendor-earnings", user?.id] });
    }
    setLatestToast(event);
    setToastKey((k) => k + 1);
  }, [queryClient, user?.id]);

  // Connect to ops-events WebSocket as a vendor client
  const { isConnected } = useVendorEvents(user?.id || null, {
    enabled: !!user?.id,
    onEvent: handleVendorEvent,
  });

  // Redirect on error or when session fetch returned null
  useEffect(() => {
    mounted.current = true;
    if (isError || (!isLoading && !user && mounted.current)) {
      window.location.replace("/vendor/login");
    }
  }, [isError, error, isLoading, user]);

  // Safety timeout
  useEffect(() => {
    if (!isLoading && !user) return;
    const timer = setTimeout(() => { setTimedOut(true); }, 8000);
    return () => clearTimeout(timer);
  }, [isLoading, user]);

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
                onClick={() => window.location.replace("/vendor/login")}
                className="text-xs font-medium text-[var(--anna-sage-dark)] hover:underline underline-offset-2"
              >
                Sign in again
              </button>
            </>
          ) : (
            <>
              <img src="/brain-icon.png" alt="Anna.I" width={80} height={80} className="mx-auto animate-pulse" />
              <p className="mt-3 text-sm text-[var(--anna-muted)]">Loading...</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const liveContextValue: VendorLiveContextType = {
    isConnected,
    latestToast,
    dismissToast,
  };

  return (
    <VendorLiveContext.Provider value={liveContextValue}>
      <VendorUserContext.Provider value={{ user: user!, role: vendorRole, can }}>
        <div className="min-h-screen flex bg-[var(--anna-bg)]">
          {/* Desktop Sidebar */}
          <aside className="hidden md:flex md:w-60 lg:w-64 md:flex-col border-r border-[var(--anna-border)] bg-[var(--anna-white)]">
            <SidebarNav vendorId={user.id} />
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
                      className="h-10 w-10 hover:bg-[var(--anna-sage-light)]"
                      aria-label="Open navigation menu"
                    >
                      <Menu className="h-5 w-5 text-[var(--anna-slate-light)]" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-60 p-0 bg-[var(--anna-white)]">
                    <SidebarNav vendorId={user.id} />
                  </SheetContent>
                </Sheet>
                <div className="flex items-center gap-2">
                  <Briefcase size={16} className="text-[var(--anna-sage-dark)]" />
                  <h1 className="text-sm font-bold text-[var(--anna-sage-dark)]">
                    {user.name}
                  </h1>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className={cn(
                  "flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium",
                  isConnected ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"
                )}>
                  {isConnected ? <Wifi size={8} /> : <WifiOff size={8} />}
                </div>
                <VendorNotificationPanel vendorId={user.id} compact />
                <Badge
                  variant="secondary"
                  className="text-[10px] font-medium px-1.5 py-0 bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
                >
                  {user.vendorType}
                </Badge>
              </div>
            </div>

            {/* Page Content */}
            <div className="p-4 md:p-6 anna-fade-in">{children}</div>
          </main>
        </div>

        {/* Live Toast Notifications (top-right) */}
        <div className={cn(
          "fixed top-4 right-4 z-[60] flex flex-col gap-2",
          latestToast ? "pointer-events-auto" : "pointer-events-none"
        )}>
          <AnimatePresence>
            {latestToast && (
              <VendorLiveToast
                key={toastKey}
                event={latestToast}
                onDismiss={dismissToast}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Vendor AI Chat */}
        <VendorAiChat />
      </VendorUserContext.Provider>
    </VendorLiveContext.Provider>
  );
}
