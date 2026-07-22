"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  Eye,
  Clock,
  MapPin,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ANOMALY_TYPE_LABELS,
  ANOMALY_SEVERITY_STYLES,
} from "@/lib/constants";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-red-50 text-red-700 border-red-200",
  ACKNOWLEDGED: "bg-amber-50 text-amber-700 border-amber-200",
  RESOLVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  DISMISSED: "bg-[var(--anna-bg)] text-[var(--anna-muted)] border-[var(--anna-border)]",
};

const STATUS_ICONS: Record<string, React.ElementType> = {
  ACTIVE: AlertCircle,
  ACKNOWLEDGED: Eye,
  RESOLVED: CheckCircle2,
  DISMISSED: XCircle,
};

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCents(cents: number) {
  return `$${(cents / 100).toLocaleString("en-SG", { minimumFractionDigits: 2 })}`;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

export default function AnomaliesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [severityFilter, setSeverityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (severityFilter) params.set("severity", severityFilter);
    if (typeFilter) params.set("type", typeFilter);
    if (cursor) params.set("cursor", cursor);
    return params.toString();
  }, [search, statusFilter, severityFilter, typeFilter, cursor]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["ops-anomalies", buildParams()],
    queryFn: async () => {
      const qs = buildParams();
      const res = await fetch(`/api/ops/anomalies${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: 15_000,
  });

  const anomalies = data?.anomalies || [];
  const nextCursor = data?.nextCursor;
  const severityCounts = data?.severityCounts || {};
  const typeCounts = data?.typeCounts || {};
  const statusCounts = data?.statusCounts || {};

  const batchMutation = useMutation({
    mutationFn: async ({
      ids,
      status,
    }: {
      ids: string[];
      status: string;
    }) => {
      const res = await fetch("/api/ops/anomalies", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, status }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["ops-anomalies"] });
      setSelectedIds(new Set());
      toast.success(
        `${variables.ids.length} anomaly${variables.ids.length > 1 ? "ies" : "y"} ${variables.status.toLowerCase()}`
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeFilterCount = [
    statusFilter,
    severityFilter,
    typeFilter,
  ].filter(Boolean).length;

  function clearFilters() {
    setStatusFilter("ACTIVE");
    setSeverityFilter("");
    setTypeFilter("");
    setCursor(null);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === anomalies.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(anomalies.map((a: { id: string }) => a.id)));
    }
  }

  const activeCritical = severityCounts.CRITICAL || 0;
  const activeHigh = severityCounts.HIGH || 0;
  const activeCount =
    (statusCounts.ACTIVE || 0) +
    (statusCounts.ACKNOWLEDGED || 0);

  return (
    <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
            Anomalies
          </h2>
          <p className="text-sm text-[var(--anna-muted)] mt-0.5">
            <span className="font-data">{anomalies.length}</span> shown
            {activeCount > 0 && (
              <span className="ml-2">
                <span className="font-data text-red-600">{activeCritical}</span>{" "}
                critical &middot;{" "}
                <span className="font-data text-orange-600">
                  {activeHigh}
                </span>{" "}
                high
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--anna-muted)]"
            />
            <Input
              placeholder="Search message, household..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCursor(null);
              }}
              className="pl-9 w-60 rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "rounded-xl border-[var(--anna-border)] relative",
              showFilters &&
                "bg-[var(--anna-sage-light)] border-[var(--anna-sage)]/30"
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

      {/* Status Pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {[
          { value: "ALL", label: "All" },
          { value: "ACTIVE", label: "Active" },
          { value: "ACKNOWLEDGED", label: "Acknowledged" },
          { value: "RESOLVED", label: "Resolved" },
          { value: "DISMISSED", label: "Dismissed" },
        ].map((s) => (
          <button
            key={s.value}
            onClick={() => {
              setStatusFilter(s.value === "ALL" ? "" : s.value);
              setCursor(null);
            }}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5",
              (s.value === "ALL" && !statusFilter) ||
                statusFilter === s.value
                ? "bg-[var(--anna-sage-dark)] text-white"
                : "bg-[var(--anna-white)] text-[var(--anna-slate-light)] border border-[var(--anna-border)] hover:bg-[var(--anna-sage-light)]/50"
            )}
          >
            {s.label}
            {s.value !== "ALL" && statusCounts[s.value] && (
              <span className="font-data text-[10px] opacity-70">
                {statusCounts[s.value] as number}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Expandable Filters */}
      {showFilters && (
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] block mb-1.5">
                Severity
              </label>
              <Select
                value={severityFilter || "ALL"}
                onValueChange={(v) => {
                  setSeverityFilter(v === "ALL" ? "" : v);
                  setCursor(null);
                }}
              >
                <SelectTrigger className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm">
                  <SelectValue placeholder="All Severities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Severities</SelectItem>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] block mb-1.5">
                Type
              </label>
              <Select
                value={typeFilter || "ALL"}
                onValueChange={(v) => {
                  setTypeFilter(v === "ALL" ? "" : v);
                  setCursor(null);
                }}
              >
                <SelectTrigger className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Types</SelectItem>
                  {Object.entries(ANOMALY_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

      {/* Batch Actions */}
      {selectedIds.size > 0 && (
        <div className="bg-[var(--anna-sage-light)] rounded-2xl border border-[var(--anna-sage)]/30 px-4 py-3 flex items-center gap-3">
          <span className="text-xs font-medium text-[var(--anna-slate)]">
            <span className="font-data">{selectedIds.size}</span> selected
          </span>
          <div className="flex gap-2 ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                batchMutation.mutate({
                  ids: Array.from(selectedIds),
                  status: "ACKNOWLEDGED",
                })
              }
              disabled={batchMutation.isPending}
              className="rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50 text-xs"
            >
              <Eye size={14} className="mr-1" />
              Acknowledge
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                batchMutation.mutate({
                  ids: Array.from(selectedIds),
                  status: "RESOLVED",
                })
              }
              disabled={batchMutation.isPending}
              className="rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-xs"
            >
              <CheckCircle2 size={14} className="mr-1" />
              Resolve
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                batchMutation.mutate({
                  ids: Array.from(selectedIds),
                  status: "DISMISSED",
                })
              }
              disabled={batchMutation.isPending}
              className="rounded-xl border-[var(--anna-border)] text-[var(--anna-muted)] hover:bg-[var(--anna-bg)] text-xs"
            >
              <XCircle size={14} className="mr-1" />
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-24 w-full rounded-2xl bg-[var(--anna-border)]"
            />
          ))}
        </div>
      ) : anomalies.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-[var(--anna-sage-light)] flex items-center justify-center mx-auto mb-4">
            <AlertTriangle
              size={24}
              className="text-[var(--anna-sage-dark)]"
            />
          </div>
          <p className="text-sm font-medium text-[var(--anna-slate)]">
            No anomalies found
          </p>
          <p className="text-xs text-[var(--anna-muted)] mt-1">
            {activeFilterCount > 0
              ? "Try adjusting your filters"
              : statusFilter === "ACTIVE" || !statusFilter
                ? "All clear — no active anomalies"
                : "No anomalies match your filters"}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)]">
                  <th className="text-center px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={
                        selectedIds.size === anomalies.length &&
                        anomalies.length > 0
                      }
                      onChange={toggleAll}
                      className="rounded border-[var(--anna-border)]"
                    />
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Message
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Household
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Vendor
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Severity
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    When
                  </th>
                </tr>
              </thead>
              <tbody>
                {anomalies.map(
                  (a: {
                    id: string;
                    type: string;
                    severity: string;
                    message: string;
                    status: string;
                    createdAt: string;
                    acknowledgedAt: string;
                    resolvedAt: string;
                    household: { id: string; name: string; postalCode: string };
                    vendor: { id: string; name: string } | null;
                    task: {
                      id: string;
                      category: string;
                      amountCents: number;
                      status: string;
                    } | null;
                  }) => {
                    const sevStyle =
                      ANOMALY_SEVERITY_STYLES[a.severity] || {};
                    const StatusIcon = STATUS_ICONS[a.status] || Clock;
                    return (
                      <tr
                        key={a.id}
                        className={cn(
                          "border-b border-[var(--anna-border)] last:border-0 transition-colors",
                          selectedIds.has(a.id)
                            ? "bg-[var(--anna-sage-light)]/50"
                            : "hover:bg-[var(--anna-sage-light)]/20"
                        )}
                      >
                        <td className="px-3 py-3 text-center">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(a.id)}
                            onChange={() => toggleSelect(a.id)}
                            className="rounded border-[var(--anna-border)]"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                            {ANOMALY_TYPE_LABELS[a.type] || a.type}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-xs text-[var(--anna-slate)] max-w-xs">
                            {a.message}
                          </p>
                          {a.task && (
                            <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">
                              {a.task.category.replace(/_/g, " ")} &middot;{" "}
                              {formatCents(a.task.amountCents)}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-xs text-[var(--anna-slate-light)]">
                            {a.household?.name}
                          </p>
                          {a.household?.postalCode && (
                            <p className="text-[10px] text-[var(--anna-muted)] font-data">
                              {a.household.postalCode}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--anna-muted)]">
                          {a.vendor?.name || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <div
                              className={cn(
                                "w-2 h-2 rounded-full",
                                sevStyle.dot
                              )}
                            />
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] border",
                                sevStyle.bg,
                                sevStyle.text,
                                sevStyle.border
                              )}
                            >
                              {a.severity}
                            </Badge>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <StatusIcon size={12} />
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] border",
                                STATUS_STYLES[a.status] || ""
                              )}
                            >
                              {a.status}
                            </Badge>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-[10px] text-[var(--anna-slate-light)] font-data">
                            {timeAgo(a.createdAt)}
                          </p>
                          <p className="text-[10px] text-[var(--anna-muted)]">
                            {formatDateTime(a.createdAt)}
                          </p>
                        </td>
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2">
            {anomalies.map(
              (a: {
                id: string;
                type: string;
                severity: string;
                message: string;
                status: string;
                createdAt: string;
                household: { id: string; name: string; postalCode: string };
                vendor: { id: string; name: string } | null;
                task: {
                  id: string;
                  category: string;
                  amountCents: number;
                } | null;
              }) => {
                const sevStyle =
                  ANOMALY_SEVERITY_STYLES[a.severity] || {};
                return (
                  <div
                    key={a.id}
                    onClick={() => toggleSelect(a.id)}
                    className={cn(
                      "bg-[var(--anna-white)] rounded-2xl border p-4 cursor-pointer transition-all",
                      selectedIds.has(a.id)
                        ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/30"
                        : "border-[var(--anna-border)] hover:shadow-sm"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(a.id)}
                        onChange={() => toggleSelect(a.id)}
                        className="mt-1 rounded border-[var(--anna-border)]"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <div
                            className={cn(
                              "w-2 h-2 rounded-full shrink-0",
                              sevStyle.dot
                            )}
                          />
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                            {ANOMALY_TYPE_LABELS[a.type] || a.type}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] border shrink-0",
                              sevStyle.bg,
                              sevStyle.text,
                              sevStyle.border
                            )}
                          >
                            {a.severity}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px] border shrink-0 ml-auto",
                              STATUS_STYLES[a.status] || ""
                            )}
                          >
                            {a.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-[var(--anna-slate)]">
                          {a.message}
                        </p>
                        <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--anna-muted)]">
                          <span>{a.household?.name}</span>
                          {a.vendor && <span>&middot; {a.vendor.name}</span>}
                          <span className="ml-auto font-data">
                            {timeAgo(a.createdAt)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }
            )}
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
  );
}