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
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSgd } from "@/lib/types";

interface RaiseDisputeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => Promise<void>;
  isSubmitting: boolean;
  taskCategory: string;
  vendorName?: string;
  amountCents: number;
}

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 500;

export function RaiseDisputeDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
  taskCategory,
  vendorName,
  amountCents,
}: RaiseDisputeDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  const isValid = reason.trim().length >= MIN_REASON_LENGTH;

  const handleSubmit = async () => {
    if (!isValid) return;
    setError("");
    try {
      await onSubmit(reason.trim());
      setReason("");
      setError("");
    } catch {
      setError("Failed to raise dispute. Please try again.");
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !isSubmitting) {
      setReason("");
      setError("");
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden rounded-2xl border-0 shadow-2xl">
        {/* Gradient header */}
        <div className="bg-gradient-to-r from-red-600 to-red-700 px-6 pt-6 pb-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-white/15 flex items-center justify-center flex-shrink-0">
              <AlertTriangle size={20} className="text-white" />
            </div>
            <DialogHeader className="text-left space-y-1">
              <DialogTitle className="text-white text-base font-bold">
                Raise a Dispute
              </DialogTitle>
              <DialogDescription className="text-red-100 text-xs leading-relaxed">
                This will pause escrow and cancel the active booking. Our ops team will review.
              </DialogDescription>
            </DialogHeader>
          </div>

          {/* Amount display card inside header */}
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 mt-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-red-100/70 uppercase tracking-wider font-medium">
                  Disputed Amount
                </p>
                <p className="text-white font-data text-xl font-bold mt-0.5">
                  {formatSgd(amountCents)}
                </p>
              </div>
              {vendorName && (
                <div className="text-right">
                  <p className="text-[10px] text-red-100/70 uppercase tracking-wider font-medium">
                    Vendor
                  </p>
                  <p className="text-white text-xs font-medium mt-0.5">
                    {vendorName}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Reason textarea */}
          <div className="space-y-2">
            <label
              htmlFor="dispute-reason"
              className="text-xs font-semibold text-[var(--anna-slate)]"
            >
              Dispute Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              id="dispute-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value.slice(0, MAX_REASON_LENGTH));
                if (error) setError("");
              }}
              placeholder="Describe the issue with the service provided..."
              className={cn(
                "w-full min-h-[100px] text-sm bg-[var(--anna-bg)] border rounded-xl px-3 py-2.5 text-[var(--anna-slate)] placeholder:text-[var(--anna-muted)]/50 resize-none focus:outline-none focus:ring-2 transition-colors",
                error
                  ? "border-red-300 focus:ring-red-300/30 focus:border-red-300"
                  : "border-[var(--anna-border)] focus:ring-[var(--anna-sage)]/30 focus:border-[var(--anna-sage)]/50"
              )}
              maxLength={MAX_REASON_LENGTH}
              disabled={isSubmitting}
            />
            <div className="flex items-center justify-between">
              {error ? (
                <p className="text-[10px] text-red-500">{error}</p>
              ) : (
                <p className="text-[10px] text-[var(--anna-muted)]">
                  Minimum {MIN_REASON_LENGTH} characters required
                </p>
              )}
              <span className="text-[10px] text-[var(--anna-muted)] font-data">
                {reason.length}/{MAX_REASON_LENGTH}
              </span>
            </div>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200/60 px-3 py-2.5">
            <ShieldAlert size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-amber-700 leading-relaxed">
              This action pauses escrow and may affect vendor reputation.
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
              className="flex-1 rounded-xl h-10 text-xs font-medium border-[var(--anna-border)] text-[var(--anna-slate)] hover:bg-[var(--anna-bg)]"
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!isValid || isSubmitting}
              onClick={handleSubmit}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white rounded-xl h-10 text-xs font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                  Raising...
                </>
              ) : (
                <>
                  <AlertTriangle size={14} className="mr-1.5" />
                  Raise Dispute
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}