"use client";

import { useQuery } from "@tanstack/react-query";
import { useAnnaStore } from "@/lib/store";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CategoryIcon, getCategoryLabel } from "./category-icon";
import { formatSgd, formatDate, STATUS_LABELS, type Task, type EscrowState } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Landmark,
  Clock,
  ArrowDownCircle,
  ArrowUpCircle,
  AlertTriangle,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────

interface EscrowItem {
  task: Task;
  escrow: NonNullable<Task["escrowEntries"]>[number];
}

type EscrowGroup = "HELD" | "RELEASED" | "DISPUTED" | "REFUNDED";

const GROUP_CONFIG: { key: EscrowGroup; title: string; emptyText: string; icon: React.ElementType; iconColor: string }[] = [
  { key: "HELD", title: "Held in Escrow", emptyText: "No funds held", icon: ShieldCheck, iconColor: "text-[var(--anna-warning)]" },
  { key: "DISPUTED", title: "Disputed", emptyText: "No disputes", icon: AlertTriangle, iconColor: "text-[var(--anna-error)]" },
  { key: "RELEASED", title: "Released to Vendors", emptyText: "No releases yet", icon: ArrowDownCircle, iconColor: "text-[var(--anna-success)]" },
  { key: "REFUNDED", title: "Refunded", emptyText: "No refunds", icon: ArrowUpCircle, iconColor: "text-[var(--anna-muted)]" },
];

// ─── Fetcher ─────────────────────────────────────────────────

async function fetchTasks(householdId: string): Promise<Task[]> {
  const res = await fetch(`/api/tasks?householdId=${householdId}`);
  if (!res.ok) throw new Error("Failed to fetch tasks");
  const data = await res.json();
  return data.tasks;
}

// ─── Helpers ─────────────────────────────────────────────────

function groupEscrowItems(tasks: Task[]): Record<EscrowGroup, EscrowItem[]> {
  const groups: Record<EscrowGroup, EscrowItem[]> = {
    HELD: [],
    RELEASED: [],
    DISPUTED: [],
    REFUNDED: [],
  };

  for (const task of tasks) {
    if (!task.escrowEntries || task.escrowEntries.length === 0) continue;
    // Use the latest escrow entry
    const latest = task.escrowEntries[task.escrowEntries.length - 1];
    const state = latest.state as EscrowGroup;
    if (groups[state]) {
      groups[state].push({ task, escrow: latest });
    }
  }

  // Sort each group by heldAt, most recent first
  for (const key of Object.keys(groups) as EscrowGroup[]) {
    groups[key].sort((a, b) =>
      new Date(b.escrow.heldAt).getTime() - new Date(a.escrow.heldAt).getTime()
    );
  }

  return groups;
}

// ─── Escrow Card ─────────────────────────────────────────────

function EscrowCard({ item }: { item: EscrowItem }) {
  const { task, escrow } = item;
  const vendor = task.bookings?.[0]?.vendor;

  return (
    <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 hover:shadow-sm transition-shadow">
      {/* Top: category + status */}
      <div className="flex items-center gap-2 mb-2">
        <CategoryIcon category={task.category} size={16} />
        <span className="text-sm font-semibold text-[var(--anna-slate)]">
          {getCategoryLabel(task.category)}
        </span>
        {vendor && (
          <span className="text-xs text-[var(--anna-muted)]">
            &middot; {vendor.name}
          </span>
        )}
      </div>

      {/* Instructions */}
      {task.instructions && (
        <p className="text-xs text-[var(--anna-muted)] line-clamp-1 mb-3">
          {task.instructions}
        </p>
      )}

      {/* Amount breakdown */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[10px] text-[var(--anna-muted)] mb-0.5">Amount</p>
          <p className="font-data text-sm font-bold text-[var(--anna-slate)]">
            {formatSgd(escrow.amountCents)}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--anna-muted)] mb-0.5">
            Commission ({escrow.commissionRate}%)
          </p>
          <p className="font-data text-sm font-medium text-[var(--anna-muted)]">
            {formatSgd(escrow.commissionCents)}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--anna-muted)] mb-0.5">Vendor Payout</p>
          <p className="font-data text-sm font-medium text-[var(--anna-sage-dark)]">
            {formatSgd(escrow.vendorPayoutCents)}
          </p>
        </div>
      </div>

      {/* Footer: dates + state badge */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--anna-border)]">
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--anna-muted)]">
          <Clock size={10} />
          <span>Held {formatDate(escrow.heldAt)}</span>
          {escrow.releasedAt && (
            <span className="ml-2">
              &middot; Released {formatDate(escrow.releasedAt)}
            </span>
          )}
          {escrow.disputedAt && (
            <span className="ml-2 text-[var(--anna-error)]">
              &middot; Disputed {formatDate(escrow.disputedAt)}
            </span>
          )}
        </div>
        <StateBadge state={escrow.state} />
      </div>
    </div>
  );
}

