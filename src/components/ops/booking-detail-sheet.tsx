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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  FileEdit,
  User,
  Calendar,
  CalendarClock,
  DollarSign,
  Camera,
  ImageIcon,
  Film,
} from "lucide-react";
import { toast } from "sonner";
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
  MATCHING: "bg-sky-50 text-sky-700 border-sky-200",
  ACCEPTED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  SCHEDULED: "bg-amber-50 text-amber-700 border-amber-200",
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

  // Dialog state for booking actions
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);
  const [rescheduleStart, setRescheduleStart] = useState("");
  const [rescheduleEnd, setRescheduleEnd] = useState("");
  const [editNotesDialogOpen, setEditNotesDialogOpen] = useState(false);
  const [editNotes, setEditNotes] = useState("");

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
  // Verification photos (before/after) — already returned by /api/tasks/[id]
  const verificationPhotos = (task?.verificationPhotos as Array<{
    id: string;
    fileUrl: string;
    thumbnailUrl?: string | null;
    uploadedBy: string;
    isVerified: boolean;
    rejectionReason?: string | null;
    verifiedAt?: string | null;
    createdAt: string;
  }>) || [];

  // ── Booking Action Mutations ──

  const bookingAction = useMutation({
    mutationFn: async ({ bookingId, action, ...payload }: { bookingId: string; action: string; reason?: string; scheduledStart?: string; scheduledEnd?: string; completionNotes?: string }) => {
      const res = await fetch(`/api/ops/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Action failed" }));
        throw new Error(err.error);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ops-task-detail", taskId] });
      queryClient.invalidateQueries({ queryKey: ["ops-bookings"] });
    },
  });

  // ── Action handlers ──

  const openCancelDialog = () => {
    setCancelReason("");
    setCancelDialogOpen(true);
  };

  const openRescheduleDialog = () => {
    const toLocalDatetime = (isoStr: string | null | undefined) => {
      if (!isoStr) return "";
      const d = new Date(isoStr);
      // Format as YYYY-MM-DDTHH:mm for datetime-local input
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    setRescheduleStart(toLocalDatetime((initialBooking?.scheduledStart as string) ?? (booking?.scheduledStart as string)));
    setRescheduleEnd(toLocalDatetime((initialBooking?.scheduledEnd as string) ?? (booking?.scheduledEnd as string)));
    setRescheduleDialogOpen(true);
  };

  const openEditNotesDialog = () => {
    setEditNotes((booking?.completionNotes as string) || "");
    setEditNotesDialogOpen(true);
  };

  const handleCancelBooking = async () => {
    if (!booking) return;
    try {
      await bookingAction.mutateAsync({
        bookingId: booking.id as string,
        action: "cancel",
        reason: cancelReason || undefined,
      });
      toast.success("Booking cancelled successfully");
      setCancelDialogOpen(false);
    } catch (err) {
      toast.error((err as Error).message || "Failed to cancel booking");
    }
  };

  const handleReschedule = async () => {
    if (!booking) return;
    try {
      await bookingAction.mutateAsync({
        bookingId: booking.id as string,
        action: "reschedule",
        scheduledStart: new Date(rescheduleStart).toISOString(),
        scheduledEnd: new Date(rescheduleEnd).toISOString(),
      });
      toast.success("Booking rescheduled successfully");
      setRescheduleDialogOpen(false);
    } catch (err) {
      toast.error((err as Error).message || "Failed to reschedule booking");
    }
  };

  const handleUpdateNotes = async () => {
    if (!booking) return;
    try {
      await bookingAction.mutateAsync({
        bookingId: booking.id as string,
        action: "update_notes",
        completionNotes: editNotes,
      });
      toast.success("Notes updated successfully");
      setEditNotesDialogOpen(false);
    } catch (err) {
      toast.error((err as Error).message || "Failed to update notes");
    }
  };

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
                {/* ── Booking Actions ── */}
                {booking && (
                  <section>
                    <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
                      Booking Actions
                    </h4>
                    <div className="flex gap-2 flex-wrap">
                      {booking.status !== "completed" && booking.status !== "cancelled" && (
                        <>
                          <button
                            onClick={openCancelDialog}
                            className="text-xs px-3 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 inline-flex items-center gap-1.5 transition-colors"
                          >
                            <XCircle size={13} />
                            Cancel Booking
                          </button>
                          <button
                            onClick={openRescheduleDialog}
                            className="text-xs px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 inline-flex items-center gap-1.5 transition-colors"
                          >
                            <CalendarClock size={13} />
                            Reschedule
                          </button>
                        </>
                      )}
                      <button
                        onClick={openEditNotesDialog}
                        className="text-xs px-3 py-1.5 rounded-lg bg-[var(--anna-bg)] text-[var(--anna-slate-light)] border border-[var(--anna-border)] hover:bg-[var(--anna-sage-light)]/30 inline-flex items-center gap-1.5 transition-colors"
                      >
                        <FileEdit size={13} />
                        Edit Notes
                      </button>
                    </div>
                  </section>
                )}

                <Separator />

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

                {/* ── Task Instructions ── */}
                {task?.instructions && (
                  <>
                    <Separator />
                    <section>
                      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3 flex items-center gap-1.5">
                        <FileText size={12} />
                        Task Instructions
                      </h4>
                      <div className="p-3 rounded-xl bg-[var(--anna-bg)] border border-[var(--anna-border)]">
                        <p className="text-xs text-[var(--anna-slate)] leading-relaxed whitespace-pre-wrap">
                          {task.instructions as string}
                        </p>
                      </div>
                    </section>
                  </>
                )}

                {/* ── Customer Attachments (Photos/Videos) ── */}
                {((task?.attachments as Array<Record<string, unknown>>)?.length ?? 0) > 0 && (
                  <>
                    <Separator />
                    <section>
                      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3 flex items-center gap-1.5">
                        <ImageIcon size={12} />
                        Customer Attachments
                        <span className="ml-1 text-[9px] font-data text-[var(--anna-muted)] bg-[var(--anna-bg)] px-1.5 py-0.5 rounded-md border border-[var(--anna-border)]">
                          {(task?.attachments as Array<Record<string, unknown>>).length}
                        </span>
                      </h4>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {(task?.attachments as Array<Record<string, unknown>>).map((att: Record<string, unknown>) =>
                          att.fileType === "PHOTO" ? (
                            <a
                              key={att.id as string}
                              href={att.fileUrl as string}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group aspect-square rounded-xl overflow-hidden border border-[var(--anna-border)] relative"
                            >
                              <img
                                src={att.fileUrl as string}
                                alt={att.fileName as string}
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                <ImageIcon size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </a>
                          ) : (
                            <a
                              key={att.id as string}
                              href={att.fileUrl as string}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="aspect-square rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)] flex flex-col items-center justify-center gap-1 p-2 hover:border-[var(--anna-sage)]/40 transition-colors"
                            >
                              <Film size={20} className="text-[var(--anna-muted)]" />
                              <span className="text-[9px] text-[var(--anna-muted)] text-center line-clamp-2">
                                {att.fileName as string}
                              </span>
                            </a>
                          )
                        )}
                      </div>
                    </section>
                  </>
                )}

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

                {/* ── Booking Add-ons ── */}
                {(() => {
                  const bookingAddons = (booking?.addons as Array<{
                    id: string;
                    description: string;
                    amountCents: number;
                    status: string;
                    createdAt: string;
                    approvedAt?: string | null;
                    rejectedAt?: string | null;
                  }>) || [];
                  if (bookingAddons.length === 0) return null;
                  const approvedTotal = bookingAddons
                    .filter((a) => a.status === "approved")
                    .reduce((sum, a) => sum + a.amountCents, 0);
                  const baseAmount = task?.amountCents as number || 0;
                  return (
                    <>
                      <Separator />
                      <section>
                        <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3 flex items-center gap-1.5">
                          <DollarSign size={12} />
                          Add-on Charges
                          <span className="ml-1 text-[9px] font-data text-[var(--anna-muted)] bg-[var(--anna-bg)] px-1.5 py-0.5 rounded-md border border-[var(--anna-border)]">
                            {bookingAddons.length}
                          </span>
                        </h4>
                        <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)] p-4 space-y-3">
                          {/* Addon list */}
                          <div className="space-y-2">
                            {bookingAddons.map((addon) => (
                              <div key={addon.id} className="flex items-center justify-between">
                                <div className="flex-1 min-w-0 mr-3">
                                  <p className="text-xs text-[var(--anna-slate)] truncate">{addon.description}</p>
                                  <p className="text-[10px] text-[var(--anna-muted)]">
                                    {addon.status === "pending"
                                      ? "Awaiting approval"
                                      : addon.status === "approved"
                                        ? `Approved ${addon.approvedAt ? formatDateTime(addon.approvedAt) : ""}`
                                        : `Rejected ${addon.rejectedAt ? formatDateTime(addon.rejectedAt) : ""}`}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <Badge
                                    variant="secondary"
                                    className={cn(
                                      "text-[9px] px-1.5 py-0 h-5 border-0",
                                      addon.status === "pending"
                                        ? "bg-amber-100 text-amber-700"
                                        : addon.status === "approved"
                                          ? "bg-emerald-100 text-emerald-700"
                                          : "bg-red-100 text-red-600"
                                    )}
                                  >
                                    {addon.status}
                                  </Badge>
                                  <span className="text-xs font-bold text-[var(--anna-slate)] font-data">
                                    {formatSgd(addon.amountCents)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                          {/* Total breakdown */}
                          {approvedTotal > 0 && (
                            <div className="border-t border-[var(--anna-border)] pt-2 space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-[var(--anna-muted)]">Base service</span>
                                <span className="font-data font-medium">{formatSgd(baseAmount)}</span>
                              </div>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-[var(--anna-muted)]">Approved add-ons</span>
                                <span className="font-data font-medium text-[var(--anna-sage-dark)]">+{formatSgd(approvedTotal)}</span>
                              </div>
                              <Separator />
                              <div className="flex items-center justify-between text-sm">
                                <span className="font-semibold text-[var(--anna-slate)]">Total Amount</span>
                                <span className="font-data font-bold text-[var(--anna-sage-dark)]">{formatSgd(baseAmount + approvedTotal)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </section>
                    </>
                  );
                })()}

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

                {/* ── Verification Photos ── */}
                {verificationPhotos.length > 0 && (
                  <>
                    <Separator />
                    <section>
                      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3 flex items-center gap-1.5">
                        <Camera size={12} />
                        Verification Photos
                        <span className="ml-1 text-[9px] font-data text-[var(--anna-muted)] bg-[var(--anna-bg)] px-1.5 py-0.5 rounded-md border border-[var(--anna-border)]">
                          {verificationPhotos.length}
                        </span>
                      </h4>
                      <div className="grid grid-cols-3 gap-2">
                        {verificationPhotos.map((photo) => {
                          const isBefore = photo.uploadedBy?.includes("before");
                          return (
                            <a
                              key={photo.id}
                              href={photo.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="relative aspect-square rounded-xl overflow-hidden border border-[var(--anna-border)] group hover:border-[var(--anna-sage)]/50 transition-colors"
                              title={`Uploaded ${formatDateTime(photo.createdAt)} — click to view full size`}
                            >
                              <img
                                src={photo.thumbnailUrl || photo.fileUrl}
                                alt={`Verification photo (${isBefore ? "Before" : "After"})`}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.opacity = "0.3";
                                }}
                              />
                              {/* Top-left: Before/After label */}
                              <div className="absolute top-1 left-1">
                                <span className={cn(
                                  "text-[8px] font-bold px-1 py-0 h-4 rounded flex items-center border-0",
                                  isBefore
                                    ? "bg-[var(--anna-warning)] text-white"
                                    : "bg-[var(--anna-sage)] text-white"
                                )}>
                                  {isBefore ? "Before" : "After"}
                                </span>
                              </div>
                              {/* Top-right: Verification status */}
                              <div className="absolute top-1 right-1">
                                {photo.isVerified ? (
                                  <span className="bg-[var(--anna-success)] text-white text-[8px] px-1 py-0 h-4 rounded flex items-center gap-0.5">
                                    <CheckCircle2 size={9} />
                                  </span>
                                ) : photo.rejectionReason ? (
                                  <span className="bg-red-500 text-white text-[8px] px-1 py-0 h-4 rounded flex items-center gap-0.5">
                                    <XCircle size={9} />
                                  </span>
                                ) : (
                                  <span className="bg-[var(--anna-warning)] text-white text-[8px] px-1 py-0 h-4 rounded flex items-center gap-0.5">
                                    <Clock size={9} />
                                  </span>
                                )}
                              </div>
                              {/* Hover overlay with zoom hint */}
                              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                                <ImageIcon size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                              </div>
                            </a>
                          );
                        })}
                      </div>
                      {/* Rejection reason footer (if any photo was rejected) */}
                      {verificationPhotos.some((p) => p.rejectionReason) && (
                        <div className="mt-2 p-2 rounded-lg bg-red-50/70 border border-red-100">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-red-500 mb-0.5">
                            Rejection Reason
                          </p>
                          <p className="text-xs text-red-700">
                            {verificationPhotos.find((p) => p.rejectionReason)?.rejectionReason}
                          </p>
                        </div>
                      )}
                    </section>
                  </>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Cancel Booking Dialog ── */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Cancel Booking</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-[var(--anna-slate-light)]">
              Are you sure you want to cancel this booking? This action cannot be undone.
            </p>
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--anna-muted)]">Reason (optional)</label>
              <Input
                placeholder="Enter cancellation reason..."
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleCancelBooking}
              disabled={bookingAction.isPending}
            >
              {bookingAction.isPending && <Loader2 size={14} className="mr-1 animate-spin" />}
              Confirm Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reschedule Dialog ── */}
      <Dialog open={rescheduleDialogOpen} onOpenChange={setRescheduleDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Reschedule Booking</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--anna-muted)]">Scheduled Start</label>
              <Input
                type="datetime-local"
                value={rescheduleStart}
                onChange={(e) => setRescheduleStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--anna-muted)]">Scheduled End</label>
              <Input
                type="datetime-local"
                value={rescheduleEnd}
                onChange={(e) => setRescheduleEnd(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRescheduleDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleReschedule}
              disabled={bookingAction.isPending}
            >
              {bookingAction.isPending && <Loader2 size={14} className="mr-1 animate-spin" />}
              Confirm Reschedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Notes Dialog ── */}
      <Dialog open={editNotesDialogOpen} onOpenChange={setEditNotesDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Edit Completion Notes</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-xs font-medium text-[var(--anna-muted)]">Completion Notes</label>
              <Textarea
                placeholder="Enter completion notes..."
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditNotesDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUpdateNotes}
              disabled={bookingAction.isPending}
            >
              {bookingAction.isPending && <Loader2 size={14} className="mr-1 animate-spin" />}
              Save Notes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
