"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { EscrowActionDialog } from "@/components/ops/escrow-action-dialog";
import {
  X,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Wallet,
  Loader2,
  FileText,
  User,
  Calendar,
  DollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Props ──

interface BookingDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  initialBooking?: Record<string, unknown>;
}

// ── Helpers ──

function formatSgd(cents: number) {
  return `SGD $${(cents / 100).toFixed(2)}`;
}

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return "--";
  return new Date(dateStr).toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Styles ──

const TASK_STATUS_STYLES: Record<string, string> = {
  CREATED: "bg-gray-100 text-gray-600 border-gray-200",
  PREDICTED: "bg-violet-50 text-violet-700 border-violet-200",
  DISPATCHED: "bg-sky-50 text-sky-700 border-sky-200",
  IN_PROGRESS: "bg-purple-50 text-purple-700 border-purple-200",
  COMPLETED: "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  VERIFIED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ESCROW_RELEASED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  DISPUTED: "bg-red-50 text-red-600 border-red-200",
};

const BOOKING_STATUS_STYLES: Record<string, string> = {
  assigned: "bg-blue-50 text-blue-700 border-blue-200",
  accepted: "bg-indigo-50 text-indigo-700 border-indigo-200",
  in_progress: "bg-purple-50 text-purple-700 border-purple-200",
  completed: "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  cancelled: "bg-red-50 text-red-600 border-red-200",
};

const ESCROW_STYLES: Record<string, { bg: string; text: string; icon: typeof ShieldCheck }> = {
  HELD: { bg: "bg-amber-50", text: "text-amber-700", icon: Clock },
  RELEASED: { bg: "bg-emerald-50", text: "text-emerald-700", icon: CheckCircle2 },
  DISPUTED: { bg: "bg-red-50", text: "text-red-600", icon: AlertTriangle },
  REFUNDED: { bg: "bg-gray-100", text: "text-gray-600", icon: XCircle },
};

// ── Component ──

