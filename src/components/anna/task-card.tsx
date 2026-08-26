"use client";

import { Badge } from "@/components/ui/badge";
import { CategoryIcon, getCategoryLabel } from "./category-icon";
import { formatSgd, formatDate, STATUS_LABELS, type Task, type TaskStatus } from "@/lib/types";
import { useAnnaStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Star, Clock, RotateCcw, Zap, Search, CheckCircle2 } from "lucide-react";
import { JobNoBadge } from "@/components/shared/job-no-badge";

const statusStyles: Record<TaskStatus, string> = {
  PREDICTED: "bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  CREATED: "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)] border-[var(--anna-warning)]/20",
  MATCHING: "bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  ACCEPTED: "bg-[var(--anna-success)]/15 text-[var(--anna-success)] border-[var(--anna-success)]/20",
  SCHEDULED: "bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  IN_PROGRESS: "bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  COMPLETED: "bg-[var(--anna-slate-light)]/15 text-[var(--anna-slate-light)] border-[var(--anna-slate-light)]/20",
  VERIFIED: "bg-[var(--anna-success)]/15 text-[var(--anna-success)] border-[var(--anna-success)]/20",
  ESCROW_RELEASED: "bg-[var(--anna-muted)]/15 text-[var(--anna-muted)] border-[var(--anna-muted)]/20",
  DISPUTED: "bg-[var(--anna-error)]/15 text-[var(--anna-error)] border-[var(--anna-error)]/20",
  CANCELLED: "bg-[var(--anna-muted)]/15 text-[var(--anna-muted)] border-[var(--anna-muted)]/20",
};

interface TaskCardProps {
  task: Task;
  isExpanded?: boolean;
}

export function TaskCard({ task, isExpanded = false }: TaskCardProps) {
  const { openTaskDetail, selectedTaskId, setRebookData, setActiveTab } = useAnnaStore();
  const isSelected = selectedTaskId === task.id;

  const booking = task.bookings?.[0];
  const isCompleted = task.status === "COMPLETED" || task.status === "VERIFIED" || task.status === "ESCROW_RELEASED";

  function handleRebook(e: React.MouseEvent) {
    e.stopPropagation();
    setRebookData({
      category: task.category,
      instructions: task.instructions ?? "",
      amountCents: task.amountCents,
    });
    setActiveTab("services");
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openTaskDetail(task)}
      onKeyDown={(e) => e.key === "Enter" && openTaskDetail(task)}
      className={cn(
        "w-full text-left p-4 rounded-2xl border transition-all duration-200",
        isSelected
          ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/50 shadow-sm"
          : "border-[var(--anna-border)] bg-[var(--anna-white)] hover:border-[var(--anna-sage)]/40 hover:shadow-sm",
        isExpanded && "ring-1 ring-[var(--anna-sage)]/20"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Category Icon */}
        <div className="shrink-0 mt-0.5">
          <CategoryIcon category={task.category} size={16} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Top row: job number + status */}
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <JobNoBadge jobNo={task.jobNo} size="sm" />
              <span className="text-sm font-semibold text-[var(--anna-slate)] truncate">
                {getCategoryLabel(task.category)}
              </span>
            </div>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-2 py-0.5 font-medium shrink-0",
                statusStyles[task.status]
              )}
            >
              {STATUS_LABELS[task.status]}
            </Badge>
          </div>

          {/* Instructions */}
          {task.instructions && (
            <p className="text-xs text-[var(--anna-muted)] line-clamp-2 mb-2">
              {task.instructions}
            </p>
          )}

          {/* MATCHING: pulsing dot animation */}
          {task.status === "MATCHING" && (
            <div className="flex items-center gap-1.5 text-[11px] mt-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--anna-sage)] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--anna-sage-dark)]" />
              </span>
              <span className="text-[var(--anna-sage-dark)]">Searching for Provider</span>
            </div>
          )}
          {/* ACCEPTED: provider accepted indicator */}
          {task.status === "ACCEPTED" && (
            <div className="flex items-center gap-1.5 text-[11px] mt-1.5">
              <CheckCircle2 size={12} className="text-[var(--anna-success)]" />
              <span className="text-[var(--anna-success)]">Provider Accepted</span>
            </div>
          )}
          {/* SCHEDULED: awaiting dispatch with date/time */}
          {task.status === "SCHEDULED" && (
            <div className="flex items-center gap-1.5 text-[11px] mt-1.5">
              <Clock size={12} className="text-[var(--anna-sage-dark)]" />
              <span className="text-[var(--anna-sage-dark)]">Awaiting Dispatch</span>
              {task.scheduledAt && (
                <span className="text-[var(--anna-muted)]">&middot; {formatDate(task.scheduledAt)}</span>
              )}
            </div>
          )}
          {/* Meta row */}
          <div className="flex items-center gap-3 text-[11px]">
            <span className="font-data font-semibold text-[var(--anna-slate)]">
              {formatSgd(task.amountCents)}
            </span>
            <span className="text-[var(--anna-border)]">|</span>
            <span className="text-[var(--anna-muted)] flex items-center gap-1">
              <Clock size={10} />
              {formatDate(task.scheduledStart ?? booking?.scheduledStart ?? task.createdAt)}
            </span>
            {/* Hide vendor name during MATCHING (anonymous matching) */}
            {task.status !== "MATCHING" && booking?.vendor?.name && (
              <>
                <span className="text-[var(--anna-border)]">|</span>
                <span className="text-[var(--anna-slate-light)]">
                  {booking.vendor.name}
                </span>
              </>
            )}
            {isCompleted && booking?.rating && (
              <>
                <span className="text-[var(--anna-border)]">|</span>
                <span className="flex items-center gap-0.5 text-[var(--anna-warning)]">
                  <Star size={10} fill="currentColor" />
                  <span className="font-data">{booking.rating}</span>
                </span>
              </>
            )}
          </div>

          {/* Automation badge */}
          {task.metadata && (task.metadata as Record<string, unknown>).autoDispatched && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--anna-sage-dark)] bg-[var(--anna-sage)]/10 rounded-full px-2 py-0.5 mt-2">
              <Zap size={9} /> Auto
            </span>
          )}

          {/* Rebook button — own row, always visible on completed tasks */}
          {isCompleted && (
            <button
              type="button"
              onClick={handleRebook}
              className="mt-3 w-full inline-flex items-center justify-center gap-1.5 h-8 text-xs font-semibold rounded-xl border border-[var(--anna-sage)]/30 text-[var(--anna-sage-dark)] bg-[var(--anna-sage-light)]/40 hover:bg-[var(--anna-sage-light)]/70 hover:border-[var(--anna-sage)]/50 transition-colors cursor-pointer select-none"
            >
              <RotateCcw size={13} />
              Rebook
            </button>
          )}
        </div>
      </div>
    </div>
  );
}