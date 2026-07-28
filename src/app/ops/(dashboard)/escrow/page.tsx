"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Clock, Wallet } from "lucide-react";
import { EscrowActionDialog } from "@/components/ops/escrow-action-dialog";
import { EscrowKpiCard } from "@/components/ops/escrow/escrow-kpi-card";
import { EscrowActiveIssues } from "@/components/ops/escrow/escrow-active-issues";
import { EscrowLedgerTable } from "@/components/ops/escrow/escrow-ledger-table";
import { EscrowLedgerMobileList } from "@/components/ops/escrow/escrow-ledger-mobile-card";
import { OpsPageHeader } from "@/components/ops/ops-page-header";
import { OpsEmptyState } from "@/components/ops/ops-empty-state";
import { OpsLoadingRows } from "@/components/ops/ops-loading-skeleton";
import {
  OpsStatusPillRow,
  OpsFilterToggleButton,
} from "@/components/ops/ops-status-pills";
import {
  OpsFilterPanel,
  OpsFilterField,
  OpsLoadMore,
} from "@/components/ops/ops-filter-panel";

// ── State filter pill options ──

const STATE_OPTIONS = [
  { value: "", label: "All States" },
  { value: "HELD", label: "HELD" },
  { value: "RELEASED", label: "RELEASED" },
  { value: "DISPUTED", label: "DISPUTED" },
  { value: "REFUNDED", label: "REFUNDED" },
];

