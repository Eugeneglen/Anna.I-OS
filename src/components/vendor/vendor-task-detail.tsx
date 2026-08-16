"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { CategoryIcon, getCategoryLabel } from "@/components/anna/category-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
import { Separator } from "@/components/ui/separator";
import { VendorPhotoUpload } from "./vendor-photo-upload";
import { cn } from "@/lib/utils";
import { formatSgd, formatDate, formatTime, type ServiceCategory } from "@/lib/types";
import type { VendorScheduleItem, VendorInfo } from "./vendor-schedule";
import {
  Clock,
  MapPin,
  User,
  Star,
  CheckCircle,
  Play,
  ThumbsUp,
  ThumbsDown,
  CalendarDays,
  ImageIcon,
  FileText,
  AlertTriangle,
  ShieldCheck,
  Wallet,
  Loader2,
  Copy,
  UserPlus,
} from "lucide-react";

// ─── Props ────────────────────────────────────────────────

interface VendorTaskDetailProps {
  booking: VendorScheduleItem | null;
  vendor: VendorInfo | null;
  open: boolean;
  onClose: () => void;
  onAction: (bookingId: string, action: string, payload?: string) => void;
  isActionPending?: boolean;
  vendorId: string;
  /** Called after staff assignment succeeds — parent should refetch schedule */
  onStaffAssigned?: () => void;
}

// ─── Types for staff picker ──────────────────────────────

interface StaffMember {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
}

// ─── Status badge styles ──────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  assigned: "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)] border-[var(--anna-warning)]/20",
  accepted: "bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  in_progress: "bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  completed: "bg-[var(--anna-success)]/15 text-[var(--anna-success)] border-[var(--anna-success)]/20",
  cancelled: "bg-[var(--anna-muted)]/15 text-[var(--anna-muted)] border-[var(--anna-muted)]/20",
};

const STATUS_LABELS: Record<string, string> = {
  assigned: "Assigned",
  accepted: "Accepted",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

// ─── Action config ────────────────────────────────────────

interface ActionConfig {
  primary: { label: string; icon: React.ElementType; action: string } | null;
  /** Optional secondary action (e.g. reject) rendered as an outline button */
  secondary?: { label: string; icon: React.ElementType; action: string; destructive?: boolean } | null;
}

function getActionConfig(status: string): ActionConfig {
  switch (status) {
    case "assigned":
      return {
        primary: { label: "Accept Job", icon: ThumbsUp, action: "accept" },
        // Vendor can decline a job they cannot take — triggers auto-re-route to next vendor
        secondary: { label: "Decline", icon: ThumbsDown, action: "reject", destructive: true },
      };
    case "accepted":
      return { primary: { label: "Mark Complete", icon: CheckCircle, action: "complete" } };
    default:
      return { primary: null };
  }
}

// ─── Rating display ───────────────────────────────────────

function RatingDisplay({ rating, comment }: { rating: number | null; comment?: string | null }) {
  if (!rating) return null;

  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={14}
          className={
            i < rating
              ? "text-[var(--anna-warning)]"
              : "text-[var(--anna-border)]"
          }
          fill={i < rating ? "currentColor" : "none"}
        />
      ))}
      {comment && (
        <span className="text-xs text-[var(--anna-muted)] ml-2 italic">
          &ldquo;{comment}&rdquo;
        </span>
      )}
    </div>
  );
}

// ─── Detail content ───────────────────────────────────────

