"use client";

import { useState, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAnnaStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ANOMALY_TYPE_LABELS,
  ANOMALY_SEVERITY_STYLES,
} from "@/lib/constants";
import type { Anomaly, AnomalySeverity } from "@/lib/types";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  X,
  ShieldAlert,
} from "lucide-react";

async function fetchAnomalies(householdId: string) {
  const res = await fetch(
    `/api/anomalies?householdId=${householdId}&status=ACTIVE`
  );
  if (!res.ok) throw new Error("Failed to fetch anomalies");
  return res.json();
}

async function triggerDetection(householdId: string) {
  const res = await fetch("/api/anomalies/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ householdId }),
  });
  if (!res.ok) throw new Error("Detection failed");
  return res.json();
}

function SeverityDot({ severity }: { severity: AnomalySeverity }) {
  const styles = ANOMALY_SEVERITY_STYLES[severity];
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${styles.dot} flex-shrink-0`}
    />
  );
}

function AnomalyRow({
  anomaly,
  onAcknowledge,
  onDismiss,
}: {
  anomaly: Anomaly;
  onAcknowledge: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const styles = ANOMALY_SEVERITY_STYLES[anomaly.severity];
  const timeAgo = getTimeAgo(anomaly.createdAt);

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-xl ${styles.bg} border ${styles.border}`}
    >
      <div className="mt-1">
        <SeverityDot severity={anomaly.severity} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-[10px] font-semibold uppercase tracking-wider ${styles.text}`}>
            {ANOMALY_TYPE_LABELS[anomaly.type]}
          </span>
          <span className="text-[10px] text-[var(--anna-muted)]">{timeAgo}</span>
        </div>
        <p className="text-sm text-[var(--anna-slate)] leading-snug">
          {anomaly.message}
        </p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={() => onAcknowledge(anomaly.id)}
          className="p-1.5 rounded-lg hover:bg-white/60 dark:hover:bg-[var(--anna-white)]/60 text-[var(--anna-muted)] hover:text-[var(--anna-sage-dark)] transition-colors"
          title="Acknowledge"
        >
          <Eye size={14} />
        </button>
        <button
          onClick={() => onDismiss(anomaly.id)}
          className="p-1.5 rounded-lg hover:bg-white/60 dark:hover:bg-[var(--anna-white)]/60 text-[var(--anna-muted)] hover:text-[var(--anna-slate)] transition-colors"
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function AnomalyBanner() {
  const { selectedHouseholdId } = useAnnaStore();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  // Fetch active anomalies
  const { data, isLoading, isError } = useQuery({
    queryKey: ["anomalies", selectedHouseholdId],
    queryFn: () => fetchAnomalies(selectedHouseholdId),
    enabled: !!selectedHouseholdId,
    refetchInterval: 30_000,
  });

  // M-5 FIX: Auto-trigger detection on mount and when household changes
  const detectionMutation = useMutation({
    mutationFn: () => triggerDetection(selectedHouseholdId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["anomalies", selectedHouseholdId] });
    },
  });

  useEffect(() => {
    if (selectedHouseholdId) {
      detectionMutation.mutate();
    }
  }, [selectedHouseholdId, detectionMutation]);

  // Acknowledge mutation
  const acknowledgeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/anomalies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ACKNOWLEDGED" }),
      });
      if (!res.ok) throw new Error("Failed to acknowledge");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["anomalies", selectedHouseholdId] });
    },
  });

  // Dismiss mutation
  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/anomalies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DISMISSED" }),
      });
      if (!res.ok) throw new Error("Failed to dismiss");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["anomalies", selectedHouseholdId] });
    },
  });

  const handleAcknowledge = useCallback(
    (id: string) => acknowledgeMutation.mutate(id),
    [acknowledgeMutation]
  );

  const handleDismiss = useCallback(
    (id: string) => dismissMutation.mutate(id),
    [dismissMutation]
  );

  // Don't render if loading, error, or no anomalies
  if (isLoading || isError) return null;

  const anomalies: Anomaly[] = data?.anomalies || [];
  const severityCounts = data?.severityCounts || {};

  if (anomalies.length === 0) return null;

  // Sort by severity priority
  const severityOrder: Record<string, number> = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  };
  const sorted = [...anomalies].sort(
    (a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4)
  );

  const criticalCount = (severityCounts.CRITICAL as number) || 0;
  const highCount = (severityCounts.HIGH as number) || 0;
  const hasCritical = criticalCount > 0 || highCount > 0;

  return (
    <div className="px-4 lg:px-6 mt-2 mb-3">
      {/* Collapsed banner bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all ${
          hasCritical
            ? "bg-red-50 border-red-200 hover:bg-red-100/70 dark:bg-red-950/30 dark:border-red-800/40 dark:hover:bg-red-950/50"
            : "bg-amber-50 border-amber-200 hover:bg-amber-100/70 dark:bg-amber-950/30 dark:border-amber-800/40 dark:hover:bg-amber-950/50"
        }`}
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-[var(--anna-white)]/80 flex-shrink-0">
          {hasCritical ? (
            <ShieldAlert size={16} className="text-red-600 dark:text-red-400" />
          ) : (
            <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
          )}
        </div>
        <div className="flex-1 text-left min-w-0">
          <p
            className={`text-sm font-semibold ${
              hasCritical ? "text-red-800 dark:text-red-300" : "text-amber-800 dark:text-amber-300"
            }`}
          >
            {anomalies.length} Active {anomalies.length === 1 ? "Alert" : "Alerts"}
          </p>
          <p
            className={`text-[11px] truncate ${
              hasCritical ? "text-red-600/70 dark:text-red-400/70" : "text-amber-600/70 dark:text-amber-400/70"
            }`}
          >
            {sorted[0]?.message}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {criticalCount > 0 && (
            <Badge className="bg-red-500 text-white text-[10px] h-5 px-1.5 font-medium">
              {criticalCount} Critical
            </Badge>
          )}
          {highCount > 0 && (
            <Badge className="bg-orange-500 text-white text-[10px] h-5 px-1.5 font-medium">
              {highCount} High
            </Badge>
          )}
          {expanded ? (
            <ChevronUp size={16} className="text-[var(--anna-muted)]" />
          ) : (
            <ChevronDown size={16} className="text-[var(--anna-muted)]" />
          )}
        </div>
      </button>

      {/* Expanded anomaly list */}
      {expanded && (
        <>
          <div className="mt-2 space-y-2 max-h-72 overflow-y-auto pr-1 anna-fade-in">
            {sorted.map((anomaly) => (
              <AnomalyRow
                key={anomaly.id}
                anomaly={anomaly}
                onAcknowledge={handleAcknowledge}
                onDismiss={handleDismiss}
              />
            ))}
          </div>
          <div className="flex items-center justify-between mt-3 px-1">
            <button
              onClick={(e) => { e.stopPropagation(); detectionMutation.mutate(); }}
              className="flex items-center gap-1.5 text-xs text-[var(--anna-muted)] hover:text-[var(--anna-sage-dark)] transition-colors"
              disabled={detectionMutation.isPending}
            >
              <Clock size={12} />
              {detectionMutation.isPending ? "Scanning..." : "Re-scan now"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
              className="text-xs text-[var(--anna-muted)] hover:text-[var(--anna-slate)] transition-colors"
            >
              Collapse
            </button>
          </div>
        </>
      )}
    </div>
  );
}