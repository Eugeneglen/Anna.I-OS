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
  { label: "Vendors", href: "/ops/vendors", icon: Users, active: true },
  { label: "Config", href: "/ops/config", icon: Settings, active: true },
  { label: "Analytics", href: "#", icon: BarChart3, active: false },
  { label: "Bookings", href: "#", icon: Calendar, active: false },
  { label: "Households", href: "#", icon: Home, active: false },
  { label: "Autonomy", href: "#", icon: Zap, active: false },
  { label: "Notifications", href: "#", icon: Bell, active: false },
  { label: "Anomalies", href: "#", icon: AlertTriangle, active: false },
];

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    ADMIN: "bg-emerald-100 text-emerald-700",
    COORDINATOR: "bg-amber-100 text-amber-700",
    ANALYST: "bg-slate-100 text-slate-600",
  };
  return (
    <Badge variant="secondary" className={styles[role] || "bg-slate-100"}>
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
      <div className="px-4 py-5">
        <h1 className="text-xl font-bold" style={{ color: "#10b981" }}>Anna.I</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Ops Control Centre</p>
      </div>
      <Separator />
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = item.active && pathname.startsWith(item.href);
          return (
            <button
              key={item.label}
              onClick={() => item.active && router.push(item.href)}
              disabled={!item.active}
              className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-emerald-50 text-emerald-700"
                  : item.active
                  ? "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  : "text-gray-400 cursor-not-allowed"
              }`}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
              {!item.active && (
                <span className="ml-auto text-[10px] text-gray-400">Soon</span>
              )}
            </button>
          );
        })}
      </nav>
      <Separator />
      <div className="p-3">
        <UserSection onLogout={handleLogout} />
      </div>
    </div>
  );
}

function UserSection({ onLogout }: { onLogout: () => void }) {
  const user = useOpsUser();
  if (!user) return null;
  const initials = user.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  return (
    <div className="flex items-center gap-3">
      <Avatar className="h-8 w-8">
        <AvatarFallback className="text-xs bg-emerald-100 text-emerald-700">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{user.name}</p>
        <RoleBadge role={user.role} />
      </div>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onLogout}>
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();

  const { data: user, isLoading, error } = useQuery<OpsUser | null>({
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
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto" style={{ borderColor: "#10b981" }} />
          <p className="mt-2 text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <OpsUserContext.Provider value={user}>
      <div className="min-h-screen flex bg-white">
        <aside className="hidden md:flex md:w-60 md:flex-col border-r bg-white">
          <SidebarNav />
        </aside>
        <main className="flex-1 min-w-0 overflow-auto">
          <div className="md:hidden flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-60 p-0">
                  <SidebarNav />
                </SheetContent>
              </Sheet>
              <h1 className="text-sm font-bold" style={{ color: "#10b981" }}>Anna.I</h1>
            </div>
            <RoleBadge role={user.role} />
          </div>
          <div className="p-4 md:p-6">{children}</div>
        </main>
      </div>
    </OpsUserContext.Provider>
  );
}