"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { OpsPageHeader, OpsSearchInput } from "@/components/ops/ops-page-header";
import { OpsEmptyState } from "@/components/ops/ops-empty-state";
import { OpsLoadingRows } from "@/components/ops/ops-loading-skeleton";
import {
  OpsStatusPillRow,
  OpsFilterToggleButton,
} from "@/components/ops/ops-status-pills";
import { OpsLoadMore } from "@/components/ops/ops-filter-panel";
import { AnomalyTable } from "@/components/ops/anomalies/anomaly-table";
import { AnomalyMobileList } from "@/components/ops/anomalies/anomaly-mobile-card";
import { AnomalyBatchActions } from "@/components/ops/anomalies/anomaly-batch-actions";
import { AnomalyFilters } from "@/components/ops/anomalies/anomaly-filters";

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
    (statusCounts.ACTIVE || 0) + (statusCounts.ACKNOWLEDGED || 0);

  const batchUpdate = (status: string) =>
    batchMutation.mutate({ ids: Array.from(selectedIds), status });

  const statusOptions = [
    { value: "", label: "All" },
    { value: "ACTIVE", label: "Active", count: statusCounts.ACTIVE },
    {
      value: "ACKNOWLEDGED",
      label: "Acknowledged",
      count: statusCounts.ACKNOWLEDGED,
    },
    { value: "RESOLVED", label: "Resolved", count: statusCounts.RESOLVED },
    { value: "DISMISSED", label: "Dismissed", count: statusCounts.DISMISSED },
  ];

  const emptySubtitle =
    activeFilterCount > 0
      ? "Try adjusting your filters"
      : statusFilter === "ACTIVE" || !statusFilter
        ? "All clear — no active anomalies"
        : "No anomalies match your filters";

  return (
    <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
      <OpsPageHeader
        title="Anomalies"
        subtitle={
          <>
            <span className="font-data">{anomalies.length}</span> shown
            {activeCount > 0 && (
              <span className="ml-2">
                <span className="font-data text-red-600">
                  {activeCritical}
                </span>{" "}
                critical &middot;{" "}
                <span className="font-data text-orange-600">{activeHigh}</span>{" "}
                high
              </span>
            )}
          </>
        }
        actions={
          <>
            <OpsSearchInput
              value={search}
              onChange={(v) => {
                setSearch(v);
                setCursor(null);
              }}
              placeholder="Search message, household..."
              className="w-60"
            />
            <OpsFilterToggleButton
              active={showFilters}
              activeCount={activeFilterCount}
              onClick={() => setShowFilters(!showFilters)}
            />
          </>
        }
      />

      <OpsStatusPillRow
        options={statusOptions}
        value={statusFilter}
        onChange={(v) => {
          setStatusFilter(v);
          setCursor(null);
        }}
      />

      <AnomalyFilters
        open={showFilters}
        severityFilter={severityFilter}
        typeFilter={typeFilter}
        onSeverityChange={(v) => {
          setSeverityFilter(v);
          setCursor(null);
        }}
        onTypeChange={(v) => {
          setTypeFilter(v);
          setCursor(null);
        }}
        onClear={clearFilters}
        hasActiveFilters={activeFilterCount > 0}
      />

      {selectedIds.size > 0 && (
        <AnomalyBatchActions
          selectedCount={selectedIds.size}
          onAcknowledge={() => batchUpdate("ACKNOWLEDGED")}
          onResolve={() => batchUpdate("RESOLVED")}
          onDismiss={() => batchUpdate("DISMISSED")}
          disabled={batchMutation.isPending}
        />
      )}

      {isLoading ? (
        <OpsLoadingRows count={4} rowClassName="h-24" />
      ) : anomalies.length === 0 ? (
        <OpsEmptyState
          icon={
            <AlertTriangle
              size={24}
              className="text-[var(--anna-sage-dark)]"
            />
          }
          title="No anomalies found"
          subtitle={emptySubtitle}
        />
      ) : (
        <>
          <AnomalyTable
            anomalies={anomalies}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleAll={toggleAll}
          />
          <AnomalyMobileList
            anomalies={anomalies}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
          />
          {nextCursor && (
            <OpsLoadMore
              onClick={() => setCursor(nextCursor)}
              loading={isFetching}
            />
          )}
        </>
      )}
    </div>
  );
}
