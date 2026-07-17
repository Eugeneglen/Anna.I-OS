"use client";

import { Badge } from "@/components/ui/badge";
import { CategoryIcon, getCategoryLabel } from "./category-icon";
import { formatSgd, formatDate, STATUS_LABELS, type Task, type TaskStatus } from "@/lib/types";
import { useAnnaStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Star, Clock, RotateCcw } from "lucide-react";

const statusStyles: Record<TaskStatus, string> = {
  CREATED: "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)] border-[var(--anna-warning)]/20",
  DISPATCHED: "bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  IN_PROGRESS: "bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  COMPLETED: "bg-[var(--anna-slate-light)]/15 text-[var(--anna-slate-light)] border-[var(--anna-slate-light)]/20",
  VERIFIED: "bg-[var(--anna-success)]/15 text-[var(--anna-success)] border-[var(--anna-success)]/20",
  ESCROW_RELEASED: "bg-[var(--anna-muted)]/15 text-[var(--anna-muted)] border-[var(--anna-muted)]/20",
  DISPUTED: "bg-[var(--anna-error)]/15 text-[var(--anna-error)] border-[var(--anna-error)]/20",
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
          {/* Top row: category + status */}
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-sm font-semibold text-[var(--anna-slate)]">
              {getCategoryLabel(task.category)}
            </span>
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
            {booking?.vendor?.name && (
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