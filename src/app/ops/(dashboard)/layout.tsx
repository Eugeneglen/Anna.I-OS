"use client";

import { createContext, useContext, useEffect, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

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

const NAV_ITEMS = [
  { label: "Analytics", href: "/ops/analytics", icon: BarChart3, active: true },
  { label: "Bookings", href: "/ops/bookings", icon: Calendar, active: true },
  { label: "Households", href: "/ops/households", icon: Home, active: true },
  { label: "Vendors", href: "/ops/vendors", icon: Users, active: true },
  { label: "Config", href: "/ops/config", icon: Settings, active: true },
  { label: "Autonomy", href: "/ops/autonomy", icon: Zap, active: true },
  { label: "Notifications", href: "/ops/notifications", icon: Bell, active: true },
  { label: "Anomalies", href: "/ops/anomalies", icon: AlertTriangle, active: true },
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

  async function handleLogout() {
    await fetch("/api/ops/auth", { method: "DELETE" });
    router.push("/ops/login");
  }

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="px-4 py-5">
        <h1 className="text-lg font-bold tracking-tight text-[var(--anna-sage-dark)]">
          Anna.I
        </h1>
        <p className="text-[10px] font-data uppercase tracking-widest text-[var(--anna-muted)] mt-0.5">
          Ops Control Centre
        </p>
      </div>
      <Separator className="bg-[var(--anna-border)]" />

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto anna-scroll">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.active && pathname.startsWith(item.href);
          return (
            <button
              key={item.label}
              onClick={() => item.active && router.push(item.href)}
              disabled={!item.active}
              className={cn(
                "w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                isActive
                  ? "bg-[var(--anna-sage)] text-[var(--anna-white)] shadow-sm"
                  : item.active
                    ? "text-[var(--anna-slate-light)] hover:bg-[var(--anna-sage-light)] hover:text-[var(--anna-slate)]"
                    : "text-[var(--anna-muted)] cursor-not-allowed"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
              {!item.active && (
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

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();

  const {
    data: user,
    isLoading,
    error,
  } = useQuery<OpsUser | null>({
    queryKey: ["ops-session"],
    queryFn: async () => {
      const res = await fetch("/api/ops/session");
      if (res.status === 401) {
        router.push("/ops/login");
        return null;
      }
      const data = await res.json();
      return data.user as OpsUser;
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (error) router.push("/ops/login");
  }, [error, router]);

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--anna-bg)]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto border-[var(--anna-sage-dark)]" />
          <p className="mt-3 text-sm text-[var(--anna-muted)]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
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
            <RoleBadge role={user.role} />
          </div>

          {/* Page Content */}
          <div className="p-4 md:p-6 anna-fade-in">{children}</div>
        </main>
      </div>
    </OpsUserContext.Provider>
  );
}