"use client";

import { CheckCircle2, Eye, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

// ============================================================
// Anna.I — Ops Anomalies Batch Actions
// ============================================================
// Sage-light action bar that appears when one or more anomalies
// are selected. Exposes Acknowledge / Resolve / Dismiss.
// ============================================================

interface AnomalyBatchActionsProps {
  selectedCount: number;
  onAcknowledge: () => void;
  onResolve: () => void;
  onDismiss: () => void;
  disabled: boolean;
}

export function AnomalyBatchActions({
  selectedCount,
  onAcknowledge,
  onResolve,
  onDismiss,
  disabled,
}: AnomalyBatchActionsProps) {
  return (
    <div className="bg-[var(--anna-sage-light)] rounded-2xl border border-[var(--anna-sage)]/30 px-4 py-3 flex items-center gap-3">
      <span className="text-xs font-medium text-[var(--anna-slate)]">
        <span className="font-data">{selectedCount}</span> selected
      </span>
      <div className="flex gap-2 ml-auto">
        <Button
          variant="outline"
          size="sm"
          onClick={onAcknowledge}
          disabled={disabled}
          className="rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50 text-xs"
        >
          <Eye size={14} className="mr-1" />
          Acknowledge
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onResolve}
          disabled={disabled}
          className="rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-xs"
        >
          <CheckCircle2 size={14} className="mr-1" />
          Resolve
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onDismiss}
          disabled={disabled}
          className="rounded-xl border-[var(--anna-border)] text-[var(--anna-muted)] hover:bg-[var(--anna-bg)] text-xs"
        >
          <XCircle size={14} className="mr-1" />
          Dismiss
        </Button>
      </div>
    </div>
  );
}
