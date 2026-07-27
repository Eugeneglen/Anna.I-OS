"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ============================================================
// Anna.I — Ops Loading Skeleton
// ============================================================
// Reusable loading placeholder for list/table pages.
// Renders N skeleton rows of a given height.
// ============================================================

interface OpsLoadingRowsProps {
  count?: number;
  className?: string;
  rowClassName?: string;
}

export function OpsLoadingRows({
  count = 3,
  className,
  rowClassName = "h-20",
}: OpsLoadingRowsProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("w-full rounded-2xl bg-[var(--anna-border)]", rowClassName)}
        />
      ))}
    </div>
  );
}

/** Skeleton grid for KPI/stat cards (used on escrow, config, autonomy). */
export function OpsLoadingCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-2xl bg-[var(--anna-border)]" />
      ))}
    </div>
  );
}
