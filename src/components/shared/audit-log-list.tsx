"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/ops-format";

// ============================================================
// Anna.I — Audit Log List (shared between Ops + Vendor)
// ============================================================
// Shows a timeline of audit entries for a specific user.
// scope="ops" → fetches from /api/ops/users/[id]/audit-log
// scope="vendor" → fetches from /api/vendor/users/[id]/audit-log
// ============================================================

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  userName: string;
  metadata: unknown;
  createdAt: string;
}

interface AuditLogListProps {
  userId: string | null | undefined;
  scope: "ops" | "vendor";
}

const ACTION_LABELS: Record<string, string> = {
  "user.create": "User created",
  "user.update": "User updated",
  "user.delete": "User deleted",
  "user.reset_password": "Password reset",
  "user.deactivate": "User deactivated",
  "user.reactivate": "User reactivated",
  "vendor.user.create": "User created",
  "vendor.user.update": "User updated",
  "vendor.user.delete": "User deleted",
  "vendor.user.reset_password": "Password reset",
};

export function AuditLogList({ userId, scope }: AuditLogListProps) {
  const { data, isLoading } = useQuery<{ entries: AuditEntry[] }>({
    queryKey: ["user-audit-log", scope, userId],
    queryFn: async () => {
      if (!userId) return { entries: [] };
      const base = scope === "ops" ? "/api/ops" : "/api/vendor";
      const res = await fetch(`${base}/users/${userId}/audit-log`);
      if (!res.ok) throw new Error("Failed to load audit log");
      return res.json();
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  const entries = data?.entries || [];

  if (isLoading) {
    return (
      <div className="space-y-2 py-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 rounded-xl bg-[var(--anna-bg)]" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-[var(--anna-muted)]">No audit entries found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 py-3 max-h-[60vh] overflow-y-auto anna-scroll">
      {entries.map((entry) => {
        const label = ACTION_LABELS[entry.action] || entry.action;
        const meta = entry.metadata as Record<string, unknown> | null;
        const metaStr = meta ? Object.entries(meta)
          .filter(([k]) => k !== "password")
          .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
          .join(", ") : "";
        return (
          <div
            key={entry.id}
            className="flex items-start gap-3 p-3 rounded-xl bg-[var(--anna-bg)] border border-[var(--anna-border)]"
          >
            <div className="w-2 h-2 rounded-full bg-[var(--anna-sage)] mt-1.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <p className="text-sm font-medium text-[var(--anna-slate)] truncate">
                  {label}
                </p>
                <span className="text-[10px] text-[var(--anna-muted)] font-data shrink-0">
                  {formatDateTime(entry.createdAt)}
                </span>
              </div>
              {metaStr && (
                <p className="text-[10px] text-[var(--anna-muted)] truncate">
                  {metaStr}
                </p>
              )}
              <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">
                by {entry.userName}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
