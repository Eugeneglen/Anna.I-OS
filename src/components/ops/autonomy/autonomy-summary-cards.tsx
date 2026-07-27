"use client";

import { Users, BarChart3, TrendingUp, Zap } from "lucide-react";
import { OpsStatCard } from "@/components/ops/ops-kpi-card";

// ============================================================
// Anna.I — Ops Autonomy Summary Cards
// ============================================================
// The 4-card KPI grid shown at the top of the Autonomy page:
//   1. Households
//   2. Avg Level
//   3. At Max Level
//   4. Ready to Promote (amber-themed)
//
// Uses the shared `OpsStatCard` primitive. The first three cards
// inherit the default sage-light icon theme; the "Ready to Promote"
// card overrides with amber-50 / amber-600 to preserve the original
// page's visual emphasis on the actionable metric.
// ============================================================

interface PipelineEntry {
  ready: number;
  inProgress?: number;
  category?: string;
}

export interface AutonomySummary {
  totalHouseholds?: number;
  avgLevel?: number;
  atMaxLevel?: number;
  pipeline?: PipelineEntry[];
}

interface AutonomySummaryCardsProps {
  summary: AutonomySummary;
}

export function AutonomySummaryCards({ summary }: AutonomySummaryCardsProps) {
  const pipeline = summary.pipeline || [];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <OpsStatCard
        icon={<Users size={18} />}
        value={summary.totalHouseholds || 0}
        label="Households"
      />
      <OpsStatCard
        icon={<BarChart3 size={18} />}
        value={summary.avgLevel || 0}
        label="Avg Level"
      />
      <OpsStatCard
        icon={<TrendingUp size={18} />}
        value={summary.atMaxLevel || 0}
        label="At Max Level"
      />
      <OpsStatCard
        icon={<Zap size={18} />}
        iconBg="bg-amber-50"
        iconColor="text-amber-600"
        value={pipeline.reduce((s, p) => s + p.ready, 0)}
        label="Ready to Promote"
      />
    </div>
  );
}
