"use client";

import { Megaphone, Ticket, TrendingUp, FileEdit } from "lucide-react";
import { OpsKpiCard } from "@/components/ops/ops-kpi-card";

// ============================================================
// Anna.I — Ops Marketing Summary Cards
// ============================================================
// Renders the 4 KPI cards above the campaign list:
//   1. Active campaigns
//   2. Total redemptions (sum across campaigns)
//   3. Total codes (sum of _count.codes)
//   4. Draft campaigns (pending review)
// All numbers are derived client-side from the list response —
// the list endpoint does not return a server-side aggregate.
// ============================================================

interface CampaignSummaryCardsProps {
  activeCount: number;
  totalRedemptions: number;
  totalCodes: number;
  draftCount: number;
}

export function CampaignSummaryCards({
  activeCount,
  totalRedemptions,
  totalCodes,
  draftCount,
}: CampaignSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <OpsKpiCard
        label="Active"
        icon={<Megaphone size={16} />}
        cardBg="bg-[var(--anna-white)]"
        iconBg="bg-emerald-50"
        iconColor="text-emerald-700"
        amount={activeCount}
        sublabel="Running campaigns"
      />
      <OpsKpiCard
        label="Redemptions"
        icon={<TrendingUp size={16} />}
        cardBg="bg-[var(--anna-white)]"
        iconBg="bg-[var(--anna-sage-light)]"
        iconColor="text-[var(--anna-sage-dark)]"
        amount={totalRedemptions}
        sublabel="All-time total"
      />
      <OpsKpiCard
        label="Codes"
        icon={<Ticket size={16} />}
        cardBg="bg-[var(--anna-white)]"
        iconBg="bg-[var(--anna-sage-light)]"
        iconColor="text-[var(--anna-sage-dark)]"
        amount={totalCodes}
        sublabel="Generated codes"
      />
      <OpsKpiCard
        label="Drafts"
        icon={<FileEdit size={16} />}
        cardBg="bg-[var(--anna-white)]"
        iconBg="bg-[var(--anna-bg)]"
        iconColor="text-[var(--anna-muted)]"
        amount={draftCount}
        sublabel="Awaiting activation"
      />
    </div>
  );
}
