"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Filter,
  ShieldCheck,
  ShieldAlert,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  Wallet,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EscrowActionDialog } from "@/components/ops/escrow-action-dialog";

// ── Helpers ──

function formatSgd(cents: number) {
  return `SGD $${(cents / 100).toFixed(2)}`;
}

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── State styles ──

const ESCROW_STYLES: Record<string, { bg: string; text: string; icon: typeof ShieldCheck }> = {
  HELD: { bg: "bg-amber-50", text: "text-amber-700", icon: Clock },
  RELEASED: { bg: "bg-emerald-50", text: "text-emerald-700", icon: CheckCircle2 },
  DISPUTED: { bg: "bg-red-50", text: "text-red-600", icon: AlertTriangle },
  REFUNDED: { bg: "bg-gray-100", text: "text-gray-600", icon: XCircle },
};

const KPI_STYLES: Record<string, { cardBg: string; iconBg: string; iconColor: string; amountColor: string }> = {
  HELD: { cardBg: "bg-amber-50/50", iconBg: "bg-amber-100", iconColor: "text-amber-600", amountColor: "text-amber-700" },
  RELEASED: { cardBg: "bg-emerald-50/50", iconBg: "bg-emerald-100", iconColor: "text-emerald-600", amountColor: "text-emerald-700" },
  DISPUTED: { cardBg: "bg-red-50/50", iconBg: "bg-red-100", iconColor: "text-red-600", amountColor: "text-red-700" },
  REFUNDED: { cardBg: "bg-gray-50/50", iconBg: "bg-gray-200", iconColor: "text-gray-500", amountColor: "text-gray-600" },
};

// ── KPI Card ──

