"use client";

import { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// Anna.I — Ops KPI / Stat Cards
// ============================================================
// Two variants:
//  - OpsKpiCard: amount-based card with coloured state theming
//    (escrow page style: label + icon + amount + count).
//  - OpsStatCard: icon-in-square + big number + label
//    (autonomy page style).
//
// Callers pass a Lucide icon element (e.g. `<Clock size={16} />`)
// and the appropriate colour classes.
// ============================================================

interface OpsKpiCardProps {
  label: string;
  icon: ReactNode;
  /** Tailwind classes for theming. */
  cardBg?: string;
  iconBg?: string;
  iconColor?: string;
  amountColor?: string;
  amount: ReactNode;
  sublabel?: ReactNode;
  /** Makes the card clickable (opens a drill-down dialog). */
  onClick?: () => void;
  /** Tooltip shown on hover. */
  title?: string;
}

export function OpsKpiCard({
  label,
  icon,
  cardBg = "bg-[var(--anna-white)]",
  iconBg = "bg-[var(--anna-sage-light)]",
  iconColor = "text-[var(--anna-sage-dark)]",
  amountColor = "text-[var(--anna-slate)]",
  amount,
  sublabel,
  onClick,
  title,
}: OpsKpiCardProps) {
  const interactive = !!onClick;
  return (
    <div
      className={cn(
        "rounded-2xl border border-[var(--anna-border)] p-4",
        cardBg,
        interactive && "hover:shadow-sm hover:border-[var(--anna-sage)]/30 transition-all cursor-pointer"
      )}
      onClick={onClick}
      title={title}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
          {label}
        </span>
        <div className="flex items-center gap-1">
          {interactive && (
            <ChevronRight size={12} className="text-[var(--anna-muted)]" />
          )}
          <div
            className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center",
              iconBg,
              iconColor
            )}
          >
            {icon}
          </div>
        </div>
      </div>
      <p className={cn("text-lg font-bold font-data", amountColor)}>{amount}</p>
      {sublabel && (
        <p className="text-[10px] text-[var(--anna-muted)] mt-0.5 font-data">
          {sublabel}
        </p>
      )}
    </div>
  );
}

// ── Stat card (icon square + big number) ──

interface OpsStatCardProps {
  icon: ReactNode;
  value: ReactNode;
  label: string;
  iconBg?: string;
  iconColor?: string;
  onClick?: () => void;
}

export function OpsStatCard({
  icon,
  value,
  label,
  iconBg = "bg-[var(--anna-sage-light)]",
  iconColor = "text-[var(--anna-sage-dark)]",
  onClick,
}: OpsStatCardProps) {
  return (
    <div
      className={cn(
        "bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4",
        onClick && "hover:shadow-sm transition-shadow cursor-pointer"
      )}
      onClick={onClick}
    >
      <div
        className={cn(
          "w-9 h-9 rounded-xl flex items-center justify-center",
          iconBg,
          iconColor
        )}
      >
        {icon}
      </div>
      <p className="mt-3 font-data text-2xl font-bold text-[var(--anna-slate)] leading-none">
        {value}
      </p>
      <p className="mt-1 text-xs text-[var(--anna-muted)]">{label}</p>
    </div>
  );
}

// ── Section header (coloured dot + title + count) ──

interface OpsSectionHeaderProps {
  dotColor?: string;
  title: ReactNode;
  count?: ReactNode;
}

export function OpsSectionHeader({
  dotColor = "bg-[var(--anna-sage-dark)]",
  title,
  count,
}: OpsSectionHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-[var(--anna-slate)] flex items-center gap-2">
        <div className={cn("w-2 h-2 rounded-full", dotColor)} />
        {title}
      </h3>
      {count !== undefined && (
        <span className="text-xs text-[var(--anna-muted)] font-data">{count}</span>
      )}
    </div>
  );
}
