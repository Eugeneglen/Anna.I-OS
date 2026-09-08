"use client";

import { CheckCircle2, ShieldCheck } from "lucide-react";
import { OpsSectionHeader } from "@/components/ops/ops-kpi-card";
import { OpsEmptyState } from "@/components/ops/ops-empty-state";
import { DisputeTaskCard } from "./dispute-task-card";
import { PendingReleaseCard } from "./pending-release-card";
import { AiCaseBriefPanel } from "@/components/ops/ai/ai-case-brief-panel";

// ============================================================
// Anna.I — Ops Escrow Active Issues Tab
// ============================================================
// Wraps the entire "Active Issues" tab content: Pending Release
// section + Active Disputes section.
// Phase 2: each disputed task also shows its AI Case Brief panel
// (Anna.I investigates + recommends; a human decides).
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
  onPartialRefund?: (escrowId: string, amount: number, alreadyRefundedCents: number, reason?: string | null) => void;
  onIssueVoucher?: (taskId: string, escrowId: string, amount: number, reason?: string | null) => void;
  /** Phase 2: bump to refresh the AI brief panels (after actions). */
  briefRefreshKey?: number;
  /** Phase 2: an AI decision was made → refresh escrow data. */
  onBriefDecided?: () => void;
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
  onPartialRefund,
  onIssueVoucher,
  briefRefreshKey,
  onBriefDecided,
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
              <div key={t.id as string} className="space-y-2">
                <DisputeTaskCard
                  task={t}
                  onDismiss={onDismiss}
                  onRefund={onRefund}
                  onPartialRefund={onPartialRefund}
                  onIssueVoucher={onIssueVoucher}
                  isActing={isActing}
                />
                {/* Phase 2: the AI case brief — investigates, explains,
                    recommends. The human decides via Accept/Reject/Override. */}
                <AiCaseBriefPanel
                  taskId={t.id as string}
                  refreshKey={briefRefreshKey}
                  onDecided={onBriefDecided}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