export function BookingDetailSheet({
  open,
  onOpenChange,
  taskId,
  initialBooking,
}: BookingDetailSheetProps) {
  const queryClient = useQueryClient();

  // Dialog state for escrow actions
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState<"release" | "resolve_dismiss" | "resolve_refund">("release");
  const [dialogEscrowId, setDialogEscrowId] = useState("");
  const [dialogAmount, setDialogAmount] = useState(0);
  const [dialogDisputeReason, setDialogDisputeReason] = useState<string | null>(null);

  // Fetch full task details
  const { data, isLoading } = useQuery({
    queryKey: ["ops-task-detail", taskId],
    queryFn: async () => {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (!res.ok) throw new Error("Failed to fetch task");
      return res.json();
    },
    enabled: open && !!taskId,
  });

  const task = data?.task as Record<string, unknown> | undefined;

  // Escrow action mutation
  const escrowAction = useMutation({
    mutationFn: async ({
      escrowId,
      action,
      resolution,
    }: {
      escrowId: string;
      action: string;
      resolution: string;
    }) => {
      const res = await fetch(`/api/ops/escrow/${escrowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, resolution }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Action failed" }));
        throw new Error(err.error);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-task-detail", taskId] });
      queryClient.invalidateQueries({ queryKey: ["ops-escrow"] });
      queryClient.invalidateQueries({ queryKey: ["ops-bookings"] });
      setDialogOpen(false);
    },
  });

  // Derived data
  const household = task?.household as Record<string, unknown> | undefined;
  const bookings = (task?.bookings as Record<string, unknown>[]) || [];
  const booking = bookings[0] as Record<string, unknown> | undefined;
  const vendor = booking?.vendor as Record<string, unknown> | undefined;
  const escrow = (task?.escrowEntries as Record<string, unknown>[])?.[0];
  const taskStatus = task?.status as string;
  const escrowState = escrow?.state as string;

  // ── Action handlers ──

  const openReleaseDialog = () => {
    if (!escrow) return;
    setDialogType("release");
    setDialogEscrowId(escrow.id as string);
    setDialogAmount(escrow.amountCents as number);
    setDialogDisputeReason(null);
    setDialogOpen(true);
  };

  const openDisputeDialog = () => {
    if (!escrow) return;
    setDialogType("resolve_dismiss");
    setDialogEscrowId(escrow.id as string);
    setDialogAmount(escrow.amountCents as number);
    setDialogDisputeReason(escrow.disputeReason as string | null);
    setDialogOpen(true);
  };

  const openRefundDialog = () => {
    if (!escrow) return;
    setDialogType("resolve_refund");
    setDialogEscrowId(escrow.id as string);
    setDialogAmount(escrow.amountCents as number);
    setDialogDisputeReason(escrow.disputeReason as string | null);
    setDialogOpen(true);
  };

  const handleDialogSubmit = async (
    escrowId: string,
    action: string,
    resolution: string
  ) => {
    await escrowAction.mutateAsync({ escrowId, action, resolution });
  };

  // Determine which actions to show
  const canRelease =
    escrowState === "HELD" &&
    (taskStatus === "VERIFIED" || taskStatus === "COMPLETED");
  const canDispute =
    escrowState === "HELD" &&
    (taskStatus === "COMPLETED" ||
      taskStatus === "IN_PROGRESS" ||
      taskStatus === "VERIFIED");
  const isDisputed = escrowState === "DISPUTED";

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        {/* Desktop: right side sheet */}
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg p-0 overflow-hidden"
        >
          {/* Mobile: bottom sheet */}
          {/* We use a responsive approach: the SheetContent renders right on all
              viewports; we override to bottom on small screens via a wrapper.
              Since SheetContent side is fixed per render, we use a CSS approach. */}
          <SheetHeader className="sr-only">
            <SheetTitle>Booking Details</SheetTitle>
            <SheetDescription>
              Detailed view of booking and escrow information
            </SheetDescription>
          </SheetHeader>

          {isLoading || !task ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-28 w-full rounded-xl" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
              <Separator />
              <div className="space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
              </div>
              <Separator />
              <Skeleton className="h-24 w-full rounded-xl" />
            </div>
          ) : (
            <div className="h-full overflow-y-auto">
              {/* ── Header with gradient ── */}
              <div className="bg-gradient-to-br from-[var(--anna-sage-dark)] to-[var(--anna-sage)] px-5 py-5 text-white relative">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-white/20 text-white/90 border border-white/10">
                        {(task?.category as string)?.replace(/_/g, " ")}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] font-medium border-white/20 bg-white/10 text-white/90",
                        )}
                      >
                        {taskStatus?.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <h3 className="text-base font-semibold truncate">
                      {household?.name as string || "Unknown Household"}
                    </h3>
                    {household?.postalCode && (
                      <p className="text-xs text-white/70 mt-0.5">
                        Singapore {(household.postalCode as string)}
                      </p>
                    )}
                    {vendor && (
                      <p className="text-xs text-white/60 mt-1.5 flex items-center gap-1">
                        <User size={12} />
                        {(vendor.name as string) || "Unknown Vendor"}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => onOpenChange(false)}
                    className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors shrink-0"
                    aria-label="Close"
                  >
                    <X size={16} className="text-white" />
                  </button>
                </div>
              </div>

              <div className="p-5 space-y-5">
                {/* ── Booking Details ── */}
                <section>
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
                    Booking Details
                  </h4>
                  <div className="space-y-2.5">
                    <InfoRow
                      icon={<Calendar size={14} />}
                      label="Scheduled"
                      value={formatDateTime(
                        (initialBooking?.scheduledStart as string) ??
                          (booking?.scheduledStart as string)
                      )}
                    />
                    {booking?.actualStart && (
                      <InfoRow
                        icon={<Clock size={14} />}
                        label="Actual Start"
                        value={formatDateTime(booking.actualStart as string)}
                      />
                    )}
                    {booking?.actualEnd && (
                      <InfoRow
                        icon={<Clock size={14} />}
                        label="Actual End"
                        value={formatDateTime(booking.actualEnd as string)}
                      />
                    )}
                    {booking && (
                      <div className="flex items-center justify-between py-1">
                        <span className="text-xs text-[var(--anna-muted)]">
                          Booking Status
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] font-medium",
                            BOOKING_STATUS_STYLES[booking.status as string] || ""
                          )}
                        >
                          {(booking.status as string)?.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    )}
                    {(initialBooking?.assignedStaff || booking?.assignedStaff) && (
                      <div className="flex items-center justify-between py-1">
                        <span className="text-xs text-[var(--anna-muted)]">
                          Staff Assigned
                        </span>
                        <span className="text-xs text-[var(--anna-slate)] font-medium">
                          {
                            (
                              (initialBooking?.assignedStaff as Record<string, unknown>) ??
                              (booking?.assignedStaff as Record<string, unknown>)
                            )?.name as string
                          }
                        </span>
                      </div>
                    )}
                  </div>
                </section>

                <Separator />

                {/* ── Escrow Section ── */}
                {escrow && (
                  <section>
                    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3 flex items-center gap-1.5">
                      <Wallet size={12} />
                      Escrow
                    </h4>
                    <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)] p-4 space-y-3">
                      {/* State badge */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--anna-muted)]">
                          State
                        </span>
                        <Badge
                          variant="secondary"
                          className={cn(
                            "text-[10px] font-medium",
                            ESCROW_STYLES[escrowState]?.bg,
                            ESCROW_STYLES[escrowState]?.text
                          )}
                        >
                          {escrowState?.replace(/_/g, " ")}
                        </Badge>
                      </div>

                      {/* Amount breakdown */}
                      <div className="space-y-2 pt-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[var(--anna-muted)]">
                            Amount
                          </span>
                          <span className="text-sm font-bold text-[var(--anna-slate)] font-data">
                            {formatSgd(escrow.amountCents as number)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[var(--anna-muted)]">
                            Commission (10%)
                          </span>
                          <span className="text-xs text-[var(--anna-slate-light)] font-data">
                            -{formatSgd(escrow.commissionCents as number)}
                          </span>
                        </div>
                        <Separator />
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-[var(--anna-muted)] font-medium">
                            Vendor Payout
                          </span>
                          <span className="text-sm font-bold text-[var(--anna-sage-dark)] font-data">
                            {formatSgd(escrow.vendorPayoutCents as number)}
                          </span>
                        </div>
                      </div>

                      {/* Dispute reason */}
                      {isDisputed && escrow.disputeReason && (
                        <div className="pt-2">
                          <div className="p-3 rounded-lg bg-red-50/70 border border-red-100">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-red-500 mb-1">
                              Dispute Reason
                            </p>
                            <p className="text-xs text-red-700 leading-relaxed">
                              {escrow.disputeReason as string}
                            </p>
                          </div>
                          {escrow.disputeResolution && (
                            <div className="p-3 rounded-lg bg-[var(--anna-sage-light)]/50 border border-[var(--anna-sage)]/20 mt-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-sage-dark)] mb-1">
                                Resolution
                              </p>
                              <p className="text-xs text-[var(--anna-slate)] leading-relaxed">
                                {escrow.disputeResolution as string}
                              </p>
                              {escrow.disputeResolvedBy && (
                                <p className="text-[10px] text-[var(--anna-muted)] mt-1">
                                  by {escrow.disputeResolvedBy as string}
                                  {escrow.disputeResolvedAt &&
                                    ` at ${formatDateTime(escrow.disputeResolvedAt as string)}`}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* REFUNDED info */}
                      {escrowState === "REFUNDED" && (
                        <div className="pt-2">
                          <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                            <p className="text-xs text-gray-600">
                              Refund of{" "}
                              <span className="font-bold">
                                {formatSgd(escrow.amountCents as number)}
                              </span>{" "}
                              issued to the household.
                            </p>
                            {escrow.refundedAt && (
                              <p className="text-[10px] text-gray-500 mt-1 font-data">
                                {formatDateTime(escrow.refundedAt as string)}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* ── Quick Actions ── */}
                {(canRelease || canDispute || isDisputed) && (
                  <>
                    <Separator />
                    <section>
                      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
                        Quick Actions
                      </h4>
                      <div className="space-y-2">
                        {canRelease && (
                          <Button
                            onClick={openReleaseDialog}
                            className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium gap-2"
                          >
                            <ShieldCheck size={16} />
                            Release Payment
                          </Button>
                        )}
                        {canDispute && !canRelease && (
                          <Button
                            onClick={openDisputeDialog}
                            className="w-full rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium gap-2"
                          >
                            <ShieldAlert size={16} />
                            Raise Dispute
                          </Button>
                        )}
                        {isDisputed && (
                          <>
                            <Button
                              onClick={openDisputeDialog}
                              className="w-full rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium gap-2"
                            >
                              <ShieldAlert size={16} />
                              Dismiss Dispute
                            </Button>
                            <Button
                              onClick={openRefundDialog}
                              className="w-full rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-medium gap-2"
                            >
                              <AlertTriangle size={16} />
                              Issue Refund
                            </Button>
                          </>
                        )}
                      </div>
                    </section>
                  </>
                )}

                {/* ── Vendor Notes ── */}
                {booking?.completionNotes && (
                  <>
                    <Separator />
                    <section>
                      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3 flex items-center gap-1.5">
                        <FileText size={12} />
                        Vendor Notes
                      </h4>
                      <div className="p-3 rounded-xl bg-[var(--anna-bg)] border border-[var(--anna-border)]">
                        <p className="text-xs text-[var(--anna-slate)] leading-relaxed whitespace-pre-wrap">
                          {booking.completionNotes as string}
                        </p>
                      </div>
                    </section>
                  </>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Escrow Action Dialog ── */}
      <EscrowActionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        type={dialogType}
        taskId={taskId}
        escrowId={dialogEscrowId}
        amountCents={dialogAmount}
        disputeReason={dialogDisputeReason}
        onSubmit={handleDialogSubmit}
        isSubmitting={escrowAction.isPending}
      />
    </>
  );
}

// ── Sub-components ──

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-[var(--anna-muted)] flex items-center gap-1.5">
        {icon}
        {label}
      </span>
      <span className="text-xs text-[var(--anna-slate)] font-medium font-data">
        {value}
      </span>
    </div>
  );
}
