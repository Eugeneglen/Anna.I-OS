"use client";

import { Button } from "@/components/ui/button";
import { ShieldCheck, ShieldAlert, Loader2, RotateCcw } from "lucide-react";
import { formatSgd, formatDateTime } from "@/lib/ops-format";

// ============================================================
// Anna.I — Ops Escrow Dispute Task Card
// ============================================================
// Red-bordered card showing a disputed task with the dispute
// reason, optional resolution, and Dismiss/Partial Refund/Refund action buttons.
// ============================================================

interface DisputeTaskCardProps {
  task: Record<string, unknown>;
  onDismiss: (taskId: string, escrowId: string, amount: number, reason?: string | null) => void;
  onRefund: (taskId: string, escrowId: string, amount: number, reason?: string | null) => void;
  onPartialRefund?: (escrowId: string, amount: number, alreadyRefundedCents: number, reason?: string | null) => void;
  isActing: boolean;
}

export function DisputeTaskCard({
  task,
  onDismiss,
  onRefund,
  onPartialRefund,
  isActing,
}: DisputeTaskCardProps) {
  const household = task.household as Record<string, unknown>;
  const escrowEntries = (task.escrowEntries as Record<string, unknown>[]) || [];
  const escrow = escrowEntries[0];
  const vendor = (task.bookings as Record<string, unknown>[])?.[0]?.vendor as Record<string, unknown> | undefined;

  // Order Total = sum of ALL escrow entries (base + add-ons), NOT just task.amountCents
  const orderTotalCents = escrowEntries.reduce(
    (sum, e) => sum + (e.amountCents as number || 0),
    0
  ) || (task.amountCents as number);

  // Cumulative refund across all entries
  const totalRefundedCents = escrowEntries.reduce(
    (sum, e) => sum + ((e.refundCents as number) || 0),
    0
  );

  // Remaining payable = order total - refunds
  const remainingCents = orderTotalCents - totalRefundedCents;
  const hasRefund = totalRefundedCents > 0;

  return (
    <div className="bg-[var(--anna-white)] rounded-2xl border border-red-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-red-50 text-red-600 border border-red-100">
              {(task.category as string)?.replace(/_/g, " ")}
            </span>
            <span className="text-[10px] text-[var(--anna-muted)] font-data">
              {formatDateTime(task.disputedAt as string)}
            </span>
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
          <span className="text-sm font-bold text-[var(--anna-slate)] font-data">
            {formatSgd(orderTotalCents)}
          </span>
          {escrowEntries.length > 1 && (
            <span className="block text-[9px] text-[var(--anna-muted)] font-normal mt-0.5">
              {escrowEntries.length} escrow entries
            </span>
          )}
          {hasRefund && (
            <div className="mt-1 space-y-0.5">
              <div className="text-[10px] text-[var(--anna-error)] font-data">
                −{formatSgd(totalRefundedCents)} refunded
              </div>
              <div className="text-[10px] text-[var(--anna-sage-dark)] font-data font-bold">
                {formatSgd(remainingCents)} remaining
              </div>
            </div>
          )}
        </div>
      </div>

      {escrow?.disputeReason && (
        <div className="p-2.5 rounded-lg bg-red-50/70 border border-red-100">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-red-500 mb-1">Dispute Reason</p>
          <p className="text-xs text-red-700 leading-relaxed">{escrow.disputeReason as string}</p>
        </div>
      )}

      {escrow?.disputeResolution && (
        <div className="p-2.5 rounded-lg bg-[var(--anna-sage-light)]/50 border border-[var(--anna-sage)]/20">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-sage-dark)] mb-1">Resolution</p>
          <p className="text-xs text-[var(--anna-slate)] leading-relaxed">{escrow.disputeResolution as string}</p>
          <p className="text-[10px] text-[var(--anna-muted)] mt-1">
            Resolved by {escrow.disputeResolvedBy as string} · {formatDateTime(escrow.disputeResolvedAt as string)}
          </p>
        </div>
      )}

      {/* Actions only if still DISPUTED */}
      {escrow?.state === "DISPUTED" && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDismiss(
              task.id as string,
              escrow.id as string,
              orderTotalCents,
              escrow.disputeReason as string | null
            )}
            disabled={isActing}
            className="flex-1 rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50 text-xs gap-1.5"
          >
            {isActing ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />}
            Dismiss
          </Button>
          {onPartialRefund && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onPartialRefund(
                escrow.id as string,
                orderTotalCents,
                (escrow.refundCents as number) || 0,
                escrow.disputeReason as string | null
              )}
              disabled={isActing}
              className="flex-1 rounded-xl border-orange-200 text-orange-600 hover:bg-orange-50 text-xs gap-1.5"
            >
              {isActing ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
              Partial
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRefund(
              task.id as string,
              escrow.id as string,
              orderTotalCents,
              escrow.disputeReason as string | null
            )}
            disabled={isActing}
            className="flex-1 rounded-xl border-red-200 text-red-600 hover:bg-red-50 text-xs gap-1.5"
          >
            {isActing ? <Loader2 size={12} className="animate-spin" /> : <ShieldAlert size={12} />}
            Refund
          </Button>
        </div>
      )}
    </div>
  );
}
