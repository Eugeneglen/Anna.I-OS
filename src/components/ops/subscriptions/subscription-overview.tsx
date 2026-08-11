"use client";

import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSgd } from "@/lib/ops-format";

// ============================================================
// Anna.I — Ops Subscriptions Overview (KPI cards + filter bar)
// ============================================================
// Two presentational pieces shown above the subscription list:
//   1. SubscriptionSummaryCards — the 4 KPI cards (Total Active,
//      Monthly MRR, Home Tier, Care Tier).
//   2. SubscriptionFilterBar — the tier + status pill rows used
//      to scope the list query.
// Both are pure functions of their props; all state lives in
// the page.
// ============================================================

export interface SubscriptionSummary {
  totalActive: number;
  activeHome: number;
  activeCare: number;
  totalMrrCents: number;
}

interface SubscriptionSummaryCardsProps {
  summary: SubscriptionSummary;
}

export function SubscriptionSummaryCards({ summary }: SubscriptionSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Total Active</p>
        <p className="text-2xl font-bold font-data text-[var(--anna-slate)] mt-1">{summary.totalActive}</p>
        <p className="text-xs text-[var(--anna-muted)] mt-0.5">
          {summary.activeHome} Home · {summary.activeCare} Care
        </p>
      </div>
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Monthly MRR</p>
        <p className="text-2xl font-bold font-data text-[var(--anna-slate)] mt-1">
          {formatSgd(summary.totalMrrCents)}
        </p>
        <p className="text-xs text-emerald-600 mt-0.5 flex items-center gap-1">
          <TrendingUp size={12} /> Recurring revenue
        </p>
      </div>
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Home Tier</p>
        <p className="text-2xl font-bold font-data text-[var(--anna-sage-dark)] mt-1">{summary.activeHome}</p>
        <p className="text-xs text-[var(--anna-muted)] mt-0.5">{formatSgd(summary.activeHome * 800)}/mo</p>
      </div>
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Care Tier</p>
        <p className="text-2xl font-bold font-data text-purple-700 mt-1">{summary.activeCare}</p>
        <p className="text-xs text-[var(--anna-muted)] mt-0.5">{formatSgd(summary.activeCare * 6800)}/mo</p>
      </div>
    </div>
  );
}

const TIER_PILLS = [
  { key: null, label: "All" },
  { key: "HOME", label: "Home" },
  { key: "CARE", label: "Care" },
];

const STATUS_PILLS = [
  { key: null, label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "CANCELLED", label: "Cancelled" },
  { key: "PAST_DUE", label: "Past Due" },
];

interface SubscriptionFilterBarProps {
  tierFilter: string | null;
  onTierFilterChange: (value: string | null) => void;
  statusFilter: string | null;
  onStatusFilterChange: (value: string | null) => void;
}

export function SubscriptionFilterBar({
  tierFilter,
  onTierFilterChange,
  statusFilter,
  onStatusFilterChange,
}: SubscriptionFilterBarProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <div className="flex items-center gap-1 bg-[var(--anna-bg)] rounded-xl p-0.5">
        {TIER_PILLS.map((pill) => (
          <button
            key={pill.key || "all"}
            onClick={() => onTierFilterChange(pill.key)}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-lg transition-colors",
              tierFilter === pill.key
                ? "bg-[var(--anna-white)] text-[var(--anna-slate)] shadow-sm"
                : "text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
            )}
          >
            {pill.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 bg-[var(--anna-bg)] rounded-xl p-0.5">
        {STATUS_PILLS.map((pill) => (
          <button
            key={pill.key || "all-status"}
            onClick={() => onStatusFilterChange(pill.key)}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-lg transition-colors",
              statusFilter === pill.key
                ? "bg-[var(--anna-white)] text-[var(--anna-slate)] shadow-sm"
                : "text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
            )}
          >
            {pill.label}
          </button>
        ))}
      </div>
    </div>
  );
}