function KpiCard({
  label,
  state,
  count,
  amountCents,
}: {
  label: string;
  state: string;
  count: number;
  amountCents: number;
}) {
  const style = KPI_STYLES[state] || KPI_STYLES.HELD;
  const Icon = ESCROW_STYLES[state]?.icon || Clock;

  return (
    <div className={cn("rounded-2xl border border-[var(--anna-border)] p-4", style.cardBg)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
          {label}
        </span>
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", style.iconBg)}>
          <Icon size={16} className={style.iconColor} />
        </div>
      </div>
      <p className={cn("text-lg font-bold font-data", style.amountColor)}>
        {formatSgd(amountCents)}
      </p>
      <p className="text-[10px] text-[var(--anna-muted)] mt-0.5 font-data">
        {count} {count === 1 ? "entry" : "entries"}
      </p>
    </div>
  );
}

// ── Disputed Task Card ──

function DisputeTaskCard({
  task,
  onDismiss,
  onRefund,
  isActing,
}: {
  task: Record<string, unknown>;
  onDismiss: (taskId: string, escrowId: string, amount: number, reason?: string | null) => void;
  onRefund: (taskId: string, escrowId: string, amount: number, reason?: string | null) => void;
  isActing: boolean;
}) {
  const household = task.household as Record<string, unknown>;
  const escrow = (task.escrowEntries as Record<string, unknown>[])?.[0];
  const vendor = (task.bookings as Record<string, unknown>[])?.[0]?.vendor as Record<string, unknown> | undefined;

  return (
    <div className="bg-[var(--anna-white)] rounded-2xl border border-red-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-100">
              {(task.category as string)?.replace(/_/g, " ")}
            </span>
            <span className="text-[10px] text-[var(--anna-muted)] font-data">
              {formatDateTime(task.disputedAt as string)}
            </span>
          </div>
          <p className="text-sm font-medium text-[var(--anna-slate)] mt-1.5 truncate">
            {household?.name as string}
          </p>
          {vendor && (
            <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">
              Vendor: {vendor.name as string}
            </p>
          )}
        </div>
        <span className="text-sm font-bold text-[var(--anna-slate)] font-data shrink-0">
          {formatSgd(task.amountCents as number)}
        </span>
      </div>

      {escrow?.disputeReason && (
        <div className="p-2.5 rounded-lg bg-red-50/70 border border-red-100">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-red-500 mb-1">Dispute Reason</p>
          <p className="text-xs text-red-700 leading-relaxed">{escrow.disputeReason as string}</p>
        </div>
      )}

      {escrow?.disputeResolution && (
        <div className="p-2.5 rounded-lg bg-[var(--anna-sage-light)]/50 border border-[var(--anna-sage)]/20">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-sage-dark)] mb-1">Resolution</p>
          <p className="text-xs text-[var(--anna-slate)] leading-relaxed">{escrow.disputeResolution as string}</p>
          <p className="text-[10px] text-[var(--anna-muted)] mt-1">
            Resolved by {escrow.disputeResolvedBy as string} · {formatDateTime(escrow.disputeResolvedAt as string)}
          </p>
        </div>
      )}

      {/* Actions only if still DISPUTED */}
      {escrow?.state === "DISPUTED" && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDismiss(
              task.id as string,
              escrow.id as string,
              task.amountCents as number,
              escrow.disputeReason as string | null
            )}
            disabled={isActing}
            className="flex-1 rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50 text-xs gap-1.5"
          >
            {isActing ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
            Dismiss
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRefund(
              task.id as string,
              escrow.id as string,
              task.amountCents as number,
              escrow.disputeReason as string | null
            )}
            disabled={isActing}
            className="flex-1 rounded-xl border-red-200 text-red-600 hover:bg-red-50 text-xs gap-1.5"
          >
            {isActing ? <Loader2 size={12} className="animate-spin" /> : <ShieldAlert size={12} />}
            Refund
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Pending Release Card ──

function PendingReleaseCard({
  task,
  onRelease,
  isActing,
}: {
  task: Record<string, unknown>;
  onRelease: (taskId: string, escrowId: string, amount: number) => void;
  isActing: boolean;
}) {
  const household = task.household as Record<string, unknown>;
  const escrow = (task.escrowEntries as Record<string, unknown>[])?.[0];
  const vendor = (task.bookings as Record<string, unknown>[])?.[0]?.vendor as Record<string, unknown> | undefined;

  return (
    <div className="bg-[var(--anna-white)] rounded-2xl border border-amber-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
              {(task.category as string)?.replace(/_/g, " ")}
            </span>
            <Badge variant="secondary" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
              VERIFIED
            </Badge>
          </div>
          <p className="text-sm font-medium text-[var(--anna-slate)] mt-1.5 truncate">
            {household?.name as string}
          </p>
          {vendor && (
            <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">
              Vendor: {vendor.name as string}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-[var(--anna-slate)] font-data">
            {formatSgd(task.amountCents as number)}
          </p>
          {escrow && (
            <p className="text-[10px] text-[var(--anna-muted)] font-data">
              Payout: {formatSgd(escrow.vendorPayoutCents as number)}
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-between items-center text-[10px] text-[var(--anna-muted)]">
        <span>Verified {formatDateTime(task.verifiedAt as string)}</span>
        <span>Held since {formatDateTime(escrow?.heldAt as string)}</span>
      </div>

      <Button
        size="sm"
        onClick={() => onRelease(
          task.id as string,
          escrow?.id as string,
          task.amountCents as number
        )}
        disabled={isActing}
        className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5"
      >
        {isActing ? <Loader2 size={12} className="animate-spin" /> : <ArrowUpRight size={12} />}
        Release Payment
      </Button>
    </div>
  );
}

// ── Main Page ──

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
  const [dialogType, setDialogType] = useState<"release" | "resolve_dismiss" | "resolve_refund">("release");
  const [dialogEscrowId, setDialogEscrowId] = useState("");
  const [dialogAmount, setDialogAmount] = useState(0);
  const [dialogDisputeReason, setDialogDisputeReason] = useState<string | null>(null);

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
    mutationFn: async ({ escrowId, action, resolution }: { escrowId: string; action: string; resolution: string }) => {
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

  const openDismissDialog = (taskId: string, escrowId: string, amount: number, reason?: string | null) => {
    setDialogType("resolve_dismiss");
    setDialogEscrowId(escrowId);
    setDialogAmount(amount);
    setDialogDisputeReason(reason || null);
    setDialogOpen(true);
  };

  const openRefundDialog = (taskId: string, escrowId: string, amount: number, reason?: string | null) => {
    setDialogType("resolve_refund");
    setDialogEscrowId(escrowId);
    setDialogAmount(amount);
    setDialogDisputeReason(reason || null);
    setDialogOpen(true);
  };

  const handleDialogSubmit = async (escrowId: string, action: string, resolution: string) => {
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
            Escrow & Disputes
          </h2>
          <p className="text-sm text-[var(--anna-muted)] mt-0.5">
            Manage payment holds, dispute resolutions, and refunds
          </p>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Held" state="HELD" count={summary.HELD?.count || 0} amountCents={summary.HELD?.amountCents || 0} />
        <KpiCard label="Released" state="RELEASED" count={summary.RELEASED?.count || 0} amountCents={summary.RELEASED?.amountCents || 0} />
        <KpiCard label="Disputed" state="DISPUTED" count={summary.DISPUTED?.count || 0} amountCents={summary.DISPUTED?.amountCents || 0} />
        <KpiCard label="Refunded" state="REFUNDED" count={summary.REFUNDED?.count || 0} amountCents={summary.REFUNDED?.amountCents || 0} />
      </div>

      {/* Tabs: Active Issues | Full Ledger */}
      <Tabs value={tabValue} onValueChange={setTabValue}>
        <TabsList className="bg-[var(--anna-white)] border border-[var(--anna-border)] rounded-xl h-9 p-0.5">
          <TabsTrigger
            value="overview"
            className="rounded-lg text-xs font-medium gap-1.5 data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-white"
          >
            Active Issues
            {(disputedTaskCount + pendingReleaseCount) > 0 && (
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
        <div className="space-y-6">
          {/* Pending Release Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--anna-slate)] flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-400" />
                Pending Release
              </h3>
              <span className="text-xs text-[var(--anna-muted)] font-data">
                {pendingReleaseCount} {pendingReleaseCount === 1 ? "task" : "tasks"}
              </span>
            </div>

            {pendingReleaseTasks.length === 0 ? (
              <div className="text-center py-8 bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)]">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center mx-auto mb-3">
                  <CheckCircle2 size={18} className="text-emerald-500" />
                </div>
                <p className="text-sm text-[var(--anna-slate)]">All clear</p>
                <p className="text-xs text-[var(--anna-muted)] mt-1">No pending escrow releases</p>
              </div>
            ) : (
              <div className="space-y-2">
                {pendingReleaseTasks.map((t: Record<string, unknown>) => (
                  <PendingReleaseCard
                    key={t.id as string}
                    task={t}
                    onRelease={openReleaseDialog}
                    isActing={escrowMutation.isPending}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Active Disputes Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--anna-slate)] flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                Active Disputes
              </h3>
              <span className="text-xs text-[var(--anna-muted)] font-data">
                {disputedTaskCount} {disputedTaskCount === 1 ? "task" : "tasks"}
              </span>
            </div>

            {disputedTasks.length === 0 ? (
              <div className="text-center py-8 bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)]">
                <div className="w-10 h-10 rounded-xl bg-[var(--anna-sage-light)] flex items-center justify-center mx-auto mb-3">
                  <ShieldCheck size={18} className="text-[var(--anna-sage-dark)]" />
                </div>
                <p className="text-sm text-[var(--anna-slate)]">No active disputes</p>
                <p className="text-xs text-[var(--anna-muted)] mt-1">Disputed tasks will appear here for resolution</p>
              </div>
            ) : (
              <div className="space-y-2">
                {disputedTasks.map((t: Record<string, unknown>) => (
                  <DisputeTaskCard
                    key={t.id as string}
                    task={t}
                    onDismiss={openDismissDialog}
                    onRefund={openRefundDialog}
                    isActing={escrowMutation.isPending}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Full Ledger ── */}
      {tabValue === "ledger" && (
        <div className="space-y-4">
          {/* Search + Filters */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--anna-muted)]" />
              <Input
                placeholder="Search household, vendor..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setCursor(null); }}
                className="pl-9 rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className={cn(
                  "rounded-xl border-[var(--anna-border)] relative",
                  showFilters && "bg-[var(--anna-sage-light)] border-[var(--anna-sage)]/30"
                )}
              >
                <Filter size={14} className="mr-1.5" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="ml-1.5 w-4 h-4 rounded-full bg-[var(--anna-sage-dark)] text-white text-[10px] font-data flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </div>
          </div>

          {/* State Pills */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {["", "HELD", "RELEASED", "DISPUTED", "REFUNDED"].map((s) => (
              <button
                key={s || "all"}
                onClick={() => { setStateFilter(s); setCursor(null); }}
                className={cn(
                  "shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  stateFilter === s
                    ? "bg-[var(--anna-sage-dark)] text-white"
                    : "bg-[var(--anna-white)] text-[var(--anna-slate-light)] border border-[var(--anna-border)] hover:bg-[var(--anna-sage-light)]/50"
                )}
              >
                {s ? s.replace(/_/g, " ") : "All States"}
              </button>
            ))}
          </div>

          {/* Expandable Filters */}
          {showFilters && (
            <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] block mb-1.5">
                    From
                  </label>
                  <Input
                    type="date"
                    value={fromDate}
                    onChange={(e) => { setFromDate(e.target.value); setCursor(null); }}
                    className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] block mb-1.5">
                    To
                  </label>
                  <Input
                    type="date"
                    value={toDate}
                    onChange={(e) => { setToDate(e.target.value); setCursor(null); }}
                    className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm"
                  />
                </div>
              </div>
              {activeFilterCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="text-xs text-[var(--anna-sage-dark)] hover:underline"
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}

          {/* Desktop Table */}
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-2xl bg-[var(--anna-border)]" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 rounded-2xl bg-[var(--anna-sage-light)] flex items-center justify-center mx-auto mb-3">
                <Wallet size={20} className="text-[var(--anna-sage-dark)]" />
              </div>
              <p className="text-sm font-medium text-[var(--anna-slate)]">No escrow entries found</p>
              <p className="text-xs text-[var(--anna-muted)] mt-1">
                {activeFilterCount > 0 ? "Try adjusting your filters" : "Entries will appear once tasks are dispatched"}
              </p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)]">
                      <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Household</th>
                      <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Category</th>
                      <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Vendor</th>
                      <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Amount</th>
                      <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Commission</th>
                      <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Payout</th>
                      <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">State</th>
                      <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e: Record<string, unknown>) => {
                      const t = e.task as Record<string, unknown>;
                      const household = t?.household as Record<string, unknown>;
                      const vendor = (e.booking as Record<string, unknown>)?.vendor as Record<string, unknown> | undefined;
                      const stateStyle = ESCROW_STYLES[e.state as string] || ESCROW_STYLES.HELD;

                      return (
                        <tr key={e.id as string} className={cn(
                          "border-b border-[var(--anna-border)] last:border-0 transition-colors",
                          e.state === "DISPUTED" ? "hover:bg-red-50/30" : "hover:bg-[var(--anna-sage-light)]/20"
                        )}>
                          <td className="px-4 py-3">
                            <p className="font-medium text-[var(--anna-slate)]">{(household?.name as string) || "—"}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                              {(t?.category as string)?.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-[var(--anna-slate-light)]">
                            {vendor?.name as string || "—"}
                          </td>
                          <td className="px-4 py-3 font-data text-xs text-[var(--anna-slate)]">
                            {formatSgd(e.amountCents as number)}
                          </td>
                          <td className="px-4 py-3 font-data text-xs text-[var(--anna-muted)]">
                            {formatSgd(e.commissionCents as number)}
                          </td>
                          <td className="px-4 py-3 font-data text-xs text-[var(--anna-slate)]">
                            {formatSgd(e.vendorPayoutCents as number)}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant="secondary" className={cn("text-[10px]", stateStyle.bg, stateStyle.text)}>
                              {(e.state as string)?.replace(/_/g, " ")}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-xs text-[var(--anna-muted)] font-data">
                            {formatDateTime(e.createdAt as string)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-2">
                {entries.map((e: Record<string, unknown>) => {
                  const t = e.task as Record<string, unknown>;
                  const household = t?.household as Record<string, unknown>;
                  const vendor = (e.booking as Record<string, unknown>)?.vendor as Record<string, unknown> | undefined;
                  const stateStyle = ESCROW_STYLES[e.state as string] || ESCROW_STYLES.HELD;

                  return (
                    <div key={e.id as string} className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--anna-slate)] truncate">
                            {household?.name as string}
                          </p>
                          <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">
                            {vendor?.name as string || "No vendor"}
                          </p>
                        </div>
                        <Badge variant="secondary" className={cn("text-[10px] shrink-0 ml-2", stateStyle.bg, stateStyle.text)}>
                          {(e.state as string)?.replace(/_/g, " ")}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                          {(t?.category as string)?.replace(/_/g, " ")}
                        </span>
                        <span className="font-data text-xs text-[var(--anna-slate)]">{formatSgd(e.amountCents as number)}</span>
                        <span className="font-data text-[10px] text-[var(--anna-muted)]">
                          → {formatSgd(e.vendorPayoutCents as number)} payout
                        </span>
                      </div>
                      <p className="text-[10px] text-[var(--anna-muted)] mt-2 font-data">
                        {formatDateTime(e.createdAt as string)}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Load More */}
              {nextCursor && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setCursor(nextCursor)}
                    disabled={isFetching}
                    className="rounded-xl border-[var(--anna-border)] text-sm"
                  >
                    {isFetching ? (
                      <Loader2 size={14} className="mr-1.5 animate-spin" />
                    ) : null}
                    Load more
                  </Button>
                </div>
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
