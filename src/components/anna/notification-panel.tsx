"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAnnaStore } from "@/lib/store";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Bell,
  BellOff,
  CheckCheck,
  Send,
  Zap,
  ShieldCheck,
  AlertTriangle,
  Trophy,
  Clock,
  CreditCard,
  RefreshCw,
  MessageSquare,
  Brain,
  Layers,
  Camera,
} from "lucide-react";

interface AppNotification {
  id: string;
  eventType: string;
  title: string;
  body: string;
  status: string;
  createdAt: string;
  readAt: string | null;
  referenceType: string | null;
  referenceId: string | null;
}

const EVENT_ICONS: Record<string, React.ElementType> = {
  TASK_CREATED: Layers,
  TASK_DISPATCHED: Send,
  VENDOR_EN_ROUTE: Clock,
  VERIFICATION_REQUESTED: Camera,
  VERIFICATION_APPROVED: ShieldCheck,
  VERIFICATION_REJECTED: AlertTriangle,
  ESCROW_RELEASED: CreditCard,
  DISPUTE_RAISED: AlertTriangle,
  DISPUTE_RESOLVED: ShieldCheck,
  REBOOKING_PROMPT: RefreshCw,
  AUTONOMY_PROMOTED: Trophy,
  PREDICTIVE_SUGGESTION: Brain,
  SYSTEM_ALERT: MessageSquare,
};

const EVENT_COLORS: Record<string, string> = {
  TASK_CREATED: "text-[var(--anna-sage-dark)]",
  TASK_DISPATCHED: "text-[var(--anna-sage-dark)]",
  VENDOR_EN_ROUTE: "text-amber-600",
  VERIFICATION_REQUESTED: "text-blue-600",
  VERIFICATION_APPROVED: "text-emerald-600",
  VERIFICATION_REJECTED: "text-red-500",
  ESCROW_RELEASED: "text-emerald-600",
  DISPUTE_RAISED: "text-red-500",
  DISPUTE_RESOLVED: "text-emerald-600",
  REBOOKING_PROMPT: "text-[var(--anna-sage-dark)]",
  AUTONOMY_PROMOTED: "text-amber-600",
  PREDICTIVE_SUGGESTION: "text-purple-600",
  SYSTEM_ALERT: "text-[var(--anna-muted)]",
};

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
}

