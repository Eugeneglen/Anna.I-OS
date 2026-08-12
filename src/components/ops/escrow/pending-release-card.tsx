"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowUpRight, Loader2 } from "lucide-react";
import { formatSgd, formatDateTime } from "@/lib/ops-format";

// ============================================================
// Anna.I — Ops Escrow Pending Release Card
// ============================================================
// Amber-bordered card showing a verified task awaiting
// payment release, with a "Release Payment" button.
// ============================================================

interface PendingReleaseCardProps {
  task: Record<string, unknown>;
  onRelease: (taskId: string, escrowId: string, amount: number) => void;
  isActing: boolean;
}

export function PendingReleaseCard({
  task,
  onRelease,
  isActing,
}: PendingReleaseCardProps) {
  const household = task.household as Record<string, unknown>;
  const escrow = (task.escrowEntries as Record<string, unknown>[])?.[0];
  const vendor = (task.bookings as Record<string, unknown>[])?.[0]?.vendor as Record<string, unknown> | undefined;

  return (
    <div className="bg-[var(--anna-white)] rounded-2xl border border-amber-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
              {(task.category as string)?.replace(/_/g, " ")}
            </span>
            <Badge variant="secondary" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
              VERIFIED
            </Badge>
          </div>
          <p className="text-sm font-medium text-[var(--anna-slate)] mt-1.5 truncate">
            {household?.name as string}
          </p>
          {vendor && (
            <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">
              Vendor: {vendor.name as string}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-[var(--anna-slate)] font-data">
            {formatSgd(task.amountCents as number)}
          </p>
          {escrow && (
            <p className="text-[10px] text-[var(--anna-muted)] font-data">
              Payout: {formatSgd(escrow.vendorPayoutCents as number)}
            </p>
          )}
        </div>
      </div>

      <div className="flex justify-between items-center text-[10px] text-[var(--anna-muted)]">
        <span>Verified {formatDateTime(task.verifiedAt as string)}</span>
        <span>Held since {formatDateTime(escrow?.heldAt as string)}</span>
      </div>

      <Button
        size="sm"
        onClick={() => onRelease(
          task.id as string,
          escrow?.id as string,
          task.amountCents as number
        )}
        disabled={isActing}
        className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1.5"
      >
        {isActing ? <Loader2 size={12} className="animate-spin" /> : <ArrowUpRight size={12} />}
        Release Payment
      </Button>
    </div>
  );
}