function StateBadge({ state }: { state: EscrowState }) {
  const styles: Record<EscrowState, string> = {
    HELD: "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)] border-[var(--anna-warning)]/20",
    RELEASED: "bg-[var(--anna-success)]/15 text-[var(--anna-success)] border-[var(--anna-success)]/20",
    DISPUTED: "bg-[var(--anna-error)]/15 text-[var(--anna-error)] border-[var(--anna-error)]/20",
    REFUNDED: "bg-[var(--anna-muted)]/15 text-[var(--anna-muted)] border-[var(--anna-muted)]/20",
  };

  const labels: Record<EscrowState, string> = {
    HELD: "Held",
    RELEASED: "Released",
    DISPUTED: "Disputed",
    REFUNDED: "Refunded",
  };

  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] px-2 py-0.5 font-medium", styles[state])}
    >
      {labels[state]}
    </Badge>
  );
}

// ─── Summary Stats ───────────────────────────────────────────

function SummaryStat({
  label,
  value,
  sub,
  icon: Icon,
  iconColor,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  iconColor: string;
}) {
  return (
    <div className="bg-[var(--anna-white)] rounded-2xl p-4 border border-[var(--anna-border)]">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-xl bg-[var(--anna-sage-light)] flex items-center justify-center">
          <Icon size={16} className={iconColor} />
        </div>
        <span className="text-xs text-[var(--anna-muted)] font-medium">{label}</span>
      </div>
      <p className="font-data text-xl font-bold text-[var(--anna-slate)]">{value}</p>
      {sub && <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Main Panel ──────────────────────────────────────────────

export function EscrowPanel() {
  const { selectedHouseholdId } = useAnnaStore();

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["tasks", selectedHouseholdId],
    queryFn: () => fetchTasks(selectedHouseholdId),
    enabled: !!selectedHouseholdId,
  });

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-6">
        <Skeleton className="h-8 w-48 rounded-xl bg-[var(--anna-border)]" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-2xl bg-[var(--anna-border)]" />
          ))}
        </div>
        <Skeleton className="h-32 w-full rounded-2xl bg-[var(--anna-border)]" />
      </div>
    );
  }

  const allTasks: Task[] = tasks ?? [];
  const groups = groupEscrowItems(allTasks);

  // Summary stats
  const totalHeld = groups.HELD.reduce((s, i) => s + i.escrow.amountCents, 0);
  const totalReleased = groups.RELEASED.reduce((s, i) => s + i.escrow.amountCents, 0);
  const totalCommission = [...groups.RELEASED, ...groups.HELD].reduce(
    (s, i) => s + i.escrow.commissionCents,
    0
  );
  const disputedCount = groups.DISPUTED.length;

  // Check if there are any escrow items at all
  const hasEscrow = allTasks.some((t) => t.escrowEntries && t.escrowEntries.length > 0);

  return (
    <div className="pb-20 md:pb-0">
      {/* Header */}
      <div className="p-4 lg:p-6 pb-0">
        <div className="flex items-center gap-2">
          <Landmark size={20} className="text-[var(--anna-sage-dark)]" />
          <h1 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
            Escrow
          </h1>
        </div>
        <p className="text-sm text-[var(--anna-muted)] mt-0.5">
          Track payments held in escrow and released to vendors
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-4 lg:p-6">
        <SummaryStat
          icon={ShieldCheck}
          iconColor="text-[var(--anna-warning)]"
          label="Held in Escrow"
          value={formatSgd(totalHeld)}
          sub={`${groups.HELD.length} transaction${groups.HELD.length !== 1 ? "s" : ""}`}
        />
        <SummaryStat
          icon={ArrowDownCircle}
          iconColor="text-[var(--anna-success)]"
          label="Released"
          value={formatSgd(totalReleased)}
          sub={`${groups.RELEASED.length} transaction${groups.RELEASED.length !== 1 ? "s" : ""}`}
        />
        <SummaryStat
          icon={Landmark}
          iconColor="text-[var(--anna-sage-dark)]"
          label="Total Commission"
          value={formatSgd(totalCommission)}
          sub="Platform earnings"
        />
        <SummaryStat
          icon={AlertTriangle}
          iconColor="text-[var(--anna-error)]"
          label="Disputed"
          value={String(disputedCount)}
          sub={disputedCount > 0 ? "Requires attention" : "All clear"}
        />
      </div>

      {/* Escrow Groups */}
      {!hasEscrow ? (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--anna-muted)] px-4">
          <Landmark size={32} className="mb-3 opacity-30" />
          <p className="text-sm font-medium">No escrow transactions yet</p>
          <p className="text-xs mt-1">
            Escrow entries are created when tasks are verified
          </p>
        </div>
      ) : (
        <div className="space-y-6 px-4 lg:px-6 pb-4 lg:pb-6">
          {GROUP_CONFIG.map((group) => {
            const items = groups[group.key];
            if (items.length === 0) return null;

            const Icon = group.icon;
            return (
              <div key={group.key}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon size={14} className={group.iconColor} />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-slate)]">
                    {group.title}
                  </h3>
                  <span className="font-data text-[10px] text-[var(--anna-muted)] bg-[var(--anna-sage-light)] px-1.5 py-0.5 rounded-md">
                    {items.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {items.map((item) => (
                    <EscrowCard key={item.escrow.id} item={item} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}