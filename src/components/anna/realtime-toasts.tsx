"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  X,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
  CreditCard,
  ShieldCheck,
  Layers,
  Trophy,
  Camera,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnnaStore } from "@/lib/store";
import {
  useHouseholdEvents,
  getEventLabel,
  getEventToastVariant,
  type HouseholdEvent,
} from "@/hooks/use-household-events";
import { useQueryClient } from "@tanstack/react-query";

// ─────────────────────────────────────────────────────────────
// Toast types
// ─────────────────────────────────────────────────────────────

interface RealtimeToast {
  id: string;
  variant: "success" | "warning" | "error" | "info";
  label: string;
  body: string;
  icon: React.ElementType;
  timestamp: number;
}

const VARIANT_STYLES: Record<string, { bg: string; border: string; icon: string; text: string }> = {
  success: {
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    border: "border-emerald-200 dark:border-emerald-800",
    icon: "text-emerald-600 dark:text-emerald-400",
    text: "text-emerald-800 dark:text-emerald-200",
  },
  warning: {
    bg: "bg-amber-50 dark:bg-amber-950/40",
    border: "border-amber-200 dark:border-amber-800",
    icon: "text-amber-600 dark:text-amber-400",
    text: "text-amber-800 dark:text-amber-200",
  },
  error: {
    bg: "bg-red-50 dark:bg-red-950/40",
    border: "border-red-200 dark:border-red-800",
    icon: "text-red-600 dark:text-red-400",
    text: "text-red-800 dark:text-red-200",
  },
  info: {
    bg: "bg-[var(--anna-sage-light)]",
    border: "border-[var(--anna-border)]",
    icon: "text-[var(--anna-sage-dark)]",
    text: "text-[var(--anna-slate)]",
  },
};

const EVENT_ICONS: Record<string, React.ElementType> = {
  "escrow:state_changed": CreditCard,
  "dispute:raised": AlertTriangle,
  "dispute:resolved": ShieldCheck,
  "task:status_changed": Layers,
  "work:completed": CheckCircle2,
  "photos:uploaded": Camera,
  "autonomy:promoted": Trophy,
};

// ─────────────────────────────────────────────────────────────
// Extract human-readable body from event data
// ─────────────────────────────────────────────────────────────

function getEventBody(event: HouseholdEvent): string {
  const { type, data } = event;
  const category = (data.category as string)?.toLowerCase() || "task";
  const amountCents = data.amountCents as number;
  const amount = amountCents ? ` SGD $${(amountCents / 100).toFixed(2)}` : "";

  switch (type) {
    case "escrow:state_changed": {
      const state = (data.state as string) || "";
      if (state === "RELEASED") return `Payment${amount} has been released to the vendor for your ${category} service.`;
      if (state === "DISPUTED") return `Escrow${amount} on your ${category} service has been disputed.`;
      if (state === "REFUNDED") return `A refund${amount} has been issued for your ${category} service.`;
      if (state === "HELD") return `Escrow${amount} for your ${category} service is now being held.`;
      return `Escrow status updated for your ${category} service.`;
    }
    case "dispute:raised": {
      const reason = (data.reason as string) || "";
      return `A dispute has been raised on your ${category} task.${reason ? ` Reason: ${reason}` : ""}`;
    }
    case "dispute:resolved": {
      const resolution = (data.resolution as string) || "";
      if (resolution === "dismissed") return `The dispute on your ${category} task has been dismissed. You can re-verify the work.`;
      if (resolution === "refunded") return `The dispute on your ${category} task was upheld. A refund${amount} will be processed.`;
      return `Your ${category} dispute has been resolved.`;
    }
    case "task:status_changed": {
      const status = (data.status as string) || "";
      if (status === "DISPATCHED") return `Your ${category} task has been dispatched to a vendor.`;
      if (status === "VERIFIED") return `Your ${category} task has been verified. Escrow is ready for release.`;
      if (status === "COMPLETED") return `Your ${category} task has been marked as completed. Please verify the work.`;
      return `Your ${category} task status has been updated to ${status}.`;
    }
    case "work:completed": {
      const vendorName = (data.vendorName as string) || "Vendor";
      return `${vendorName} has completed your ${category} task. Please review and verify.`;
    }
    case "photos:uploaded": {
      const count = (data.photoCount as number) || 0;
      return `${count} new photo${count !== 1 ? "s" : ""} uploaded for your ${category} task.`;
    }
    case "autonomy:promoted": {
      const prev = (data.previousLevel as number) || 0;
      const next = (data.newLevel as number) || 0;
      return `Your ${category} autonomy level has been promoted from L${prev} to L${next}!`;
    }
    default:
      return "A new update is available. Check your notifications for details.";
  }
}

