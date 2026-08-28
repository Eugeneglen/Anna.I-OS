"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Loader2, ShieldCheck, ShieldX, AlertTriangle, RotateCcw, Ticket, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ActionType = "release" | "resolve_dismiss" | "resolve_refund" | "partial_refund" | "resolve_voucher";

interface VoucherResult {
  voucherId: string;
  code: string;
  expiresAt: string;
  cashRefundId?: string;
  isDuplicate?: boolean;
}

interface EscrowActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: ActionType;
  taskId: string;
  escrowId: string;
  amountCents: number;
  /** Cumulative amount already refunded on this escrow (for partial_refund max validation). */
  alreadyRefundedCents?: number;
  disputeReason?: string | null;
  /** Extended onSubmit: includes refundAmountCents + idempotencyKey for partial_refund,
   *  plus voucherAmountCents + voucherRefundAmountCents + voucherExpiryDays for resolve_voucher.
   *  Returns the API response (so resolve_voucher can show the generated code). */
  onSubmit: (
    escrowId: string,
    action: string,
    resolution: string,
    options?: {
      refundAmountCents?: number;
      idempotencyKey?: string;
      voucherAmountCents?: number;
      voucherRefundAmountCents?: number;
      voucherExpiryDays?: number;
    }
  ) => Promise<unknown>;
  isSubmitting: boolean;
}