export default function EscrowPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [tabValue, setTabValue] = useState("overview");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState<
    "release" | "resolve_dismiss" | "resolve_refund"
  >("release");
  const [dialogEscrowId, setDialogEscrowId] = useState("");
  const [dialogAmount, setDialogAmount] = useState(0);
  const [dialogDisputeReason, setDialogDisputeReason] = useState<string | null>(
    null
  );

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (stateFilter) params.set("state", stateFilter);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (cursor) params.set("cursor", cursor);
    return params.toString();
  }, [search, stateFilter, fromDate, toDate, cursor]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["ops-escrow", buildParams()],
    queryFn: async () => {
      const qs = buildParams();
      const res = await fetch(`/api/ops/escrow${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const summary = data?.summary || {};
  const disputedTasks = data?.disputedTasks || [];
  const pendingReleaseTasks = data?.pendingReleaseTasks || [];
  const entries = data?.entries || [];
  const nextCursor = data?.nextCursor;
  const disputedTaskCount = data?.disputedTaskCount || 0;
  const pendingReleaseCount = data?.pendingReleaseCount || 0;

  // ── Mutations ──
  const escrowMutation = useMutation({
    mutationFn: async ({
      escrowId,
      action,
      resolution,
    }: {
      escrowId: string;
      action: string;
      resolution: string;
    }) => {
      const res = await fetch(`/api/ops/escrow/${escrowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, resolution }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Action failed" }));
        throw new Error(err.error || "Action failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-escrow"] });
      queryClient.invalidateQueries({ queryKey: ["ops-bookings"] });
      queryClient.invalidateQueries({ queryKey: ["ops-anomalies"] });
    },
  });

  // ── Action handlers ──
  const openReleaseDialog = (taskId: string, escrowId: string, amount: number) => {
    setDialogType("release");
    setDialogEscrowId(escrowId);
    setDialogAmount(amount);
    setDialogDisputeReason(null);
    setDialogOpen(true);
  };

  const openDismissDialog = (
    taskId: string,
    escrowId: string,
    amount: number,
    reason?: string | null
  ) => {
    setDialogType("resolve_dismiss");
    setDialogEscrowId(escrowId);
    setDialogAmount(amount);
    setDialogDisputeReason(reason || null);
    setDialogOpen(true);
  };

  const openRefundDialog = (
    taskId: string,
    escrowId: string,
    amount: number,
    reason?: string | null
  ) => {
    setDialogType("resolve_refund");
    setDialogEscrowId(escrowId);
    setDialogAmount(amount);
    setDialogDisputeReason(reason || null);
    setDialogOpen(true);
  };

  const handleDialogSubmit = async (
    escrowId: string,
    action: string,
    resolution: string
  ) => {
    await escrowMutation.mutateAsync({ escrowId, action, resolution });
  };

  const activeFilterCount = [stateFilter, fromDate, toDate].filter(Boolean).length;

  function clearFilters() {
    setStateFilter("");
    setFromDate("");
    setToDate("");
    setCursor(null);
  }

  return (
    <div className="space-y-5 pb-20 md:pb-0 anna-fade-in">
      {/* Header */}
      <OpsPageHeader
        title="Escrow & Disputes"
        subtitle="Manage payment holds, dispute resolutions, and refunds"
        actions={
          <>
            {disputedTaskCount > 0 && (
              <Badge className="bg-red-100 text-red-700 border-red-200 text-xs px-2.5 py-1 rounded-lg gap-1">
                <AlertTriangle size={12} />
                {disputedTaskCount} Disputed
              </Badge>
            )}
            {pendingReleaseCount > 0 && (
              <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs px-2.5 py-1 rounded-lg gap-1">
                <Clock size={12} />
                {pendingReleaseCount} Pending
              </Badge>
            )}
          </>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <EscrowKpiCard label="Held" state="HELD" count={summary.HELD?.count || 0} amountCents={summary.HELD?.amountCents || 0} />
        <EscrowKpiCard label="Released" state="RELEASED" count={summary.RELEASED?.count || 0} amountCents={summary.RELEASED?.amountCents || 0} />
        <EscrowKpiCard label="Disputed" state="DISPUTED" count={summary.DISPUTED?.count || 0} amountCents={summary.DISPUTED?.amountCents || 0} />
        <EscrowKpiCard label="Refunded" state="REFUNDED" count={summary.REFUNDED?.count || 0} amountCents={summary.REFUNDED?.amountCents || 0} />
      </div>

      {/* Tabs: Active Issues | Full Ledger */}
      <Tabs value={tabValue} onValueChange={setTabValue}>
        <TabsList className="bg-[var(--anna-white)] border border-[var(--anna-border)] rounded-xl h-9 p-0.5">
          <TabsTrigger
            value="overview"
            className="rounded-lg text-xs font-medium gap-1.5 data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-white"
          >
            Active Issues
            {disputedTaskCount + pendingReleaseCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-data flex items-center justify-center">
                {disputedTaskCount + pendingReleaseCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="ledger"
            className="rounded-lg text-xs font-medium data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-white"
          >
            Full Ledger
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* ── Tab: Active Issues ── */}
      {tabValue === "overview" && (
        <EscrowActiveIssues
          pendingReleaseTasks={pendingReleaseTasks}
          disputedTasks={disputedTasks}
          pendingReleaseCount={pendingReleaseCount}
          disputedTaskCount={disputedTaskCount}
          isActing={escrowMutation.isPending}
          onRelease={openReleaseDialog}
          onDismiss={openDismissDialog}
          onRefund={openRefundDialog}
        />
      )}

      {/* ── Tab: Full Ledger ── */}
      {tabValue === "ledger" && (
        <div className="space-y-4">
          {/* Search + Filters */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--anna-muted)]"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <Input
                placeholder="Search household, vendor..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCursor(null);
                }}
                className="pl-9 rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30"
              />
            </div>
            <OpsFilterToggleButton
              active={showFilters}
              activeCount={activeFilterCount}
              onClick={() => setShowFilters(!showFilters)}
            />
          </div>

          {/* State Pills */}
          <OpsStatusPillRow
            options={STATE_OPTIONS}
            value={stateFilter}
            onChange={(v) => {
              setStateFilter(v);
              setCursor(null);
            }}
          />

          {/* Expandable Filters */}
          <OpsFilterPanel
            open={showFilters}
            onClear={clearFilters}
            hasActiveFilters={activeFilterCount > 0}
          >
            <OpsFilterField label="From">
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setCursor(null);
                }}
                className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm"
              />
            </OpsFilterField>
            <OpsFilterField label="To">
              <Input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setCursor(null);
                }}
                className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm"
              />
            </OpsFilterField>
          </OpsFilterPanel>

          {/* Content */}
          {isLoading ? (
            <OpsLoadingRows count={3} rowClassName="h-16" />
          ) : entries.length === 0 ? (
            <OpsEmptyState
              icon={<Wallet size={20} />}
              title="No escrow entries found"
              subtitle={
                activeFilterCount > 0
                  ? "Try adjusting your filters"
                  : "Entries will appear once tasks are dispatched"
              }
            />
          ) : (
            <>
              <EscrowLedgerTable entries={entries} />
              <EscrowLedgerMobileList entries={entries} />

              {/* Load More */}
              {nextCursor && (
                <OpsLoadMore
                  onClick={() => setCursor(nextCursor)}
                  loading={isFetching}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* Escrow Action Dialog */}
      <EscrowActionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        type={dialogType}
        taskId=""
        escrowId={dialogEscrowId}
        amountCents={dialogAmount}
        disputeReason={dialogDisputeReason}
        onSubmit={handleDialogSubmit}
        isSubmitting={escrowMutation.isPending}
      />
    </div>
  );
}