// ─────────────────────────────────────────────────────────────
// Single Toast Item
// ─────────────────────────────────────────────────────────────

function ToastItem({
  toast,
  onDismiss,
  onClick,
}: {
  toast: RealtimeToast;
  onDismiss: () => void;
  onClick: () => void;
}) {
  const styles = VARIANT_STYLES[toast.variant] || VARIANT_STYLES.info;
  const Icon = toast.icon;

  return (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg cursor-pointer transition-all duration-300",
        "hover:shadow-xl hover:scale-[1.01]",
        "animate-[slideInRight_0.3s_ease-out]",
        styles.bg,
        styles.border
      )}
      onClick={onClick}
      role="alert"
    >
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5", styles.bg)}>
        <Icon size={16} className={styles.icon} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn("text-sm font-semibold", styles.text)}>{toast.label}</p>
        <p className="text-xs text-[var(--anna-muted)] mt-0.5 line-clamp-2">{toast.body}</p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex-shrink-0"
      >
        <X size={14} className="text-[var(--anna-muted)]" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Realtime Toasts Container
// ─────────────────────────────────────────────────────────────

const MAX_TOASTS = 4;
const TOAST_DURATION = 6000; // auto-dismiss after 6s

export function RealtimeToasts() {
  const { selectedHouseholdId } = useAnnaStore();
  const queryClient = useQueryClient();
  const [toasts, setToasts] = useState<RealtimeToast[]>([]);
  const dismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Dismiss a toast
  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = dismissTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      dismissTimers.current.delete(id);
    }
  }, []);

  // Add a toast
  const addToast = useCallback(
    (event: HouseholdEvent) => {
      const id = `${event.type}-${event.timestamp}`;
      // Deduplicate: don't show same event twice
      setToasts((prev) => {
        if (prev.some((t) => t.id === id)) return prev;
        return [
          {
            id,
            variant: getEventToastVariant(event.type),
            label: getEventLabel(event.type),
            body: getEventBody(event),
            icon: EVENT_ICONS[event.type] || Info,
            timestamp: Date.now(),
          },
          ...prev,
        ].slice(0, MAX_TOASTS);
      });

      // Auto-dismiss after duration
      const timer = setTimeout(() => dismissToast(id), TOAST_DURATION);
      dismissTimers.current.set(id, timer);
    },
    [dismissToast]
  );

  // Event handler: invalidate relevant queries when events arrive
  const handleEvent = useCallback(
    (event: HouseholdEvent) => {
      addToast(event);

      // Invalidate relevant React Query caches
      const queryKeys: string[][] = [];

      // All events → invalidate tasks list (status may have changed)
      if (
        event.type.startsWith("escrow") ||
        event.type.startsWith("dispute") ||
        event.type.startsWith("task") ||
        event.type.startsWith("work") ||
        event.type.startsWith("photos")
      ) {
        queryKeys.push(["tasks"], ["dashboard"]);
      }

      // Escrow events → invalidate escrow panel
      if (event.type.startsWith("escrow")) {
        queryKeys.push(["escrow"]);
      }

      // Autonomy events → invalidate autonomy panel
      if (event.type.startsWith("autonomy")) {
        queryKeys.push(["autonomy"], ["household-graph"]);
      }

      // Invalidate notifications count (new notification created)
      queryKeys.push(["notifications"]);

      // Perform invalidation
      for (const key of queryKeys) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    },
    [addToast, queryClient]
  );

  // Connect to household events WebSocket
  useHouseholdEvents(selectedHouseholdId || null, {
    onEvent: handleEvent,
  });

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 z-[60] w-80 max-w-[calc(100vw-2rem)] space-y-2 pointer-events-auto">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={() => dismissToast(toast.id)}
          onClick={() => {
            // Click toast → open notification panel + dismiss
            useAnnaStore.getState().setNotificationPanelOpen(true);
            dismissToast(toast.id);
          }}
        />
      ))}
    </div>
  );
}