function VendorTaskDetailContent({
  booking,
  vendorInfo,
  onAction,
  isActionPending,
  vendorId,
  onStaffAssigned,
}: {
  booking: VendorScheduleItem;
  vendorInfo: VendorInfo;
  onAction: (bookingId: string, action: string) => void;
  isActionPending: boolean;
  vendorId: string;
  onStaffAssigned?: () => void;
}) {
  const actionConfig = getActionConfig(booking.status);
  const action = actionConfig.primary;
  const secondaryAction = actionConfig.secondary;
  const showPhotoUpload = booking.status === "in_progress" || booking.status === "completed";
  const isDisputed = booking.taskStatus === "DISPUTED" || booking.escrow?.state === "DISPUTED";

  // Can assign/reassign staff when booking is assigned or accepted
  const canAssignStaff = ["assigned", "accepted"].includes(booking.status);

  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  // Staff assignment state
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>("");
  const [isAssigningStaff, setIsAssigningStaff] = useState(false);
  const [isLoadingStaff, setIsLoadingStaff] = useState(false);

  // Fetch vendor's staff list for the picker
  useEffect(() => {
    if (!vendorId || !canAssignStaff) return;

    let cancelled = false;
    setIsLoadingStaff(true);

    (async () => {
      try {
        const res = await fetch("/api/vendor/staff");
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) {
          const members: StaffMember[] = (json.staff ?? []).map((s: { id: string; name: string; role: string; isActive: boolean }) => ({
            id: s.id,
            name: s.name,
            role: s.role,
            isActive: s.isActive,
          }));
          setStaffList(members);
        }
      } catch {
        // Silently fail — staff list is non-critical
      } finally {
        if (!cancelled) setIsLoadingStaff(false);
      }
    })();

    return () => { cancelled = true; };
  }, [vendorId, canAssignStaff]);

  // When a booking already has staff, pre-select them
  useEffect(() => {
    if (booking.assignedStaff) {
      setSelectedStaffId(booking.assignedStaff.id);
    } else {
      setSelectedStaffId("");
    }
  }, [booking.assignedStaff]);

  const handleAssignStaff = async () => {
    if (!selectedStaffId || isAssigningStaff) return;
    setIsAssigningStaff(true);

    try {
      const res = await fetch(
        `/api/vendors/${vendorId}/bookings/${booking.id}/assign-staff`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId: selectedStaffId }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || "Failed to assign staff");
        return;
      }
      const json = await res.json();
      const staffName = json.booking?.assignedStaff?.name || "Staff";
      toast.success(`${staffName} assigned to this job`);
      onStaffAssigned?.();
    } catch {
      toast.error("Failed to assign staff");
    } finally {
      setIsAssigningStaff(false);
    }
  };

  const handleShare = async () => {
    if (isSharing) return;
    setIsSharing(true);
    try {
      const res = await fetch(
        `/api/vendors/${vendorId}/bookings/${booking.id}/share`,
        { method: "POST" }
      );
      if (!res.ok) return;
      const json = await res.json();
      const url: string = json.shareUrl;
      setShareUrl(url);
      await navigator.clipboard.writeText(url);
      toast.success(
        `Link copied! Share it with ${booking.assignedStaff!.name}`
      );
    } catch {
      toast.error("Failed to generate share link");
    } finally {
      setIsSharing(false);
    }
  };

  const activeStaff = staffList.filter((s) => s.isActive);

  return (
    <div className="p-6 space-y-6 anna-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <CategoryIcon category={booking.category} size={20} />
          <div>
            <h2 className="text-lg font-bold text-[var(--anna-slate)]">
              {getCategoryLabel(booking.category)}
            </h2>
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn("text-[10px] px-2 py-0.5 font-medium", STATUS_STYLES[booking.status])}
        >
          {STATUS_LABELS[booking.status] ?? booking.status}
        </Badge>
      </div>

      {/* ── Dispute Alert Section ── */}
      {isDisputed && (
        <div className="rounded-2xl border-2 border-[var(--anna-error)]/30 bg-gradient-to-br from-[var(--anna-error)]/5 to-[var(--anna-white)] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[var(--anna-error)]/15 flex items-center justify-center">
              <AlertTriangle size={16} className="text-[var(--anna-error)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--anna-error)]">Dispute Raised</p>
              <p className="text-[10px] text-[var(--anna-error)]/60">
                Ops team is reviewing this matter
              </p>
            </div>
          </div>
          {booking.escrow?.disputeReason && (
            <div className="bg-[var(--anna-error)]/5 rounded-xl p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-error)]/70 mb-1">Household&apos;s Reason</p>
              <p className="text-xs text-[var(--anna-slate)] leading-relaxed">{booking.escrow.disputeReason}</p>
            </div>
          )}
          {booking.escrow?.disputeResolution && (
            <div className="bg-[var(--anna-sage-light)]/30 rounded-xl p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-sage-dark)]/70 mb-1">Resolution</p>
              <p className="text-xs text-[var(--anna-slate)] leading-relaxed">{booking.escrow.disputeResolution}</p>
            </div>
          )}
          <div className="flex items-center justify-between text-[10px] text-[var(--anna-muted)]">
            <span>Escrow: {formatSgd(booking.escrow?.amountCents ?? 0)} — <span className="text-[var(--anna-error)] font-medium">Frozen</span></span>
            {booking.taskDisputedAt && (
              <span>Disputed {formatDate(booking.taskDisputedAt)}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Escrow Status Section (non-disputed) ── */}
      {!isDisputed && booking.escrow && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
            <Wallet size={12} className="inline mr-1" />
            Escrow
          </h4>
          <div className="bg-[var(--anna-bg)] rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[var(--anna-muted)]">Status</span>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] px-2 py-0.5 font-medium",
                  booking.escrow.state === "RELEASED"
                    ? "bg-[var(--anna-success)]/15 text-[var(--anna-success)] border-[var(--anna-success)]/20"
                    : booking.escrow.state === "REFUNDED"
                      ? "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)] border-[var(--anna-warning)]/20"
                      : "bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20"
                )}
              >
                {booking.escrow.state === "RELEASED" ? (
                  <><ShieldCheck size={10} className="mr-1" />Released</>
                ) : booking.escrow.state === "HELD" ? (
                  <><Clock size={10} className="mr-1" />Held</>
                ) : booking.escrow.state === "REFUNDED" ? (
                  <><Wallet size={10} className="mr-1" />Refunded</>
                ) : (
                  booking.escrow.state
                )}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--anna-muted)]">Your Payout</span>
              <span className="font-data text-sm font-bold text-[var(--anna-slate)]">
                {formatSgd(booking.escrow.vendorPayoutCents)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Amount */}
      <div className="bg-[var(--anna-sage-light)] rounded-2xl p-4 flex items-center justify-between">
        <span className="text-sm text-[var(--anna-slate-light)]">Job Amount</span>
        <span className="font-data text-xl font-bold text-[var(--anna-slate)]">
          {formatSgd(booking.amountCents)}
        </span>
      </div>

      {/* Instructions */}
      {booking.instructions && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
            Instructions
          </h4>
          <p className="text-sm text-[var(--anna-slate)] leading-relaxed bg-[var(--anna-bg)] rounded-xl p-4">
            {booking.instructions}
          </p>
        </div>
      )}

      {/* Household info */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
          Household
        </h4>
        <div className="bg-[var(--anna-bg)] rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <User size={14} className="text-[var(--anna-muted)]" />
            <span className="text-sm font-medium text-[var(--anna-slate)]">
              {booking.householdName}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--anna-muted)]">
            <MapPin size={12} />
            <span>{booking.address}</span>
          </div>
        </div>
      </div>

      {/* Scheduled / Actual times */}
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
          Schedule
        </h4>
        <div className="bg-[var(--anna-bg)] rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs text-[var(--anna-muted)]">
            <CalendarDays size={12} />
            <span>
              Scheduled: {formatDate(booking.scheduledStart)}{" "}
              {formatTime(booking.scheduledStart)}
            </span>
          </div>
          {booking.scheduledEnd && (
            <div className="flex items-center gap-2 text-xs text-[var(--anna-muted)] pl-5">
              &ndash; {formatTime(booking.scheduledEnd)}
            </div>
          )}
          {booking.actualStart && (
            <div className="flex items-center gap-2 text-xs text-[var(--anna-muted)]">
              <Clock size={12} />
              <span>
                Actual start: {formatDate(booking.actualStart)}{" "}
                {formatTime(booking.actualStart)}
              </span>
            </div>
          )}
          {booking.actualEnd && (
            <div className="flex items-center gap-2 text-xs text-[var(--anna-muted)]">
              <Clock size={12} />
              <span>
                Actual end: {formatDate(booking.actualEnd)}{" "}
                {formatTime(booking.actualEnd)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Staff Assignment Section ── */}
      {canAssignStaff && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
            <UserPlus size={12} className="inline mr-1" />
            Assign Staff
          </h4>
          <div className="bg-[var(--anna-bg)] rounded-2xl p-4 space-y-3">
            {activeStaff.length === 0 ? (
              <div className="text-center py-2">
                <p className="text-xs text-[var(--anna-muted)]">
                  No staff members in your roster.
                </p>
                <p className="text-[10px] text-[var(--anna-muted)] mt-1">
                  Add staff from the Staff Roster page first.
                </p>
              </div>
            ) : (
              <>
                <Select
                  value={selectedStaffId}
                  onValueChange={setSelectedStaffId}
                  disabled={isLoadingStaff || isAssigningStaff}
                >
                  <SelectTrigger className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] h-10 text-sm">
                    <SelectValue placeholder={isLoadingStaff ? "Loading staff…" : "Select a staff member"} />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    {/* Un-assign option */}
                    {booking.assignedStaff && (
                      <SelectItem value="__unassign__" className="text-[var(--anna-muted)]">
                        <span className="italic">— Remove assignment —</span>
                      </SelectItem>
                    )}
                    {activeStaff.map((staff) => (
                      <SelectItem key={staff.id} value={staff.id}>
                        <div className="flex items-center gap-2">
                          <div className="w-5 h-5 rounded-full bg-[var(--anna-sage-light)] flex items-center justify-center">
                            <User size={10} className="text-[var(--anna-sage-dark)]" />
                          </div>
                          <span>{staff.name}</span>
                          {staff.role !== "staff" && (
                            <span className="text-[10px] text-[var(--anna-muted)]">
                              ({staff.role})
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (selectedStaffId === "__unassign__") {
                      // Un-assign: send empty body (we'll handle in API)
                      setSelectedStaffId("");
                      toast.success("Staff removed from this job");
                      onStaffAssigned?.();
                      return;
                    }
                    handleAssignStaff();
                  }}
                  disabled={!selectedStaffId || selectedStaffId === booking.assignedStaff?.id || isAssigningStaff || isLoadingStaff}
                  className="rounded-xl h-9 text-xs border-[var(--anna-border)] hover:bg-[var(--anna-sage-light)]"
                >
                  {isAssigningStaff ? (
                    <Loader2 size={12} className="mr-1.5 animate-spin" />
                  ) : (
                    <UserPlus size={12} className="mr-1.5" />
                  )}
                  {booking.assignedStaff && selectedStaffId === booking.assignedStaff.id
                    ? "Current Assignment"
                    : booking.assignedStaff
                      ? "Reassign Staff"
                      : "Assign Staff"}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Assigned staff info (read-only badge, visible after assignment) */}
      {booking.assignedStaff && canAssignStaff && (
        <div className="bg-[var(--anna-sage-light)]/30 rounded-xl p-3 flex items-center gap-2 border border-[var(--anna-sage)]/15">
          <div className="w-8 h-8 rounded-full bg-[var(--anna-sage)] flex items-center justify-center">
            <User size={14} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-medium text-[var(--anna-slate)]">
              {booking.assignedStaff.name}
            </p>
            <p className="text-[10px] text-[var(--anna-muted)]">
              Currently assigned to this job
            </p>
          </div>
        </div>
      )}

      {/* Assigned staff — completed/cancelled bookings (read-only display) */}
      {!canAssignStaff && booking.assignedStaff && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
            Assigned Staff
          </h4>
          <div className="bg-[var(--anna-bg)] rounded-2xl p-4 flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[var(--anna-sage-light)] flex items-center justify-center">
              <User size={14} className="text-[var(--anna-sage-dark)]" />
            </div>
            <span className="text-sm font-medium text-[var(--anna-slate)]">
              {booking.assignedStaff.name}
            </span>
          </div>
        </div>
      )}

      {/* Share Job Link — visible when staff is assigned + booking is accepted/in_progress */}
      {booking.assignedStaff && booking.status === "accepted" && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleShare}
          disabled={isSharing}
          className="w-full rounded-xl h-10 text-xs border-[var(--anna-border)] hover:bg-[var(--anna-sage-light)]"
        >
          {isSharing ? (
            <Loader2 size={12} className="mr-1.5 animate-spin" />
          ) : (
            <Copy size={12} className="mr-1.5" />
          )}
          {shareUrl ? "Copy Link Again" : "Share Job Link via WhatsApp"}
        </Button>
      )}

      {/* Photo upload (Before / After) */}
      {showPhotoUpload && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
            Work Photos
          </h4>
          <VendorPhotoUpload
            bookingId={booking.id}
            vendorId={vendorId}
            existingPhotos={booking.verificationPhotos}
          />
        </div>
      )}

      {/* Verification photo gallery — shows persisted photos from DB */}
      {booking.verificationPhotos && booking.verificationPhotos.length > 0 && !showPhotoUpload && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
            <ImageIcon size={12} className="inline mr-1" />
            Submitted Photos
          </h4>
          <div className="grid grid-cols-3 gap-2">
            {booking.verificationPhotos.map((photo) => (
              <div
                key={photo.id}
                className="relative aspect-square rounded-xl overflow-hidden border border-[var(--anna-border)]"
              >
                <img
                  src={photo.thumbnailUrl || photo.fileUrl}
                  alt="Verification"
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-1 left-1">
                  <Badge
                    className={cn(
                      "text-[8px] px-1 py-0 h-4 border-0",
                      photo.isVerified
                        ? "bg-[var(--anna-success)] text-white"
                        : photo.uploadedBy.includes("before")
                          ? "bg-[var(--anna-warning)] text-white"
                          : "bg-[var(--anna-sage)] text-white"
                    )}
                  >
                    {photo.isVerified ? "Verified" : photo.uploadedBy.includes("before") ? "Before" : "After"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vendor Completion Notes (shown for completed bookings) */}
      {booking.completionNotes && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
            <FileText size={12} className="inline mr-1" />
            Work Summary
          </h4>
          <div className="bg-gradient-to-br from-[var(--anna-sage-light)]/30 to-[var(--anna-bg)] rounded-2xl p-4 border border-[var(--anna-sage)]/15">
            <p className="text-sm text-[var(--anna-slate)] leading-relaxed whitespace-pre-wrap">
              {booking.completionNotes}
            </p>
          </div>
        </div>
      )}

      {/* Rating (read-only) */}
      {booking.rating && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
            Customer Rating
          </h4>
          <div className="bg-[var(--anna-bg)] rounded-2xl p-4">
            <RatingDisplay rating={booking.rating} comment={booking.ratingComment} />
          </div>
        </div>
      )}

      <Separator className="bg-[var(--anna-border)]" />

      {/* Action buttons — primary + optional secondary (reject) */}
      {(action || secondaryAction) && (
        <div className="space-y-2">
          {action && (
            <Button
              onClick={() => onAction(booking.id, action.action)}
              disabled={isActionPending}
              className="w-full bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl h-11 text-sm font-semibold"
            >
              {isActionPending ? (
                <Loader2 size={16} className="mr-2 animate-spin" />
              ) : (
                <action.icon size={16} className="mr-2" />
              )}
              {isActionPending ? "Updating..." : action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              onClick={() => {
                if (secondaryAction.action === "reject") {
                  setRejectDialogOpen(true);
                } else {
                  onAction(booking.id, secondaryAction.action);
                }
              }}
              disabled={isActionPending}
              variant="outline"
              className={cn(
                "w-full rounded-xl h-10 text-sm font-medium",
                secondaryAction.destructive
                  ? "border-[var(--anna-error)]/30 text-[var(--anna-error)] hover:bg-[var(--anna-error)]/5 hover:text-[var(--anna-error)]"
                  : ""
              )}
            >
              <secondaryAction.icon size={14} className="mr-2" />
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}

      {/* Reject confirmation dialog — prevents accidental declines */}
      <AlertDialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Decline this job?</AlertDialogTitle>
            <AlertDialogDescription>
              The booking will be cancelled and automatically re-routed to the next
              available provider for the {getCategoryLabel(booking.category).toLowerCase()} task.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Keep Job</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onAction(booking.id, "reject");
                setRejectDialogOpen(false);
              }}
              className="bg-[var(--anna-error)] hover:bg-red-600 text-white rounded-xl"
            >
              <ThumbsDown size={14} className="mr-1.5" />
              Decline Job
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Main exported component ──────────────────────────────

export function VendorTaskDetail({
  booking,
  vendor,
  open,
  onClose,
  onAction,
  isActionPending = false,
  vendorId,
  onStaffAssigned,
}: VendorTaskDetailProps) {
  const isMobile = useIsMobile();

  return (
    <>
      {/* Desktop: inline panel */}
      {booking && vendor && !isMobile && (
        <div className="border-t border-[var(--anna-border)] bg-[var(--anna-white)]">
          <VendorTaskDetailContent
            booking={booking}
            vendorInfo={vendor}
            onAction={onAction}
            isActionPending={isActionPending}
            vendorId={vendorId}
            onStaffAssigned={onStaffAssigned}
          />
        </div>
      )}

      {/* Mobile: Sheet overlay */}
      {isMobile && (
        <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
          <SheetContent side="bottom" className="h-[85vh] rounded-t-3xl anna-scroll">
            <SheetHeader className="sr-only">
              <SheetTitle>Booking Detail</SheetTitle>
              <SheetDescription>View and manage this booking</SheetDescription>
            </SheetHeader>
            {booking && vendor && (
              <VendorTaskDetailContent
                booking={booking}
                vendorInfo={vendor}
                onAction={onAction}
                isActionPending={isActionPending}
                vendorId={vendorId}
                onStaffAssigned={onStaffAssigned}
              />
            )}
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
