"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { toast } from "sonner";
import { OpsPageHeader, OpsSearchInput } from "@/components/ops/ops-page-header";
import { OpsEmptyState } from "@/components/ops/ops-empty-state";
import { OpsLoadingRows } from "@/components/ops/ops-loading-skeleton";
import { SubscriptionTable } from "@/components/ops/subscriptions/subscription-table";
import { SubscriptionMobileList } from "@/components/ops/subscriptions/subscription-mobile-card";
import { SubscriptionDetailSheet } from "@/components/ops/subscriptions/subscription-detail-sheet";
import {
  SubscriptionConfirmDialog,
  SubscriptionNotesDialog,
} from "@/components/ops/subscriptions/subscription-action-dialog";
import {
  SubscriptionSummaryCards,
  SubscriptionFilterBar,
} from "@/components/ops/subscriptions/subscription-overview";
import type { SubItem } from "@/components/ops/subscriptions/subscription-styles";

// ============================================================
// Anna.I — Ops Subscriptions Page
// ============================================================
// Lists every subscription with a desktop table + mobile cards,
// opens a detail slide-in on row click, and supports tier
// upgrade/downgrade, cancel, mark past due, and reactivate
// actions. All data fetching & mutations live here;
// presentation is delegated to sub-components.
// ============================================================

export default function SubscriptionsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionDialog, setActionDialog] = useState<{
    open: boolean;
    action: string;
    sub: SubItem | null;
  }>({ open: false, action: "", sub: null });
  const [notesDialog, setNotesDialog] = useState<{
    open: boolean;
    action: string;
    sub: SubItem | null;
  }>({ open: false, action: "", sub: null });
  const [notes, setNotes] = useState("");

  // Fetch subscriptions
  const { data, isLoading } = useQuery({
    queryKey: ["ops-subscriptions", tierFilter, statusFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (tierFilter) params.set("tier", tierFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (search) params.set("search", search);
      const res = await fetch(`/api/ops/subscriptions?${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const subscriptions: SubItem[] = data?.subscriptions || [];
  const summary = data?.summary || {
    totalActive: 0,
    activeHome: 0,
    activeCare: 0,
    totalMrrCents: 0,
  };

  // The selected subscription is pulled from the cached list so
  // the sheet opens instantly — no separate detail fetch.
  const selectedSub = selectedId
    ? subscriptions.find((s) => s.id === selectedId) || null
    : null;

  // Action mutation
  const mutation = useMutation({
    mutationFn: async ({ id, action, notes }: { id: string; action: string; notes?: string }) => {
      const res = await fetch(`/api/ops/subscriptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, notes: notes || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Action failed");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["ops-subscriptions"] });
      const actionLabels: Record<string, string> = {
        upgrade_tier: "Upgraded to Care",
        downgrade_tier: "Downgraded to Home",
        cancel: "Subscription cancelled",
        reactivate: "Subscription reactivated",
        mark_past_due: "Marked as past due",
      };
      toast.success(actionLabels[variables.action] || "Action completed");
      setActionDialog({ open: false, action: "", sub: null });
      setSelectedId(null);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  function handleAction(action: string, sub: SubItem, requiresNotes = false) {
    if (requiresNotes) {
      setNotesDialog({ open: true, action, sub });
      setNotes("");
    } else {
      setActionDialog({ open: true, action, sub });
    }
  }

  function submitAction(action: string, sub: SubItem, notesText?: string) {
    mutation.mutate({ id: sub.id, action, notes: notesText });
  }

  return (
    <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
      <OpsPageHeader
        title="Subscriptions"
        subtitle={
          <>
            <span className="font-data">{subscriptions.length}</span> subscriptions
          </>
        }
        actions={
          <OpsSearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search household..."
          />
        }
      />

      <SubscriptionSummaryCards summary={summary} />
      <SubscriptionFilterBar
        tierFilter={tierFilter}
        onTierFilterChange={setTierFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />

      {/* Content */}
      {isLoading ? (
        <OpsLoadingRows count={4} rowClassName="h-16" />
      ) : subscriptions.length === 0 ? (
        <OpsEmptyState
          icon={<CreditCard size={24} />}
          iconBg="bg-[var(--anna-sage-light)]"
          title="No subscriptions found"
          subtitle={
            search
              ? "Try a different search term"
              : "Subscriptions will appear once households sign up"
          }
        />
      ) : (
        <>
          <SubscriptionTable subscriptions={subscriptions} onSelect={setSelectedId} />
          <SubscriptionMobileList subscriptions={subscriptions} onSelect={setSelectedId} />
        </>
      )}

      {/* Detail Sheet */}
      <SubscriptionDetailSheet
        open={!!selectedId}
        onOpenChange={(open) => !open && setSelectedId(null)}
        detail={selectedSub}
        isLoading={!selectedSub}
        onAction={handleAction}
      />

      {/* Confirm Action Dialog (no notes) */}
      <SubscriptionConfirmDialog
        open={actionDialog.open}
        onOpenChange={(open) => !open && setActionDialog({ open: false, action: "", sub: null })}
        action={actionDialog.action}
        sub={actionDialog.sub}
        isPending={mutation.isPending}
        onConfirm={submitAction}
      />

      {/* Notes + Action Dialog (for tier changes, cancel, past due) */}
      <SubscriptionNotesDialog
        open={notesDialog.open}
        onOpenChange={(open) => !open && setNotesDialog({ open: false, action: "", sub: null })}
        action={notesDialog.action}
        sub={notesDialog.sub}
        notes={notes}
        onNotesChange={setNotes}
        isPending={mutation.isPending}
        onConfirm={submitAction}
      />
    </div>
  );
}
