"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { BarChart3, Users, Ticket } from "lucide-react";
import { InsightsTab } from "@/components/ops/marketing/insights-tab";
import { SegmentsTab } from "@/components/ops/marketing/segments-tab";
import { CampaignsTab } from "@/components/ops/marketing/campaigns-tab";

// ============================================================
// Anna.I — Ops Marketing Page (Phase 2 restructure)
// ============================================================
// Three sub-tabs: Insights (behaviour analytics), Segments
// (dynamic segment builder), Campaigns (existing campaign list).
// ============================================================

type Tab = "insights" | "segments" | "campaigns";

const TABS: { id: Tab; label: string; icon: typeof BarChart3 }[] = [
  { id: "insights", label: "Insights", icon: BarChart3 },
  { id: "segments", label: "Segments", icon: Users },
  { id: "campaigns", label: "Campaigns", icon: Ticket },
];

export default function MarketingPage() {
  const [tab, setTab] = useState<Tab>("insights");

  return (
    <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
      {/* Tab bar */}
      <div className="flex gap-1 rounded-xl bg-[var(--anna-bg)] p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-[var(--anna-white)] text-[var(--anna-sage-dark)] shadow-sm"
                  : "text-[var(--anna-slate-light)] hover:text-[var(--anna-slate)]"
              )}
            >
              <Icon size={14} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === "insights" && <InsightsTab />}
      {tab === "segments" && <SegmentsTab />}
      {tab === "campaigns" && <CampaignsTab />}
    </div>
  );
}
