"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, ShieldX, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface EscrowActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "release" | "resolve_dismiss" | "resolve_refund";
  taskId: string;
  escrowId: string;
  amountCents: number;
  disputeReason?: string | null;
  onSubmit: (escrowId: string, action: string, resolution: string) => Promise<void>;
  isSubmitting: boolean;
}

const DIALOG_CONFIG = {
  release: {
    title: "Release Escrow Payment",
    description: "Release the held payment to the vendor. This action cannot be undone.",
    icon: ShieldCheck,
    iconBg: "bg-emerald-50",
    iconColor: "text-emerald-600",
    btnLabel: "Release Payment",
    btnClass: "bg-emerald-600 hover:bg-emerald-700 text-white",
    placeholder: "Optional notes (e.g., verified complete, quality confirmed)...",
    gradientHeader: "from-emerald-600 to-emerald-700",
  },
  resolve_dismiss: {
    title: "Dismiss Dispute",
    description: "Dismiss the dispute and reset the task for re-verification. Escrow will return to HELD state.",
    icon: ShieldX,
    iconBg: "bg-amber-50",
    iconColor: "text-amber-600",
    btnLabel: "Dismiss Dispute",
    btnClass: "bg-amber-600 hover:bg-amber-700 text-white",
    placeholder: "Resolution notes (e.g., inspected photos, issue not substantiated)...",
    gradientHeader: "from-amber-600 to-amber-700",
  },
  resolve_refund: {
    title: "Approve Refund",
    description: "Uphold the dispute and issue a refund to the household. This is final.",
    icon: AlertTriangle,
    iconBg: "bg-red-50",
    iconColor: "text-red-600",
    btnLabel: "Issue Refund",
    btnClass: "bg-red-600 hover:bg-red-700 text-white",
    placeholder: "Refund justification (e.g., work not completed as described)...",
    gradientHeader: "from-red-600 to-red-700",
  },
};

function formatSgd(cents: number) {
  return `SGD $${(cents / 100).toFixed(2)}`;
}

export function EscrowActionDialog({
  open,
  onOpenChange,
  type,
  taskId,
  escrowId,
  amountCents,
  disputeReason,
  onSubmit,
  isSubmitting,
}: EscrowActionDialogProps) {
  const [resolution, setResolution] = useState("");
  const config = DIALOG_CONFIG[type];
  const Icon = config.icon;

  const handleClose = () => {
    setResolution("");
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    await onSubmit(escrowId, type, resolution.trim());
    setResolution("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[440px] p-0 gap-0 overflow-hidden rounded-2xl border-[var(--anna-border)]">
        {/* Gradient Header */}
        <div className={cn("bg-gradient-to-r px-5 py-4", config.gradientHeader)}>
          <DialogHeader className="text-left space-y-1">
            <div className="flex items-center gap-3">
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", config.iconBg)}>
                <Icon size={20} className={config.iconColor} />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold text-white">
                  {config.title}
                </DialogTitle>
                <DialogDescription className="text-xs text-white/70 mt-0.5">
                  {config.description}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Amount display */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--anna-bg)] border border-[var(--anna-border)]">
            <span className="text-xs text-[var(--anna-muted)] font-medium uppercase tracking-wider">
              Amount
            </span>
            <span className="text-lg font-bold text-[var(--anna-slate)] font-data">
              {formatSgd(amountCents)}
            </span>
          </div>

          {/* Dispute reason (for resolve actions) */}
          {(type === "resolve_dismiss" || type === "resolve_refund") && disputeReason && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-100">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-red-600 mb-1">
                Dispute Reason
              </p>
              <p className="text-xs text-red-700 leading-relaxed">{disputeReason}</p>
            </div>
          )}

          {/* Resolution notes */}
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] block">
              {type === "release" ? "Notes" : "Resolution Notes"}
            </label>
            <Textarea
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder={config.placeholder}
              className="min-h-[80px] resize-none rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm text-[var(--anna-slate)] placeholder:text-[var(--anna-muted)] focus-visible:ring-[var(--anna-sage)]/30"
              maxLength={500}
            />
            <div className="flex justify-end">
              <span className={cn(
                "text-[10px] font-data",
                resolution.length > 450 ? "text-red-500" : "text-[var(--anna-muted)]"
              )}>
                {resolution.length}/500
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
              className="flex-1 rounded-xl border-[var(--anna-border)] text-sm font-medium text-[var(--anna-slate)] hover:bg-[var(--anna-bg)]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className={cn("flex-1 rounded-xl text-sm font-medium gap-1.5", config.btnClass)}
            >
              {isSubmitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Icon size={14} />
              )}
              {isSubmitting ? "Processing..." : config.btnLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
