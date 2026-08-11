"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Home, Plus } from "lucide-react";
import { toast } from "sonner";
import { OpsPageHeader, OpsSearchInput } from "@/components/ops/ops-page-header";
import { OpsEmptyState } from "@/components/ops/ops-empty-state";
import { OpsLoadingRows } from "@/components/ops/ops-loading-skeleton";
import { HouseholdTable } from "@/components/ops/households/household-table";
import { HouseholdMobileList } from "@/components/ops/households/household-mobile-card";
import { HouseholdDetailSheet } from "@/components/ops/households/household-detail-sheet";
import { CreateHouseholdDialog } from "@/components/ops/households/create-household-dialog";

// ============================================================
// Anna.I — Ops Households Page
// ============================================================
// Lists every household with a desktop table + mobile cards,
// opens a detail slide-in on row click, and supports creating
// new households via a modal. All data fetching & mutations
// live here; presentation is delegated to sub-components.
// ============================================================

export default function HouseholdsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Create household mutation
  const createMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ops/households", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-households"] });
      setCreateDialogOpen(false);
      toast.success("Household created successfully");
    },
    onError: (err) => toast.error(err.message),
  });

  const { data: listData, isLoading } = useQuery({
    queryKey: ["ops-households"],
    queryFn: async () => {
      const res = await fetch("/api/households");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const households = (listData?.households || []) as Record<string, unknown>[];
  const filtered = search
    ? households.filter(
        (h) =>
          (h.name as string)?.toLowerCase().includes(search.toLowerCase()) ||
          (h.email as string)?.toLowerCase().includes(search.toLowerCase()) ||
          (h.postalCode as string)?.includes(search)
      )
    : households;

  // Detail query
  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ["ops-household-detail", selectedId],
    queryFn: async () => {
      const res = await fetch(`/api/households/${selectedId}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!selectedId,
  });

  const detail = detailData || null;
  // Pull the household name from the cached list row so the
  // sheet header renders instantly before detail finishes loading.
  const selectedHousehold = selectedId
    ? households.find((h) => h.id === selectedId)
    : null;

  return (
    <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
      <OpsPageHeader
        title="Households"
        subtitle={
          <>
            <span className="font-data">{filtered.length}</span> households
          </>
        }
        actions={
          <>
            <Button
              onClick={() => setCreateDialogOpen(true)}
              size="sm"
              className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl gap-1.5"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">New Household</span>
            </Button>
            <OpsSearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search name, email, postal..."
            />
          </>
        }
      />

      {/* Content */}
      {isLoading ? (
        <OpsLoadingRows count={3} rowClassName="h-20" />
      ) : filtered.length === 0 ? (
        <OpsEmptyState
          icon={<Home size={24} />}
          iconBg="bg-[var(--anna-sage-light)]"
          title="No households found"
          subtitle={
            search
              ? "Try a different search term"
              : "Households will appear here once they sign up"
          }
        />
      ) : (
        <>
          <HouseholdTable households={filtered} onSelect={setSelectedId} />
          <HouseholdMobileList households={filtered} onSelect={setSelectedId} />
        </>
      )}

      {/* Detail Sheet */}
      <HouseholdDetailSheet
        open={!!selectedId}
        onOpenChange={(open) => !open && setSelectedId(null)}
        detail={detail}
        householdName={selectedHousehold?.name as string | undefined}
        isLoading={detailLoading}
        selectedId={selectedId || undefined}
      />

      {/* Create Household Dialog */}
      <CreateHouseholdDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={(data) => createMutation.mutate(data)}
        loading={createMutation.isPending}
      />
    </div>
  );
}
