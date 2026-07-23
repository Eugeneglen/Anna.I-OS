"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, AlertTriangle, Wallet, Clock, ShieldCheck, XCircle, Sparkles, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";

// ─── Types ───────────────────────────────────────────────

interface VendorNotification {
  id: string;
  eventType: string;
  title: string;
  body: string;
  status: string;
  referenceType?: string | null;
  referenceId?: string | null;
  createdAt: string;
  readAt?: string | null;
}

interface NotificationsResponse {
  notifications: VendorNotification[];
  unreadCount: number;
}

// ─── Event type styling ─────────────────────────────────

const EVENT_STYLES: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  DISPUTE_RAISED: {
    icon: AlertTriangle,
    color: "text-[var(--anna-error)]",
    bg: "bg-[var(--anna-error)]/10 border-[var(--anna-error)]/15",
  },
  DISPUTE_RESOLVED: {
    icon: RotateCcw,
    color: "text-[var(--anna-sage-dark)]",
    bg: "bg-[var(--anna-sage-light)]/30 border-[var(--anna-sage)]/15",
  },
  ESCROW_RELEASED: {
    icon: Wallet,
    color: "text-[var(--anna-sage-dark)]",
    bg: "bg-[var(--anna-sage-light)]/30 border-[var(--anna-sage)]/15",
  },
  TASK_DISPATCHED: {
    icon: Clock,
    color: "text-[var(--anna-slate)]",
    bg: "bg-[var(--anna-bg)] border-[var(--anna-border)]",
  },
  VERIFICATION_APPROVED: {
    icon: ShieldCheck,
    color: "text-[var(--anna-success)]",
    bg: "bg-[var(--anna-success)]/10 border-[var(--anna-success)]/15",
  },
  VERIFICATION_REJECTED: {
    icon: XCircle,
    color: "text-[var(--anna-error)]",
    bg: "bg-[var(--anna-error)]/10 border-[var(--anna-error)]/15",
  },
  SYSTEM_ALERT: {
    icon: AlertTriangle,
    color: "text-[var(--anna-warning)]",
    bg: "bg-[var(--anna-warning)]/10 border-[var(--anna-warning)]/15",
  },
  AUTONOMY_PROMOTED: {
    icon: Sparkles,
    color: "text-[var(--anna-sage-dark)]",
    bg: "bg-[var(--anna-sage-light)]/30 border-[var(--anna-sage)]/15",
  },
};

function getEventStyle(eventType: string) {
  return EVENT_STYLES[eventType] ?? {
    icon: Bell,
    color: "text-[var(--anna-muted)]",
    bg: "bg-[var(--anna-bg)] border-[var(--anna-border)]",
  };
}

function formatEventTime(createdAt: string): string {
  const date = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDate(createdAt);
}

// ─── Notification Item ───────────────────────────────────

function NotificationItem({
  notification,
  onMarkRead,
}: {
  notification: VendorNotification;
  onMarkRead: (id: string) => void;
}) {
  const isUnread = notification.status === "PENDING";
  const style = getEventStyle(notification.eventType);
  const Icon = style.icon;

  return (
    <button
      type="button"
      onClick={() => {
        if (isUnread) onMarkRead(notification.id);
      }}
      className={cn(
        "w-full text-left p-3 rounded-xl border transition-all hover:shadow-sm",
        isUnread
          ? cn(style.bg, "ring-1")
          : "bg-[var(--anna-bg)] border-[var(--anna-border)]"
      )}
    >
      <div className="flex gap-3">
        <div className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
          isUnread ? style.bg : "bg-[var(--anna-border)]/30"
        )}>
          <Icon size={14} className={style.color} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className={cn(
              "text-xs font-semibold truncate",
              isUnread ? "text-[var(--anna-slate)]" : "text-[var(--anna-slate-light)]"
            )}>
              {notification.title}
            </p>
            {isUnread && (
              <div className="w-2 h-2 rounded-full bg-[var(--anna-sage)] shrink-0" />
            )}
          </div>
          <p className="text-[11px] text-[var(--anna-muted)] mt-0.5 line-clamp-2 leading-relaxed">
            {notification.body}
          </p>
          <p className="text-[10px] text-[var(--anna-muted)]/60 mt-1">
            {formatEventTime(notification.createdAt)}
          </p>
        </div>
      </div>
    </button>
  );
}

