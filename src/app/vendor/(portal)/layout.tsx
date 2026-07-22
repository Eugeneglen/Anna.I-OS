"use client";

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  LayoutDashboard,
  CalendarDays,
  Wallet,
  Settings,
  Menu,
  LogOut,
  Briefcase,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VendorAiChat } from "@/components/vendor/vendor-ai-chat";

interface VendorUser {
  id: string;
  name: string;
  email: string;
  vendorType: string;
  status: string;
}

const VendorUserContext = createContext<VendorUser | null>(null);
export function useVendorUser() {
  return useContext(VendorUserContext);
}

const NAV_ITEMS = [
  { label: "Dashboard", href: "/vendor/", icon: LayoutDashboard, exact: true },
  { label: "Schedule", href: "/vendor/schedule", icon: CalendarDays },
  { label: "Earnings", href: "/vendor/earnings", icon: Wallet },
  { label: "Settings", href: "/vendor/settings", icon: Settings },
];

function SidebarNav() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/vendor/auth", { method: "DELETE" });
    router.push("/vendor/login");
  }

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="px-4 py-5">
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
      </div>
      <Separator className="bg-[var(--anna-border)]" />

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto anna-scroll">
        {NAV_ITEMS.map((item) => {
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

      {/* User section */}
      <div className="p-3">
        <UserSection onLogout={handleLogout} />
      </div>
    </div>
  );
}

function UserSection({ onLogout }: { onLogout: () => void }) {
  const user = useVendorUser();
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
          {user.vendorType}
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

export default function VendorPortalLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);
  const mounted = useRef(false);

  const {
    data: user,
    isLoading,
    error,
    isError,
  } = useQuery<VendorUser | null>({
    queryKey: ["vendor-session"],
    queryFn: async () => {
      const res = await fetch("/api/vendor/session");
      if (res.status === 401) {
        // Use hard redirect as fallback — router.push may not fire inside queryFn
        window.location.replace("/vendor/login");
        return null;
      }
      if (!res.ok) return null;
      const data = await res.json();
      return data.vendor as VendorUser;
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  // Redirect on error or when session fetch returned null (unauthenticated)
  useEffect(() => {
    mounted.current = true;
    if (isError || (!isLoading && !user && mounted.current)) {
      window.location.replace("/vendor/login");
    }
  }, [isError, error, isLoading, user]);

  // Safety timeout: if loading takes more than 8s, force redirect to login
  useEffect(() => {
    if (!isLoading && !user) return; // already handled above
    const timer = setTimeout(() => {
      setTimedOut(true);
    }, 8000);
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
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto border-[var(--anna-sage-dark)]" />
              <p className="mt-3 text-sm text-[var(--anna-muted)]">Loading...</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <VendorUserContext.Provider value={user}>
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
              <div className="flex items-center gap-2">
                <Briefcase size={16} className="text-[var(--anna-sage-dark)]" />
                <h1 className="text-sm font-bold text-[var(--anna-sage-dark)]">
                  {user.name}
                </h1>
              </div>
            </div>
            <Badge
              variant="secondary"
              className="text-[10px] font-medium px-1.5 py-0 bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
            >
              {user.vendorType}
            </Badge>
          </div>

          {/* Page Content */}
          <div className="p-4 md:p-6 anna-fade-in">{children}</div>
        </main>
      </div>

      {/* Vendor AI Chat */}
      <VendorAiChat />
    </VendorUserContext.Provider>
  );
}
