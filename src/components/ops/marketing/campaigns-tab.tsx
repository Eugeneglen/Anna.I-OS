"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OpsSearchInput } from "@/components/ops/ops-page-header";
import { OpsEmptyState } from "@/components/ops/ops-empty-state";
import { OpsLoadingRows } from "@/components/ops/ops-loading-skeleton";
import { OpsStatusPillRow } from "@/components/ops/ops-status-pills";
import { useOpsUser } from "@/app/ops/(dashboard)/layout";
import { CampaignTable } from "@/components/ops/marketing/campaign-table";
import { CampaignMobileList } from "@/components/ops/marketing/campaign-mobile-card";
import { CampaignSummaryCards } from "@/components/ops/marketing/campaign-summary-cards";
import { CampaignDetailSheet } from "@/components/ops/marketing/campaign-detail-sheet";
import { CampaignCreateDialog } from "@/components/ops/marketing/campaign-create-dialog";
import { CAMPAIGN_QUERY_KEYS } from "@/components/ops/marketing/campaign-styles";
import type { CampaignListItem, CampaignListResponse } from "@/components/ops/marketing/types";

// ============================================================
// Campaigns Tab — existing campaign list (extracted from page)
// ============================================================

const STATUS_PILL_OPTIONS: { value: string; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "ACTIVE", label: "Active" },
  { value: "PAUSED", label: "Paused" },
  { value: "ENDED", label: "Ended" },
];

export function CampaignsTab() {
  const opsCtx = useOpsUser();
  const can = opsCtx?.can;
  const canCreate = !!can && can("marketing", "create");
  const canEdit = !!can && can("marketing", "edit");
  const canDelete = !!can && can("marketing", "delete");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useQuery<CampaignListResponse>({
    queryKey: CAMPAIGN_QUERY_KEYS.list,
    queryFn: async () => {
      const res = await fetch("/api/ops/campaigns");
      if (!res.ok) throw new Error("Failed to load campaigns");
      return res.json() as Promise<CampaignListResponse>;
    },
    staleTime: 30_000,
  });

  const allCampaigns: CampaignListItem[] = data?.campaigns || [];

  const filteredCampaigns = useMemo(() => {
    let list = allCampaigns;
    if (statusFilter !== "ALL") {
      list = list.filter((c) => c.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.description ?? "").toLowerCase().includes(q) ||
          c.type.toLowerCase().includes(q),
      );
    }
    return list;
  }, [allCampaigns, statusFilter, search]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: allCampaigns.length, DRAFT: 0, ACTIVE: 0, PAUSED: 0, ENDED: 0 };
    for (const c of allCampaigns) counts[c.status] = (counts[c.status] || 0) + 1;
    return counts;
  }, [allCampaigns]);

  const summary = useMemo(() => {
    let activeCount = 0, draftCount = 0, totalRedemptions = 0, totalCodes = 0;
    for (const c of allCampaigns) {
      if (c.status === "ACTIVE") activeCount += 1;
      if (c.status === "DRAFT") draftCount += 1;
      totalRedemptions += c.redemptionsCount || 0;
      totalCodes += c._count?.codes || 0;
    }
    return { activeCount, draftCount, totalRedemptions, totalCodes };
  }, [allCampaigns]);

  const pillOptions = STATUS_PILL_OPTIONS.map((opt) => ({ ...opt, count: statusCounts[opt.value] ?? 0 }));

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">Campaigns</h2>
          <p className="text-sm text-[var(--anna-muted)]">
            <span className="font-data">{allCampaigns.length}</span> campaigns ·{" "}
            <span className="font-data">{summary.activeCount}</span> active
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <OpsSearchInput value={search} onChange={setSearch} placeholder="Search campaign..." />
          {canCreate && (
            <Button
              onClick={() => setCreateOpen(true)}
              className="h-9 rounded-xl bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-dark)]/90 text-white"
            >
              <Plus size={14} className="mr-1" />
              New Campaign
            </Button>
          )}
        </div>
      </div>

      <CampaignSummaryCards
        activeCount={summary.activeCount}
        totalRedemptions={summary.totalRedemptions}
        totalCodes={summary.totalCodes}
        draftCount={summary.draftCount}
      />

      <OpsStatusPillRow options={pillOptions} value={statusFilter} onChange={setStatusFilter} />

      {isLoading ? (
        <OpsLoadingRows count={4} rowClassName="h-16" />
      ) : filteredCampaigns.length === 0 ? (
        <OpsEmptyState
          icon={<Megaphone size={24} />}
          iconBg="bg-[var(--anna-sage-light)]"
          title={search || statusFilter !== "ALL" ? "No campaigns match" : "No campaigns yet"}
          subtitle={search || statusFilter !== "ALL" ? "Try a different filter or search term" : canCreate ? "Create your first campaign to start issuing discount codes" : "Campaigns will appear here once they are created"}
        />
      ) : (
        <>
          <CampaignTable campaigns={filteredCampaigns} onSelect={(id) => setSelectedId(id)} />
          <CampaignMobileList campaigns={filteredCampaigns} onSelect={(id) => setSelectedId(id)} />
        </>
      )}

      <CampaignDetailSheet
        open={!!selectedId}
        onOpenChange={(open) => { if (!open) setSelectedId(null); }}
        selectedId={selectedId}
        canEdit={canEdit}
        canDelete={canDelete}
      />

      <CampaignCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