// ─── Main Component ─────────────────────────────────────

interface VendorNotificationPanelProps {
  vendorId: string;
  compact?: boolean; // Sidebar mode — just bell + count, no label
}

export function VendorNotificationPanel({ vendorId, compact }: VendorNotificationPanelProps) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<NotificationsResponse>({
    queryKey: ["vendor-notifications", vendorId],
    queryFn: async () => {
      const res = await fetch(`/api/vendors/${vendorId}/notifications`);
      if (!res.ok) throw new Error("Failed to fetch notifications");
      return res.json();
    },
    enabled: !!vendorId,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const unreadCount = data?.unreadCount ?? 0;

  const markReadMutation = useMutation({
    mutationFn: async ({ notificationId, markAll }: { notificationId?: string; markAll?: boolean }) => {
      const url = markAll
        ? `/api/vendors/${vendorId}/notifications/null`
        : `/api/vendors/${vendorId}/notifications/${notificationId}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: !!markAll }),
      });
      if (!res.ok) throw new Error("Failed to mark read");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendor-notifications", vendorId] });
    },
  });

  const handleMarkRead = (notificationId: string) => {
    markReadMutation.mutate({ notificationId });
  };

  const handleMarkAllRead = () => {
    markReadMutation.mutate({ markAll: true });
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative inline-flex items-center gap-2 hover:bg-[var(--anna-sage-light)] rounded-lg transition-colors",
            compact ? "h-8 w-8 items-center justify-center" : "h-9 px-2.5"
          )}
        >
          <Bell size={compact ? 16 : 15} className="text-[var(--anna-slate-light)]" />
          {!compact && (
            <span className="text-xs font-medium text-[var(--anna-slate-light)]">Notifications</span>
          )}
          {unreadCount > 0 && (
            <span className={cn(
              "rounded-full bg-[var(--anna-error)] text-white font-bold flex items-center justify-center ring-2 ring-[var(--anna-white)]",
              compact ? "absolute -top-0.5 -right-0.5 w-4 h-4 text-[9px]" : "h-5 min-w-5 px-1.5 text-[10px]"
            )}>
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:w-96 p-0 rounded-l-3xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--anna-border)] bg-gradient-to-r from-[var(--anna-sage-light)]/30 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--anna-sage)]/15 flex items-center justify-center">
              <Bell size={18} className="text-[var(--anna-sage-dark)]" />
            </div>
            <div>
              <SheetTitle className="text-sm font-bold text-[var(--anna-slate)] text-left">Notifications</SheetTitle>
              {unreadCount > 0 && (
                <p className="text-[11px] text-[var(--anna-muted)]">{unreadCount} unread</p>
              )}
            </div>
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkAllRead}
              disabled={markReadMutation.isPending}
              className="h-8 text-[11px] font-medium text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)] px-3 rounded-lg"
            >
              <CheckCheck size={13} className="mr-1.5" />
              Mark all read
            </Button>
          )}
        </div>

        {/* Notification list */}
        <div className="h-[calc(100vh-80px)] overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[var(--anna-sage-dark)]" />
            </div>
          ) : !data?.notifications?.length ? (
            <div className="flex flex-col items-center justify-center h-full text-[var(--anna-muted)]">
              <div className="w-14 h-14 rounded-2xl bg-[var(--anna-bg)] flex items-center justify-center mb-3">
                <Bell size={24} className="opacity-20" />
              </div>
              <p className="text-sm font-medium">No notifications yet</p>
              <p className="text-xs mt-1">Updates from Anna.I will appear here</p>
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="p-3 space-y-2">
                {data.notifications.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    onMarkRead={handleMarkRead}
                  />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
