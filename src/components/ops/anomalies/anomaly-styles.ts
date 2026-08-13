// ============================================================
// Anna.I — Ops Anomalies Shared Styles & Types
// ============================================================
// Row shape + colour/icon maps shared between the desktop table
// and the mobile card list. Keeping them here avoids duplication
// and ensures both views stay in sync.
// ============================================================

import type { ElementType } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  XCircle,
} from "lucide-react";

/** Shape of an anomaly row as returned by /api/ops/anomalies. */
export interface AnomalyRow {
  id: string;
  type: string;
  severity: string;
  message: string;
  status: string;
  createdAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  household: { id: string; name: string; postalCode: string };
  vendor: { id: string; name: string } | null;
  task: {
    id: string;
    category: string;
    amountCents: number;
    status: string;
  } | null;
}

/** Tailwind class strings for anomaly status badges. */
export const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-red-50 text-red-700 border-red-200",
  ACKNOWLEDGED: "bg-amber-50 text-amber-700 border-amber-200",
  RESOLVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  DISMISSED:
    "bg-[var(--anna-bg)] text-[var(--anna-muted)] border-[var(--anna-border)]",
};

/** Lucide icon per anomaly status (used by the desktop table). */
export const STATUS_ICONS: Record<string, ElementType> = {
  ACTIVE: AlertCircle,
  ACKNOWLEDGED: Eye,
  RESOLVED: CheckCircle2,
  DISMISSED: XCircle,
};
