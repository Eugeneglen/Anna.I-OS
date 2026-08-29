"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { BarChart3, Users, Ticket } from "lucide-react";
import { InsightsTab } from "@/components/ops/marketing/insights-tab";
import { SegmentsTab } from "@/components/ops/marketing/segments-tab";
import { CampaignsTab } from "@/components/ops/marketing/campaigns-tab";
import { CampaignCreateDialog } from "@/components/ops/marketing/campaign-create-dialog";
import { useQuery } from "@tanstack/react-query";

// ============================================================
// Anna.I — Ops Marketing Page (Phase 2 restructure)
// ============================================================
// Three sub-tabs: Insights (behaviour analytics), Segments
// (dynamic segment builder), Campaigns (existing campaign list).
//
// Fix 15 — The Create-Campaign dialog state is lifted here so the
// Insights tab's "Create Campaign" recommendation action can open
// the same dialog the Campaigns tab uses. When the user clicks
// "Create Campaign" on a REACTIVATION/CHURN card, we look up a
// matching segment by name (e.g. "Lapsed") and pre-select it;
// if none exists, the dialog opens with no segment selected.
// ============================================================

type Tab = "insights" | "segments" | "campaigns";

const TABS: { id: Tab; label: string; icon: typeof BarChart3 }[] = [
  { id: "insights", label: "Insights", icon: BarChart3 },
  { id: "segments", label: "Segments", icon: Users },
  { id: "campaigns", label: "Campaigns", icon: Ticket },
];

export default function MarketingPage() {
  const [tab, setTab] = useState<Tab>("insights");

  // Fix 15 — Lifted create-campaign dialog state. Owned by the page
  // so both the Campaigns tab's "New Campaign" button and the
  // Insights tab's "Create Campaign" recommendation action share
  // the same dialog instance.
  const [createOpen, setCreateOpen] = useState(false);
  const [createSegmentId, setCreateSegmentId] = useState<string | undefined>(undefined);

  // Fetch the segments list so we can pre-select a "lapsed" segment
  // when the user clicks "Create Campaign" on a REACTIVATION card.
  // (Reuses the same query key the Segments tab uses, so the data
  // is shared and cached.)
  const { data: segmentsData } = useQuery<{ segments: Array<{ id: string; name: string; memberCount: number }> }>({
    queryKey: ["ops-marketing-segments"],
    queryFn: async () => {
      const res = await fetch("/api/ops/marketing/segments");
      if (!res.ok) return { segments: [] };
      return res.json();
    },
    staleTime: 30_000,
  });

  function handleOpenCreateCampaign(segmentId?: string) {
    // If a specific segment was passed in, use it. Otherwise, look
    // for an existing segment whose name suggests it targets lapsed
    // customers (case-insensitive contains "lapse" or "churn").
    if (segmentId) {
      setCreateSegmentId(segmentId);
    } else {
      const segments = segmentsData?.segments ?? [];
      const match = segments.find(
        (s) => /lapse|churn|reactivat/i.test(s.name) && s.memberCount > 0,
      );
      setCreateSegmentId(match?.id);
    }
    setCreateOpen(true);
  }

  function handleNavigateTab(next: Tab) {
    setTab(next);
  }

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
      {tab === "insights" && (
        <InsightsTab
          onNavigateTab={handleNavigateTab}
          onOpenCreateCampaign={handleOpenCreateCampaign}
        />
      )}
      {tab === "segments" && <SegmentsTab />}
      {tab === "campaigns" && (
        <CampaignsTab
          createOpen={createOpen}
          setCreateOpen={setCreateOpen}
        />
      )}

      {/* Fix 15 — Shared Create-Campaign dialog. Rendered once at the
          page level so both the Campaigns tab's "New Campaign" button
          and the Insights tab's "Create Campaign" action open the
          same instance (with optional preselected segment). */}
      <CampaignCreateDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          // Clear the preselected segment whenever the dialog closes
          // so the next open starts fresh.
          if (!open) setCreateSegmentId(undefined);
        }}
        initialSegmentId={createSegmentId}
      />
    </div>
  );
}