export function NotificationPanel() {
  const {
    selectedHouseholdId,
    notificationPanelOpen,
    setNotificationPanelOpen,
    openTaskDetail,
    setActiveTab,
  } = useAnnaStore();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const { data, isLoading } = useQuery({
    queryKey: ["notifications", selectedHouseholdId],
    queryFn: async () => {
      if (!selectedHouseholdId) return { notifications: [], unreadCount: 0 };
      const res = await fetch(
        `/api/notifications?householdId=${selectedHouseholdId}`
      );
      if (!res.ok) throw new Error("Failed to fetch notifications");
      return res.json();
    },
    enabled: !!selectedHouseholdId && notificationPanelOpen,
    refetchInterval: 30_000,
  });

  const notifications: AppNotification[] = data?.notifications || [];
  const unreadCount: number = data?.unreadCount || 0;

  const markReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const res = await fetch(`/api/notifications/${notificationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read" }),
      });
      if (!res.ok) throw new Error("Failed to mark as read");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/notifications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read-all", householdId: selectedHouseholdId }),
      });
      if (!res.ok) throw new Error("Failed to mark all as read");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  function handleNotificationClick(n: AppNotification) {
    if (n.status === "PENDING") {
      markReadMutation.mutate(n.id);
    }

    if (n.referenceType === "task" && n.referenceId) {
      setNotificationPanelOpen(false);
      setActiveTab("dashboard");
      setTimeout(() => {
        openTaskDetail({ id: n.referenceId } as any);
      }, 100);
    } else if (n.referenceType === "autonomy") {
      setNotificationPanelOpen(false);
      setActiveTab("autonomy");
    }
  }

  return (
    <>
      {/* H-1 FIX: Desktop: Popover-style panel */}
      {!isMobile && notificationPanelOpen && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setNotificationPanelOpen(false)}
        >
          <div className="absolute top-14 right-4 lg:right-6 w-96 max-h-[70vh] bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] shadow-2xl z-50 flex flex-col anna-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <NotificationListContent
              notifications={notifications}
              unreadCount={unreadCount}
              isLoading={isLoading}
              onNotificationClick={handleNotificationClick}
              onMarkAllRead={() => markAllReadMutation.mutate()}
              isMarkingAll={markAllReadMutation.isPending}
            />
          </div>
        </div>
      )}

      {/* H-1 FIX: Mobile: Sheet overlay (only rendered on mobile via useIsMobile) */}
      {isMobile && (
        <Sheet open={notificationPanelOpen} onOpenChange={setNotificationPanelOpen}>
          <SheetContent side="right" className="w-full sm:w-96 anna-scroll">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Bell size={18} />
                Notifications
              </SheetTitle>
              <SheetDescription>
                Stay updated on your household tasks
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4">
              <NotificationListContent
                notifications={notifications}
                unreadCount={unreadCount}
                isLoading={isLoading}
                onNotificationClick={handleNotificationClick}
                onMarkAllRead={() => markAllReadMutation.mutate()}
                isMarkingAll={markAllReadMutation.isPending}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}

function NotificationListContent({
  notifications,
  unreadCount,
  isLoading,
  onNotificationClick,
  onMarkAllRead,
  isMarkingAll,
}: {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  onNotificationClick: (n: AppNotification) => void;
  onMarkAllRead: () => void;
  isMarkingAll: boolean;
}) {
  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl bg-[var(--anna-border)]" />
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Header with unread count and mark-all */}
      {unreadCount > 0 && (
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <span className="text-xs font-medium text-[var(--anna-slate)]">
            {unreadCount} unread
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onMarkAllRead}
            disabled={isMarkingAll}
            className="text-xs text-[var(--anna-sage-dark)] hover:text-[var(--anna-sage-dark)] h-7 px-2"
          >
            <CheckCheck size={12} className="mr-1" />
            Mark all read
          </Button>
        </div>
      )}

      <Separator className="bg-[var(--anna-border)]" />

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto anna-scroll max-h-[50vh] md:max-h-[55vh]">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[var(--anna-sage-light)] flex items-center justify-center mb-4">
              <BellOff size={20} className="text-[var(--anna-muted)]" />
            </div>
            <p className="text-sm font-medium text-[var(--anna-slate)]">No notifications yet</p>
            <p className="text-xs text-[var(--anna-muted)] mt-1">
              Notifications will appear here when tasks are updated
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--anna-border)]">
            {notifications.map((n) => {
              const Icon = EVENT_ICONS[n.eventType] || Bell;
              const colorClass = EVENT_COLORS[n.eventType] || "text-[var(--anna-muted)]";
              const isUnread = n.status === "PENDING";

              return (
                <button
                  key={n.id}
                  onClick={() => onNotificationClick(n)}
                  className={cn(
                    "w-full text-left px-4 py-3 flex items-start gap-3 transition-colors hover:bg-[var(--anna-sage-light)]/50",
                    isUnread && "bg-[var(--anna-sage-light)]/30"
                  )}
                >
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
                    isUnread ? "bg-[var(--anna-white)] shadow-sm" : "bg-[var(--anna-bg)]"
                  )}>
                    <Icon size={14} className={colorClass} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn(
                        "text-sm leading-tight",
                        isUnread ? "font-semibold text-[var(--anna-slate)]" : "text-[var(--anna-slate-light)]"
                      )}>
                        {n.title}
                      </p>
                      {isUnread && (
                        <span className="w-2 h-2 rounded-full bg-[var(--anna-sage-dark)] flex-shrink-0 mt-1.5" />
                      )}
                    </div>
                    <p className="text-xs text-[var(--anna-muted)] mt-0.5 line-clamp-2">
                      {n.body}
                    </p>
                    <p className="text-[10px] text-[var(--anna-muted)] mt-1 font-data">
                      {formatRelativeTime(n.createdAt)}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}