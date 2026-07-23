"use client";

import { useIsMobile } from "@/hooks/use-mobile";
import { CategoryIcon, getCategoryLabel } from "@/components/anna/category-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
  CalendarDays,
  ImageIcon,
} from "lucide-react";

// ─── Props ────────────────────────────────────────────────

interface VendorTaskDetailProps {
  booking: VendorScheduleItem | null;
  vendor: VendorInfo | null;
  open: boolean;
  onClose: () => void;
  onAction: (bookingId: string, action: string) => void;
  isActionPending?: boolean;
  vendorId: string;
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

function getActionConfig(status: string): {
  label: string;
  icon: React.ElementType;
  action: string;
} | null {
  switch (status) {
    case "assigned":
      return { label: "Accept Job", icon: ThumbsUp, action: "accept" };
    case "accepted":
      return { label: "Start Work", icon: Play, action: "start" };
    case "in_progress":
      return { label: "Mark Complete", icon: CheckCircle, action: "complete" };
    default:
      return null;
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
}: {
  booking: VendorScheduleItem;
  vendorInfo: VendorInfo;
  onAction: (bookingId: string, action: string) => void;
  isActionPending: boolean;
  vendorId: string;
}) {
  const action = getActionConfig(booking.status);
  const showPhotoUpload = booking.status === "in_progress" || booking.status === "completed";

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

      {/* SME: assigned staff */}
      {vendorInfo.vendorType === "SME" && booking.assignedStaff && (
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

      {/* Action button */}
      {action && (
        <Button
          onClick={() => onAction(booking.id, action.action)}
          disabled={isActionPending}
          className="w-full bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl h-11 text-sm font-semibold"
        >
          <action.icon size={16} className="mr-2" />
          {isActionPending ? "Updating..." : action.label}
        </Button>
      )}
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
              />
            )}
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}