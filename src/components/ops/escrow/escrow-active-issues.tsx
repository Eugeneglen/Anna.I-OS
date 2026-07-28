"use client";

import { CheckCircle2, ShieldCheck } from "lucide-react";
import { OpsSectionHeader } from "@/components/ops/ops-kpi-card";
import { OpsEmptyState } from "@/components/ops/ops-empty-state";
import { DisputeTaskCard } from "./dispute-task-card";
import { PendingReleaseCard } from "./pending-release-card";

// ============================================================
// Anna.I — Ops Escrow Active Issues Tab
// ============================================================
// Wraps the entire "Active Issues" tab content: Pending Release
// section + Active Disputes section.
// ============================================================

interface EscrowActiveIssuesProps {
  pendingReleaseTasks: Record<string, unknown>[];
  disputedTasks: Record<string, unknown>[];
  pendingReleaseCount: number;
  disputedTaskCount: number;
  isActing: boolean;
  onRelease: (taskId: string, escrowId: string, amount: number) => void;
  onDismiss: (taskId: string, escrowId: string, amount: number, reason?: string | null) => void;
  onRefund: (taskId: string, escrowId: string, amount: number, reason?: string | null) => void;
}

export function EscrowActiveIssues({
  pendingReleaseTasks,
  disputedTasks,
  pendingReleaseCount,
  disputedTaskCount,
  isActing,
  onRelease,
  onDismiss,
  onRefund,
}: EscrowActiveIssuesProps) {
  return (
    <div className="space-y-6">
      {/* Pending Release Section */}
      <div className="space-y-3">
        <OpsSectionHeader
          dotColor="bg-amber-400"
          title="Pending Release"
          count={`${pendingReleaseCount} ${pendingReleaseCount === 1 ? "task" : "tasks"}`}
        />

        {pendingReleaseTasks.length === 0 ? (
          <OpsEmptyState
            size="sm"
            icon={<CheckCircle2 size={18} className="text-emerald-500" />}
            iconBg="bg-emerald-50"
            title="All clear"
            subtitle="No pending escrow releases"
          />
        ) : (
          <div className="space-y-2">
            {pendingReleaseTasks.map((t: Record<string, unknown>) => (
              <PendingReleaseCard
                key={t.id as string}
                task={t}
                onRelease={onRelease}
                isActing={isActing}
              />
            ))}
          </div>
        )}
      </div>

      {/* Active Disputes Section */}
      <div className="space-y-3">
        <OpsSectionHeader
          dotColor="bg-red-500"
          title="Active Disputes"
          count={`${disputedTaskCount} ${disputedTaskCount === 1 ? "task" : "tasks"}`}
        />

        {disputedTasks.length === 0 ? (
          <OpsEmptyState
            size="sm"
            icon={<ShieldCheck size={18} className="text-[var(--anna-sage-dark)]" />}
            title="No active disputes"
            subtitle="Disputed tasks will appear here for resolution"
          />
        ) : (
          <div className="space-y-2">
            {disputedTasks.map((t: Record<string, unknown>) => (
              <DisputeTaskCard
                key={t.id as string}
                task={t}
                onDismiss={onDismiss}
                onRefund={onRefund}
                isActing={isActing}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
