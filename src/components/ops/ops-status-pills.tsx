"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

// ============================================================
// Anna.I — Ops Status Pill Row
// ============================================================
// Horizontal scrollable row of filter pills (e.g. All / Active /
// Resolved). Used by escrow and anomalies pages.
// ============================================================

export interface PillOption {
  value: string;
  label: string;
  /** Optional count badge shown next to the label. */
  count?: number;
}

interface OpsStatusPillRowProps {
  options: PillOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function OpsStatusPillRow({
  options,
  value,
  onChange,
  className,
}: OpsStatusPillRowProps) {
  return (
    <div
      className={cn(
        "flex gap-2 overflow-x-auto pb-1 -mx-1 px-1",
        className
      )}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5",
              active
                ? "bg-[var(--anna-sage-dark)] text-white"
                : "bg-[var(--anna-white)] text-[var(--anna-slate-light)] border border-[var(--anna-border)] hover:bg-[var(--anna-sage-light)]/50"
            )}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span
                className={cn(
                  "font-data text-[10px]",
                  active ? "opacity-90" : "opacity-70"
                )}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Filter toggle button (pairs with OpsFilterPanel) ──

interface OpsFilterToggleButtonProps {
  active: boolean;
  activeCount: number;
  onClick: () => void;
  children?: ReactNode;
}

export function OpsFilterToggleButton({
  active,
  activeCount,
  onClick,
  children = "Filters",
}: OpsFilterToggleButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center h-9 px-3 rounded-xl text-xs font-medium border transition-colors",
        active
          ? "bg-[var(--anna-sage-light)] border-[var(--anna-sage)]/30 text-[var(--anna-slate)]"
          : "bg-[var(--anna-white)] border-[var(--anna-border)] text-[var(--anna-slate-light)] hover:bg-[var(--anna-sage-light)]/40"
      )}
    >
      <svg
        className="mr-1.5 h-3.5 w-3.5"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
      </svg>
      {children}
      {activeCount > 0 && (
        <span className="ml-1.5 w-4 h-4 rounded-full bg-[var(--anna-sage-dark)] text-white text-[10px] font-data flex items-center justify-center">
          {activeCount}
        </span>
      )}
    </button>
  );
}
