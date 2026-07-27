"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

// ============================================================
// Anna.I — Ops Filter Panel
// ============================================================
// Expandable filter card with a grid of filter fields and an
// optional "Clear all filters" link. Used by escrow and
// anomalies pages.
// ============================================================

interface OpsFilterPanelProps {
  open: boolean;
  onClear?: () => void;
  hasActiveFilters?: boolean;
  children: ReactNode;
  className?: string;
}

export function OpsFilterPanel({
  open,
  onClear,
  hasActiveFilters,
  children,
  className,
}: OpsFilterPanelProps) {
  if (!open) return null;
  return (
    <div
      className={cn(
        "bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 space-y-3",
        className
      )}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
      {onClear && hasActiveFilters && (
        <button
          onClick={onClear}
          className="text-xs text-[var(--anna-sage-dark)] hover:underline"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}

// ── Filter field wrapper ──

interface OpsFilterFieldProps {
  label: string;
  children: ReactNode;
}

export function OpsFilterField({ label, children }: OpsFilterFieldProps) {
  return (
    <div>
      <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] block mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}

// ── Load More button ──

interface OpsLoadMoreProps {
  onClick: () => void;
  loading?: boolean;
}

export function OpsLoadMore({ onClick, loading }: OpsLoadMoreProps) {
  return (
    <div className="flex justify-center pt-2">
      <button
        onClick={onClick}
        disabled={loading}
        className="inline-flex items-center h-9 px-4 rounded-xl text-sm font-medium border border-[var(--anna-border)] bg-[var(--anna-white)] text-[var(--anna-slate-light)] hover:bg-[var(--anna-sage-light)]/40 disabled:opacity-60 transition-colors"
      >
        {loading && (
          <svg
            className="mr-1.5 h-3.5 w-3.5 animate-spin"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        )}
        Load more
      </button>
    </div>
  );
}