const DIALOG_CONFIG: Record<ActionType, {
  title: string;
  description: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  btnLabel: string;
  btnClass: string;
  placeholder: string;
  gradientHeader: string;
}> = {
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
    title: "Approve Full Refund",
    description: "Uphold the dispute and issue a FULL refund to the household. This is final.",
    icon: AlertTriangle,
    iconBg: "bg-red-50",
    iconColor: "text-red-600",
    btnLabel: "Issue Full Refund",
    btnClass: "bg-red-600 hover:bg-red-700 text-white",
    placeholder: "Refund justification (e.g., work not completed as described)...",
    gradientHeader: "from-red-600 to-red-700",
  },
  partial_refund: {
    title: "Issue Partial Refund",
    description: "Refund a portion of the held amount. Commission and payout are recalculated on the remaining amount.",
    icon: RotateCcw,
    iconBg: "bg-orange-50",
    iconColor: "text-orange-600",
    btnLabel: "Issue Partial Refund",
    btnClass: "bg-orange-600 hover:bg-orange-700 text-white",
    placeholder: "Reason for partial refund (e.g., service partially incomplete)...",
    gradientHeader: "from-orange-600 to-orange-700",
  },
  resolve_voucher: {
    title: "Issue Voucher Instead of Refund",
    description: "Compensate the household with a marketing voucher. The vendor will still be paid (escrow released). Optionally add a partial cash refund (mixed mode).",
    icon: Ticket,
    iconBg: "bg-violet-50",
    iconColor: "text-violet-600",
    btnLabel: "Issue Voucher & Release",
    btnClass: "bg-violet-600 hover:bg-violet-700 text-white",
    placeholder: "Reason for compensation (e.g., apologies for the delay, service issue)...",
    gradientHeader: "from-violet-600 to-violet-700",
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
  alreadyRefundedCents = 0,
  disputeReason,
  onSubmit,
  isSubmitting,
}: EscrowActionDialogProps) {
  const [resolution, setResolution] = useState("");
  const [refundAmountStr, setRefundAmountStr] = useState(""); // user enters SGD dollars, not cents
  // For resolve_voucher: voucher amount ($), optional cash amount ($), expiry (days)
  const [voucherAmountStr, setVoucherAmountStr] = useState("");
  const [voucherCashStr, setVoucherCashStr] = useState("");
  const [voucherExpiryStr, setVoucherExpiryStr] = useState("90");
  const [voucherResult, setVoucherResult] = useState<VoucherResult | null>(null);
  const [copied, setCopied] = useState(false);
  const config = DIALOG_CONFIG[type];
  const Icon = config.icon;

  // The maximum refundable amount (original - already refunded), in cents
  const maxRefundableCents = amountCents - alreadyRefundedCents;
  const maxRefundableDollars = maxRefundableCents / 100;

  // The 2× cap for resolve_voucher: voucherAmountCents + cashRefundAmountCents <= 2 * orderTotalCents
  const maxCompensationCents = 2 * amountCents;
  const maxCompensationDollars = maxCompensationCents / 100;

  // Pre-fill the refund amount with the full remaining amount when the
  // dialog opens. The admin can then adjust it down (e.g. change $15 to $11).
  // This prevents accidental full refunds when the admin only intended a partial.
  useEffect(() => {
    if (open && type === "partial_refund" && maxRefundableDollars > 0) {
      setRefundAmountStr(maxRefundableDollars.toFixed(2));
    } else if (!open) {
      setRefundAmountStr("");
      setResolution("");
      setVoucherAmountStr("");
      setVoucherCashStr("");
      setVoucherExpiryStr("90");
      setVoucherResult(null);
      setCopied(false);
    }
  }, [open, type, maxRefundableDollars]);

  // Parse the user-entered dollar amount to cents
  const refundAmountCents = useMemo(() => {
    if (type !== "partial_refund") return undefined;
    const dollars = parseFloat(refundAmountStr);
    if (isNaN(dollars) || dollars <= 0) return undefined;
    return Math.round(dollars * 100);
  }, [refundAmountStr, type]);

  // For resolve_voucher: parse voucher + cash amounts + expiry
  const voucherAmountCents = useMemo(() => {
    if (type !== "resolve_voucher") return undefined;
    const dollars = parseFloat(voucherAmountStr);
    if (isNaN(dollars) || dollars <= 0) return undefined;
    return Math.round(dollars * 100);
  }, [voucherAmountStr, type]);

  const voucherRefundAmountCents = useMemo(() => {
    if (type !== "resolve_voucher") return undefined;
    const dollars = parseFloat(voucherCashStr);
    if (isNaN(dollars) || dollars <= 0) return 0;
    return Math.round(dollars * 100);
  }, [voucherCashStr, type]);

  const voucherExpiryDays = useMemo(() => {
    if (type !== "resolve_voucher") return undefined;
    const days = parseInt(voucherExpiryStr, 10);
    if (isNaN(days) || days < 1 || days > 365) return 90;
    return days;
  }, [voucherExpiryStr, type]);

  // Generate an idempotency key client-side (unique per dialog submission)
  const idempotencyKey = useMemo(() => {
    if (type !== "partial_refund" && type !== "resolve_voucher") return undefined;
    const prefix = type === "resolve_voucher" ? "voucher" : "refund";
    return `${prefix}-${escrowId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }, [escrowId, type, open]); // regenerate on each open

  const isPartialRefundValid = type === "partial_refund"
    ? refundAmountCents !== undefined && refundAmountCents > 0 && refundAmountCents <= maxRefundableCents
    : true;

  const isVoucherValid = type === "resolve_voucher"
    ? (voucherAmountCents !== undefined && voucherAmountCents > 0) &&
      (voucherAmountCents + (voucherRefundAmountCents || 0) <= maxCompensationCents)
    : true;

  const isVoucherResolutionValid = type === "resolve_voucher"
    ? resolution.trim().length > 0
    : true;

  const isValid = isPartialRefundValid && isVoucherValid && isVoucherResolutionValid;

  const handleClose = () => {
    setResolution("");
    setRefundAmountStr("");
    setVoucherAmountStr("");
    setVoucherCashStr("");
    setVoucherExpiryStr("90");
    setVoucherResult(null);
    setCopied(false);
    onOpenChange(false);
  };

  const handleCopyCode = async () => {
    if (!voucherResult) return;
    try {
      await navigator.clipboard.writeText(voucherResult.code);
      setCopied(true);
      toast.success("Voucher code copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Failed to copy code");
    }
  };

  const handleSubmit = async () => {
    if (type === "partial_refund") {
      if (!refundAmountCents || !idempotencyKey) return;
      await onSubmit(escrowId, type, resolution.trim(), { refundAmountCents, idempotencyKey });
    } else if (type === "resolve_voucher") {
      if (!voucherAmountCents || !idempotencyKey) return;
      const result = await onSubmit(escrowId, type, resolution.trim(), {
        voucherAmountCents,
        voucherRefundAmountCents: voucherRefundAmountCents || 0,
        voucherExpiryDays,
        idempotencyKey,
      }) as VoucherResult | undefined;
      if (result && result.code) {
        setVoucherResult(result);
        return; // keep dialog open to show the code; user closes manually
      }
    } else {
      await onSubmit(escrowId, type, resolution.trim());
    }
    setResolution("");
    setRefundAmountStr("");
    setVoucherAmountStr("");
    setVoucherCashStr("");
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
          {/* Voucher success state — show the code prominently */}
          {type === "resolve_voucher" && voucherResult && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Check size={16} className="text-emerald-600" />
                <p className="text-sm font-semibold text-emerald-700">
                  Voucher issued successfully
                </p>
              </div>
              <div className="rounded-lg bg-white border border-emerald-200 px-3 py-2 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 mb-0.5">
                    Voucher Code
                  </p>
                  <p className="text-lg font-mono font-bold text-emerald-800">
                    {voucherResult.code}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyCode}
                  className="rounded-lg border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                >
                  {copied ? <Check size={12} className="mr-1" /> : <Copy size={12} className="mr-1" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="text-[10px] text-emerald-700">
                {voucherResult.isDuplicate
                  ? "(This voucher was already issued — showing the existing code.)"
                  : "Valid until " + new Date(voucherResult.expiresAt).toLocaleDateString("en-SG", {
                      day: "numeric", month: "short", year: "numeric",
                    })}
                {voucherResult.cashRefundId && " · Cash refund also issued"}
              </p>
              <div className="flex gap-2">
                <Button
                  onClick={handleClose}
                  className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium"
                >
                  Done
                </Button>
              </div>
            </div>
          )}

          {/* Hide the rest of the form once the voucher is issued */}
          {!(type === "resolve_voucher" && voucherResult) && (
            <>
              {/* Amount display */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--anna-bg)] border border-[var(--anna-border)]">
                <span className="text-xs text-[var(--anna-muted)] font-medium uppercase tracking-wider">
                  {type === "partial_refund" || type === "resolve_voucher" ? "Order Total" : type === "release" ? "Amount" : "Order Total (incl. add-ons)"}
                </span>
                <span className="text-lg font-bold text-[var(--anna-slate)] font-data">
                  {formatSgd(amountCents)}
                </span>
              </div>

              {/* For partial_refund: show already-refunded + max refundable */}
              {type === "partial_refund" && alreadyRefundedCents > 0 && (
                <div className="flex items-center justify-between p-2 rounded-xl bg-amber-50 border border-amber-100">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-amber-700">
                    Already Refunded
                  </span>
                  <span className="text-sm font-bold text-amber-700 font-data">
                    {formatSgd(alreadyRefundedCents)}
                  </span>
                </div>
              )}

              {/* Partial refund amount input */}
              {type === "partial_refund" && (
                <div className="space-y-2">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] block">
                    Refund Amount (SGD) <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.01"
                    max={maxRefundableDollars.toFixed(2)}
                    value={refundAmountStr}
                    onChange={(e) => setRefundAmountStr(e.target.value)}
                    placeholder={`Max ${maxRefundableDollars.toFixed(2)}`}
                    className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm text-[var(--anna-slate)] placeholder:text-[var(--anna-muted)] focus-visible:ring-[var(--anna-sage)]/30"
                  />
                  <div className="flex justify-between text-[10px] text-[var(--anna-muted)]">
                    <span>Max refundable: {formatSgd(maxRefundableCents)}</span>
                    {refundAmountCents !== undefined && refundAmountCents > 0 && (
                      <span className={refundAmountCents > maxRefundableCents ? "text-red-500" : "text-emerald-600"}>
                        {refundAmountCents > maxRefundableCents
                          ? "Exceeds max"
                          : `Remaining after: ${formatSgd(maxRefundableCents - refundAmountCents)}`}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* resolve_voucher: voucher amount + cash amount + expiry */}
              {type === "resolve_voucher" && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] block">
                      Voucher Amount (SGD) <span className="text-red-500">*</span>
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={voucherAmountStr}
                      onChange={(e) => setVoucherAmountStr(e.target.value)}
                      placeholder="e.g. 50.00"
                      className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm text-[var(--anna-slate)] placeholder:text-[var(--anna-muted)] focus-visible:ring-[var(--anna-sage)]/30"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] block">
                      Cash Refund (SGD) <span className="text-[var(--anna-muted)] font-normal">(optional — mixed mode)</span>
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={voucherCashStr}
                      onChange={(e) => setVoucherCashStr(e.target.value)}
                      placeholder="0 (voucher only)"
                      className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm text-[var(--anna-slate)] placeholder:text-[var(--anna-muted)] focus-visible:ring-[var(--anna-sage)]/30"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] block">
                      Expiry (days)
                    </label>
                    <Input
                      type="number"
                      min="1"
                      max="365"
                      value={voucherExpiryStr}
                      onChange={(e) => setVoucherExpiryStr(e.target.value)}
                      className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm text-[var(--anna-slate)] placeholder:text-[var(--anna-muted)] focus-visible:ring-[var(--anna-sage)]/30"
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-[var(--anna-muted)]">
                    <span>Max total compensation (2× order): {formatSgd(maxCompensationCents)}</span>
                    {voucherAmountCents !== undefined && voucherAmountCents > 0 && (
                      <span className={voucherAmountCents + (voucherRefundAmountCents || 0) > maxCompensationCents ? "text-red-500" : "text-emerald-600"}>
                        {voucherAmountCents + (voucherRefundAmountCents || 0) > maxCompensationCents
                          ? "Exceeds cap"
                          : `Total: ${formatSgd(voucherAmountCents + (voucherRefundAmountCents || 0))}`}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Dispute reason (for resolve actions) */}
              {(type === "resolve_dismiss" || type === "resolve_refund" || type === "partial_refund" || type === "resolve_voucher") && disputeReason && (
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
                  {type === "resolve_voucher" && <span className="text-red-500"> *</span>}
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
                  disabled={isSubmitting || !isValid}
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
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
