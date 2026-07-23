"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAnnaStore } from "@/lib/store";
import {
  CategoryIcon,
  getCategoryLabel,
} from "./category-icon";
import { formatSgd, type Task } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  RotateCcw,
  X,
  Clock,
  ArrowRight,
  Sparkles,
  CheckCircle,
  Loader2,
  Calendar,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────

interface RebookingTask {
  id: string;
  category: string;
  instructions: string | null;
  amountCents: number;
  completedAt: string | null;
  escrowReleasedAt: string | null;
  bookings: { vendor: { name: string } | null }[];
}

// ─── Single Rebooking Card ────────────────────────────────

function RebookingCard({
  task,
  onDismiss,
}: {
  task: RebookingTask;
  onDismiss: (id: string) => void;
}) {
  const { setActiveTab, setRebookData } = useAnnaStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isRebooking, setIsRebooking] = useState(false);

  const rebookMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/tasks/${task.id}/rebook`, { method: "POST" });
      if (!res.ok) throw new Error("Rebook failed");
      return res.json();
    },
    onSuccess: (data) => {
      setIsRebooking(false);
      toast({
        title: "Task Rebooked!",
        description: `New ${getCategoryLabel(task.category as any)} task created — ready to dispatch.`,
      });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["household"] });
      onDismiss(task.id);
    },
    onError: () => {
      setIsRebooking(false);
      toast({ title: "Failed to rebook", variant: "destructive" });
    },
  });

  function handleOneClickRebook() {
    setIsRebooking(true);
    rebookMutation.mutate();
  }

  function handleCustomRebook() {
    setRebookData({
      category: task.category as any,
      instructions: task.instructions ?? "",
      amountCents: task.amountCents,
    });
    setActiveTab("services");
  }

  const vendor = task.bookings?.[0]?.vendor;
  const completedDate = task.escrowReleasedAt ?? task.completedAt;

  return (
    <div className="relative rounded-2xl border border-[var(--anna-sage)]/30 bg-gradient-to-br from-[var(--anna-sage-light)]/50 to-[var(--anna-white)] p-4 anna-fade-in overflow-hidden">
      {/* Decorative corner accent */}
      <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-[var(--anna-sage)]/8 to-transparent rounded-bl-[60px] pointer-events-none" />

      {/* Dismiss button */}
      <button
        type="button"
        onClick={() => onDismiss(task.id)}
        className="absolute top-2 right-2 w-6 h-6 rounded-full bg-white/80 hover:bg-white flex items-center justify-center transition-colors z-10"
        aria-label="Dismiss"
      >
        <X size={12} className="text-[var(--anna-muted)]" />
      </button>

      <div className="flex items-start gap-3">
        {/* Category icon */}
        <div className="shrink-0 w-10 h-10 rounded-xl bg-[var(--anna-sage)]/15 flex items-center justify-center mt-0.5">
          <CategoryIcon category={task.category as any} size={18} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Title row */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[var(--anna-slate)]">
              {getCategoryLabel(task.category as any)}
            </span>
            <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold uppercase tracking-wider bg-[var(--anna-success)]/15 text-[var(--anna-success)] px-1.5 py-0.5 rounded-md">
              <CheckCircle size={9} />
              Completed
            </span>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-3 text-[11px] text-[var(--anna-muted)]">
            <span className="font-data font-semibold text-[var(--anna-slate)]">
              {formatSgd(task.amountCents)}
            </span>
            {vendor && (
              <>
                <span className="text-[var(--anna-border)]">|</span>
                <span>{vendor.name}</span>
              </>
            )}
            {completedDate && (
              <>
                <span className="text-[var(--anna-border)]">|</span>
                <span className="flex items-center gap-1">
                  <Clock size={10} />
                  {new Date(completedDate).toLocaleDateString("en-SG", { day: "numeric", month: "short" })}
                </span>
              </>
            )}
          </div>

          {/* Rebook question */}
          <p className="text-xs text-[var(--anna-sage-dark)] font-medium">
            Need this service again?
          </p>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleOneClickRebook}
              disabled={isRebooking}
              className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl h-8 text-xs font-semibold px-3"
            >
              {isRebooking ? (
                <Loader2 size={12} className="mr-1.5 animate-spin" />
              ) : (
                <RotateCcw size={12} className="mr-1.5" />
              )}
              {isRebooking ? "Rebooking..." : "Quick Rebook"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCustomRebook}
              className="rounded-xl h-8 text-xs font-medium border-[var(--anna-sage)]/30 text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)]"
            >
              <Calendar size={12} className="mr-1.5" />
              Customise
              <ArrowRight size={11} className="ml-1" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Rebooking Prompt Banner ────────────────────────

export function RebookingPrompt({ tasks }: { tasks: Task[] }) {
  // Find tasks that recently completed (ESCROW_RELEASED within last 7 days)
  const rebookableTasks = tasks.filter((t) => {
    if (t.status !== "ESCROW_RELEASED") return false;
    const releasedAt = t.escrowReleasedAt ?? t.completedAt ?? t.createdAt;
    const daysAgo = (Date.now() - new Date(releasedAt).getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo <= 7;
  });

  // State for dismissed tasks (persisted in session)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const visibleTasks = rebookableTasks.filter((t) => !dismissedIds.has(t.id));

  if (visibleTasks.length === 0) return null;

  function handleDismiss(id: string) {
    setDismissedIds((prev) => new Set(prev).add(id));
  }

  return (
    <div className="px-4 lg:px-6 pb-3 lg:pb-4">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-lg bg-[var(--anna-sage)] flex items-center justify-center">
          <Sparkles size={12} className="text-white" />
        </div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-sage-dark)]">
          Rebook
        </h3>
        <span className="text-[10px] text-[var(--anna-sage-dark)]/70 font-normal normal-case tracking-normal">
          Recently completed services
        </span>
        <span className="font-data text-[10px] text-[var(--anna-sage-dark)] bg-[var(--anna-sage)]/10 px-1.5 py-0.5 rounded-md">
          {visibleTasks.length}
        </span>
      </div>

      {/* Rebooking cards */}
      <div className="space-y-2">
        {visibleTasks.map((task) => (
          <RebookingCard
            key={task.id}
            task={task as unknown as RebookingTask}
            onDismiss={handleDismiss}
          />
        ))}
      </div>
    </div>
  );
}
