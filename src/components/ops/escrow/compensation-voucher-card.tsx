"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Ticket,
  Pause,
  Play,
  Trash2,
  Loader2,
  Calendar,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/ops-format";

// ============================================================
// Anna.I — Ops Compensation Voucher Card
// ============================================================
// Renders a service-recovery voucher that was issued as dispute
// compensation, attached to a specific escrow entry. Shows the
// voucher code, amount, expiry, status, and the Suspend /
// Reactivate / Remove controls.
// ============================================================

export interface CompensationVoucher {
  id: string;
  status: string;
  expiresAt: string | null;
  compensationReason: string | null;
  issuedByName: string | null;
  issuedFromTaskId: string | null;
  discountCode: {
    code: string;
    isActive: boolean;
  };
  campaign: {
    id: string;
    name: string;
    discountRule: {
      discountType: string;
      discountValue: number;
    } | null;
  };
}

interface CompensationVoucherCardProps {
  voucher: CompensationVoucher;
  taskJobNo?: string | null;
}

export function CompensationVoucherCard({
  voucher,
  taskJobNo,
}: CompensationVoucherCardProps) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogAction, setDialogAction] = useState<"suspend" | "remove" | null>(null);
  const [reason, setReason] = useState("");

  const discountValue = voucher.campaign?.discountRule?.discountValue;
  const isSuspended = !voucher.discountCode.isActive && voucher.status === "CLAIMED";
  const isRevoked = voucher.status === "REVOKED";
  const isUsed = voucher.status === "USED";

  const voucherAction = useMutation({
    mutationFn: async ({
      action,
      reason,
    }: {
      action: "suspend" | "reactivate" | "remove";
      reason?: string;
    }) => {
      const res = await fetch(`/api/ops/escrow/vouchers/${voucher.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: reason || "No reason provided" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Action failed" }));
        throw new Error(err.error || "Action failed");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["ops-task-detail"] });
      queryClient.invalidateQueries({ queryKey: ["ops-escrow"] });
      queryClient.invalidateQueries({ queryKey: ["ops-bookings"] });
      toast.success(
        variables.action === "suspend" ? "Voucher suspended" :
        variables.action === "reactivate" ? "Voucher reactivated" :
        "Voucher permanently revoked"
      );
      setDialogOpen(false);
      setReason("");
      setDialogAction(null);
    },
    onError: (err: Error) => {
      toast.error(err.message || "Action failed");
    },
  });

  const openActionDialog = (action: "suspend" | "remove") => {
    setDialogAction(action);
    setReason("");
    setDialogOpen(true);
  };

  const handleConfirm = () => {
    if (!dialogAction) return;
    if (dialogAction === "remove" && !reason.trim()) {
      toast.error("Reason is required to permanently remove a voucher");
      return;
    }
    voucherAction.mutate({
      action: dialogAction,
      reason: reason.trim() || undefined,
    });
  };

  return (
    <>
      <div
        className={cn(
          "rounded-xl border p-3 space-y-2",
          isRevoked
            ? "border-[var(--anna-border)] bg-gray-50 opacity-70"
            : isSuspended
              ? "border-amber-200 bg-amber-50/50"
              : "border-violet-200 bg-violet-50/40"
        )}
      >
        {/* Header: code + status */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Ticket size={14} className="text-violet-600" />
            <span className="text-xs font-semibold text-violet-700 uppercase tracking-wider">
              Compensation Voucher
            </span>
          </div>
          <div className="flex gap-1">
            {isSuspended && (
              <Badge variant="outline" className="text-[9px] border-amber-300 text-amber-700 bg-amber-100">
                Suspended
              </Badge>
            )}
            {isRevoked && (
              <Badge variant="outline" className="text-[9px] border-gray-300 text-gray-600 bg-gray-100">
                Revoked
              </Badge>
            )}
            {isUsed && (
              <Badge variant="outline" className="text-[9px] border-emerald-300 text-emerald-700 bg-emerald-100">
                Used
              </Badge>
            )}
            {!isSuspended && !isRevoked && !isUsed && (
              <Badge variant="outline" className="text-[9px] border-violet-300 text-violet-700 bg-violet-100">
                Active
              </Badge>
            )}
          </div>
        </div>

        {/* Voucher code + amount */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-0.5">
              Code
            </p>
            <p className="text-sm font-mono font-bold text-[var(--anna-slate)]">
              {voucher.discountCode.code}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-0.5">
              Amount
            </p>
            <p className="text-sm font-bold text-violet-700 font-data">
              {discountValue ? `$${discountValue}` : "—"}
            </p>
          </div>
        </div>

        {/* Reason + issuer + expiry */}
        {voucher.compensationReason && (
          <p className="text-[10px] text-[var(--anna-slate-light)] italic leading-relaxed">
            “{voucher.compensationReason}”
          </p>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--anna-muted)]">
          {voucher.issuedByName && (
            <span className="inline-flex items-center gap-0.5">
              <User size={10} />
              {voucher.issuedByName}
            </span>
          )}
          {voucher.expiresAt && (
            <span className="inline-flex items-center gap-0.5">
              <Calendar size={10} />
              Exp {formatDateTime(voucher.expiresAt)}
            </span>
          )}
          {taskJobNo && (
            <span>
              Issued for #{taskJobNo}
            </span>
          )}
        </div>

        {/* Action buttons — only when active or suspended, not used/revoked */}
        {!isUsed && !isRevoked && (
          <div className="flex gap-1.5 pt-1 border-t border-[var(--anna-border)]/50">
            {isSuspended ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => voucherAction.mutate({ action: "reactivate" })}
                disabled={voucherAction.isPending}
                className="flex-1 h-7 rounded-lg border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-[10px] gap-1"
              >
                {voucherAction.isPending ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
                Reactivate
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => openActionDialog("suspend")}
                disabled={voucherAction.isPending}
                className="flex-1 h-7 rounded-lg border-amber-200 text-amber-700 hover:bg-amber-50 text-[10px] gap-1"
              >
                <Pause size={10} />
                Suspend
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => openActionDialog("remove")}
              disabled={voucherAction.isPending}
              className="flex-1 h-7 rounded-lg border-red-200 text-red-600 hover:bg-red-50 text-[10px] gap-1"
            >
              <Trash2 size={10} />
              Remove
            </Button>
          </div>
        )}
      </div>

      {/* Suspend / Remove reason dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setDialogOpen(false); setDialogAction(null); setReason(""); } }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>
              {dialogAction === "remove" ? "Permanently Remove Voucher?" : "Suspend Voucher?"}
            </DialogTitle>
            <DialogDescription>
              {dialogAction === "remove"
                ? "This will permanently revoke the voucher. The household will no longer be able to use it. This action cannot be undone."
                : "This will temporarily deactivate the voucher's discount code so it cannot be redeemed at checkout. You can reactivate it later."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] block">
              Reason {dialogAction === "remove" && <span className="text-red-500">*</span>}
            </label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={dialogAction === "remove"
                ? "Why is this voucher being permanently removed?"
                : "Why is this voucher being suspended?"}
              className="min-h-[70px] resize-none"
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setDialogAction(null); setReason(""); }}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={voucherAction.isPending || (dialogAction === "remove" && !reason.trim())}
              className={cn(
                dialogAction === "remove"
                  ? "bg-red-600 hover:bg-red-700 text-white"
                  : "bg-amber-600 hover:bg-amber-700 text-white"
              )}
            >
              {voucherAction.isPending && <Loader2 size={14} className="animate-spin mr-1" />}
              {dialogAction === "remove" ? "Remove Voucher" : "Suspend Voucher"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
