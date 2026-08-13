"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { formatSgd } from "@/lib/ops-format";
import { TIER_STYLES, type SubItem } from "./subscription-styles";

// ============================================================
// Anna.I — Ops Subscription Action Dialogs
// ============================================================
// Two confirmation dialogs used by the subscriptions page:
//   1. SubscriptionConfirmDialog — simple AlertDialog used for
//      the `reactivate` action (no notes field).
//   2. SubscriptionNotesDialog — Dialog with a notes Textarea,
//      used for `upgrade_tier`, `downgrade_tier`, `cancel`, and
//      `mark_past_due`.
// Both delegate the actual mutation back to the parent; the
// parent owns the `notes` state for the notes dialog so it can
// clear it on open/close.
// ============================================================

interface SubscriptionConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: string;
  sub: SubItem | null;
  isPending: boolean;
  onConfirm: (action: string, sub: SubItem) => void;
}

export function SubscriptionConfirmDialog({
  open,
  onOpenChange,
  action,
  sub,
  isPending,
  onConfirm,
}: SubscriptionConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-2xl border-[var(--anna-border)]">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[var(--anna-slate)]">
            {action === "reactivate" ? "Reactivate Subscription" : ""}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[var(--anna-muted)]">
            {action === "reactivate" && sub
              ? `Reactivate ${sub.household.name}'s ${TIER_STYLES[sub.tier]?.label} subscription? They will be billed ${formatSgd(sub.priceCents)}/mo starting next billing cycle.`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => sub && onConfirm(action, sub)}
            disabled={isPending}
            className="rounded-xl bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)]"
          >
            {isPending ? "Processing..." : "Confirm"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface SubscriptionNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: string;
  sub: SubItem | null;
  notes: string;
  onNotesChange: (notes: string) => void;
  isPending: boolean;
  onConfirm: (action: string, sub: SubItem, notes: string) => void;
}

export function SubscriptionNotesDialog({
  open,
  onOpenChange,
  action,
  sub,
  notes,
  onNotesChange,
  isPending,
  onConfirm,
}: SubscriptionNotesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border-[var(--anna-border)]">
        <DialogHeader>
          <DialogTitle className="text-[var(--anna-slate)]">
            {action === "upgrade_tier" && "Upgrade to Care"}
            {action === "downgrade_tier" && "Downgrade to Home"}
            {action === "cancel" && "Cancel Subscription"}
            {action === "mark_past_due" && "Mark Past Due"}
          </DialogTitle>
          <DialogDescription className="text-[var(--anna-muted)]">
            {action === "upgrade_tier" && sub
              ? `Upgrade ${sub.household.name} from Home (${formatSgd(800)}) to Care (${formatSgd(6800)})/mo`
              : ""}
            {action === "downgrade_tier" && sub
              ? `Downgrade ${sub.household.name} from Care (${formatSgd(6800)}) to Home (${formatSgd(800)})/mo`
              : ""}
            {action === "cancel" && sub
              ? `Cancel ${sub.household.name}'s ${TIER_STYLES[sub.tier]?.label} subscription. The household will be notified.`
              : ""}
            {action === "mark_past_due" && sub
              ? `Mark ${sub.household.name}'s subscription as past due. This may affect service access.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--anna-slate)]">Notes (optional)</label>
          <Textarea
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="Reason for this action..."
            rows={3}
            className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm resize-none"
            maxLength={500}
          />
          <p className="text-[10px] text-[var(--anna-muted)] text-right">{notes.length}/500</p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-xl"
          >
            Cancel
          </Button>
          <Button
            onClick={() => sub && onConfirm(action, sub, notes)}
            disabled={isPending}
            className={cn(
              "rounded-xl",
              action === "cancel" || action === "mark_past_due"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)]"
            )}
          >
            {isPending ? "Processing..." : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
