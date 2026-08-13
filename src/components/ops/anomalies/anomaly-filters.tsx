"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  OpsFilterPanel,
  OpsFilterField,
} from "@/components/ops/ops-filter-panel";
import { ANOMALY_TYPE_LABELS } from "@/lib/constants";

// ============================================================
// Anna.I — Ops Anomalies Filter Panel
// ============================================================
// Expandable card with Severity and Type selects, plus a
// "Clear all filters" link when any filter is active. Wraps
// the shared OpsFilterPanel / OpsFilterField primitives.
// ============================================================

interface AnomalyFiltersProps {
  open: boolean;
  severityFilter: string;
  typeFilter: string;
  onSeverityChange: (value: string) => void;
  onTypeChange: (value: string) => void;
  onClear: () => void;
  hasActiveFilters: boolean;
}

export function AnomalyFilters({
  open,
  severityFilter,
  typeFilter,
  onSeverityChange,
  onTypeChange,
  onClear,
  hasActiveFilters,
}: AnomalyFiltersProps) {
  return (
    <OpsFilterPanel
      open={open}
      onClear={onClear}
      hasActiveFilters={hasActiveFilters}
    >
      <OpsFilterField label="Severity">
        <Select
          value={severityFilter || "ALL"}
          onValueChange={(v) => onSeverityChange(v === "ALL" ? "" : v)}
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
      </OpsFilterField>
      <OpsFilterField label="Type">
        <Select
          value={typeFilter || "ALL"}
          onValueChange={(v) => onTypeChange(v === "ALL" ? "" : v)}
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
      </OpsFilterField>
    </OpsFilterPanel>
  );
}
