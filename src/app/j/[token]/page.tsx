"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { CategoryIcon, getCategoryLabel } from "@/components/anna/category-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatSgd, formatDate, formatTime, type ServiceCategory } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  CalendarDays,
  MapPin,
  FileText,
  User,
  Clock,
  Home,
  AlertCircle,
  RefreshCw,
  Wallet,
  Briefcase,
  Phone,
  CheckCircle2,
  Circle,
  Camera,
  Upload,
  ImageIcon,
  CheckCircle,
  Loader2,
  Receipt,
  Plus,
  DollarSign,
  Film,
  Package,
  Truck,
  Hash,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────

interface ShareBooking {
  id: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  category: string;
  instructions: string | null;
  amountCents: number;
  discountCents?: number;
  finalAmountCents?: number;
  jobNo: string | null;
  taskStatus: string;
  address: string | null;
  unitNumber: string | null;
  householdName: string | null;
  serviceName: string | null;
  serviceDescription: string | null;
  vendorName: string;
  vendorLogo: string | null;
  vendorPhone: string | null;
  staffName: string | null;
  staffRole: string | null;
  staffContact: string | null;
  customerAttachments?: { id: string; fileType: string; fileUrl: string; thumbnailUrl?: string | null; fileName: string }[];
}

interface ShareData {
  booking: ShareBooking;
}

interface UploadedPhoto {
  fileUrl: string;
  type: string;
}

interface Addon {
  id: string;
  description: string;
  amountCents: number;
  status: string;
  createdAt: string;
}

// ─── Status styles ─────────────────────────────────────────

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

const ADDON_STATUS_STYLES: Record<string, string> = {
  pending: "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)] border-[var(--anna-warning)]/20",
  approved: "bg-[var(--anna-success)]/15 text-[var(--anna-success)] border-[var(--anna-success)]/20",
  rejected: "bg-[var(--anna-error)]/15 text-[var(--anna-error)] border-[var(--anna-error)]/20",
};

const ADDON_STATUS_LABELS: Record<string, string> = {
  pending: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
};

// ─── Status timeline steps ─────────────────────────────────

function StatusTimeline({ status }: { status: string }) {
  const steps: { key: string; label: string }[] = [
    { key: "assigned", label: "Assigned" },
    { key: "accepted", label: "Accepted" },
    { key: "in_progress", label: "In Progress" },
    { key: "completed", label: "Completed" },
  ];

  const activeIndex = steps.findIndex((s) => s.key === status);

  return (
    <div className="flex items-center gap-1.5">
      {steps.map((step, i) => {
        const isActive = i <= activeIndex;
        const isCurrent = step.key === status;
        return (
          <div key={step.key} className="flex items-center gap-1.5">
            {i > 0 && (
              <div
                className={cn(
                  "w-6 h-0.5 rounded-full",
                  isActive ? "bg-[var(--anna-sage)]" : "bg-[var(--anna-border)]"
                )}
              />
            )}
            <div className="flex flex-col items-center gap-0.5">
              <div
                className={cn(
                  "w-5 h-5 rounded-full flex items-center justify-center",
                  isCurrent
                    ? "bg-[var(--anna-sage)] ring-2 ring-[var(--anna-sage)]/30"
                    : isActive
                      ? "bg-[var(--anna-sage)]"
                      : "bg-[var(--anna-border)]"
                )}
              >
                {isActive ? (
                  <CheckCircle2 size={10} className="text-white" />
                ) : (
                  <Circle size={10} className="text-[var(--anna-muted)]" />
                )}
              </div>
              <span
                className={cn(
                  "text-[9px] leading-tight",
                  isCurrent
                    ? "text-[var(--anna-sage-dark)] font-semibold"
                    : isActive
                      ? "text-[var(--anna-sage-dark)]"
                      : "text-[var(--anna-muted)]"
                )}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Loading Skeleton ─────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Header skeleton */}
      <div className="sticky top-0 z-10 bg-white border-b border-[var(--anna-border)] px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="w-7 h-7 rounded-lg" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="h-5 w-28" />
        </div>
      </div>

      <div className="flex-1 max-w-lg mx-auto w-full px-4 py-6 space-y-5">
        {/* Category card */}
        <div className="bg-[var(--anna-bg)] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="w-10 h-10 rounded-xl" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="h-5 w-32" />
        </div>

        {/* Timeline */}
        <Skeleton className="h-10 w-full" />

        {/* Amount */}
        <Skeleton className="h-14 w-full rounded-2xl" />

        {/* Details card */}
        <div className="bg-[var(--anna-bg)] rounded-2xl p-5 space-y-5">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-52" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-40" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-36" />
          </div>
        </div>

        {/* Staff card */}
        <Skeleton className="h-16 w-full rounded-2xl" />

        {/* Reference */}
        <Skeleton className="h-4 w-40 mx-auto" />
      </div>
    </div>
  );
}

// ─── Error State ──────────────────────────────────────────

function ErrorState({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-[var(--anna-border)] px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[var(--anna-sage)] flex items-center justify-center">
            <Home size={14} className="text-white" />
          </div>
          <span className="text-sm font-bold text-[var(--anna-slate)]">
            Anna.I
          </span>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-[var(--anna-error)]/10 flex items-center justify-center mx-auto">
            <AlertCircle size={28} className="text-[var(--anna-error)]" />
          </div>
          <h1 className="text-lg font-bold text-[var(--anna-slate)]">
            Link Not Available
          </h1>
          <p className="text-sm text-[var(--anna-muted)] leading-relaxed">
            {message}
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto text-center py-4 border-t border-[var(--anna-border)]">
        <p className="text-[10px] text-[var(--anna-muted)]">
          Powered by Anna.I
        </p>
      </div>
    </div>
  );
}

// ─── Info Row ──────────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
        <Icon size={12} />
        {label}
      </div>
      <div className="text-sm text-[var(--anna-slate)] leading-relaxed pl-[18px]">
        {children}
      </div>
    </div>
  );
}

// ─── Photo Upload Zone ──────────────────────────────────────

function PhotoUploadZone({
  label,
  type,
  disabled,
  isUploading,
  onFiles,
  uploadedPhotos,
}: {
  label: string;
  type: "before" | "after";
  disabled: boolean;
  isUploading: boolean;
  onFiles: (files: FileList) => void;
  uploadedPhotos: UploadedPhoto[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
        <Camera size={12} />
        {label}
      </div>

      {/* Upload trigger */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || isUploading}
        className={cn(
          "w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors min-h-[88px]",
          isUploading
            ? "border-[var(--anna-sage)]/40 bg-[var(--anna-sage-light)]/30 cursor-wait"
            : disabled
              ? "border-[var(--anna-border)] bg-[var(--anna-bg)]/50 cursor-not-allowed opacity-50"
              : "border-[var(--anna-border)] bg-[var(--anna-bg)] hover:border-[var(--anna-sage)]/40 hover:bg-[var(--anna-sage-light)]/20 cursor-pointer"
        )}
      >
        {isUploading ? (
          <>
            <Loader2 size={20} className="text-[var(--anna-sage)] animate-spin" />
            <span className="text-xs text-[var(--anna-sage-dark)] font-medium">
              Uploading...
            </span>
          </>
        ) : (
          <>
            <Upload size={20} className="text-[var(--anna-muted)]" />
            <span className="text-xs text-[var(--anna-muted)]">
              Tap to upload photos
            </span>
            <span className="text-[9px] text-[var(--anna-muted)]/60">
              JPEG, PNG, WebP — max 5MB each
            </span>
          </>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onFiles(e.target.files);
          }
          e.target.value = "";
        }}
        className="hidden"
      />

      {/* Photo thumbnails grid */}
      {uploadedPhotos.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {uploadedPhotos.map((photo, idx) => (
            <div
              key={`${photo.fileUrl}-${idx}`}
              className="aspect-square rounded-xl overflow-hidden border border-[var(--anna-border)] bg-[var(--anna-bg)]"
            >
              <img
                src={photo.fileUrl}
                alt={`${type} work photo ${idx + 1}`}
                className="w-full h-full object-cover"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page Component ──────────────────────────────────

export default function StaffJobViewPage() {
  const params = useParams<{ token: string }>();
  const [data, setData] = useState<ShareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchBooking = useCallback(async () => {
    if (!params.token) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/j/share/${params.token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Failed to load job details");
        setData(null);
        return;
      }
      const json = await res.json();
      setData(json);
      setError(null);
    } catch {
      setError("Network error. Please check your connection.");
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [params.token]);

  // Initial fetch
  useEffect(() => {
    fetchBooking();
  }, [fetchBooking]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(() => {
      fetchBooking();
    }, 30_000);
    return () => clearInterval(interval);
  }, [fetchBooking]);

  // Loading state (initial load)
  if (!data && !error) {
    return <LoadingSkeleton />;
  }

  // Error state
  if (error && !data) {
    return <ErrorState message={error} />;
  }

  // Success state
  if (data) {
    return <JobDetailView data={data} isLoading={isLoading} token={params.token} />;
  }

  return null;
}

// ─── Job Detail View ──────────────────────────────────────

function JobDetailView({
  data,
  isLoading,
  token,
}: {
  data: ShareData;
  isLoading: boolean;
  token: string;
}) {
  const { booking } = data;

  const [uploadedPhotos, setUploadedPhotos] = useState<UploadedPhoto[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [addonsLoading, setAddonsLoading] = useState(true);
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [completionNotes, setCompletionNotes] = useState("");
  const [isCompleting, setIsCompleting] = useState(false);
  const [photoUploading, setPhotoUploading] = useState<string | null>(null);
  const [addonDialogOpen, setAddonDialogOpen] = useState(false);
  const [addonDescription, setAddonDescription] = useState("");
  const [addonAmount, setAddonAmount] = useState("");
  const [isCreatingAddon, setIsCreatingAddon] = useState(false);

  const isAccepted = booking.status === "accepted" || booking.status === "in_progress";
  const isCompleted = booking.status === "completed";
  const isCancelled = booking.status === "cancelled";
  const actionsDisabled = isCompleted || isCancelled;
  const canAddAddon = ["assigned", "accepted", "in_progress"].includes(booking.status);
  const approvedAddonsTotal = addons
    .filter((a) => a.status === "approved")
    .reduce((sum, a) => sum + a.amountCents, 0);

  // ── Fetch addons ──
  const fetchAddons = useCallback(async () => {
    setAddonsLoading(true);
    try {
      const res = await fetch(`/api/j/share/${token}/addons`);
      if (res.ok) {
        const json = await res.json();
        setAddons(json.addons || []);
      }
    } catch {
      // Silently fail — addons are non-critical
    } finally {
      setAddonsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAddons();
  }, [fetchAddons]);

  // ── Photo upload handler ──
  const handlePhotoUpload = useCallback(
    async (type: "before" | "after", files: FileList) => {
      if (files.length === 0) return;
      setPhotoUploading(type);
      try {
        const formData = new FormData();
        formData.append("type", type);
        for (let i = 0; i < files.length; i++) {
          formData.append(`file${i}`, files[i]);
        }

        const res = await fetch(`/api/j/share/${token}/photos`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Upload failed");
        }

        const uploadData = await res.json();
        const newPhotos: UploadedPhoto[] = uploadData.photos.map(
          (p: { fileUrl: string }) => ({ fileUrl: p.fileUrl, type })
        );
        setUploadedPhotos((prev) => [...prev, ...newPhotos]);
        toast.success(
          `${type === "before" ? "Before" : "After"}: ${uploadData.count} photo(s) uploaded`
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to upload photos");
      } finally {
        setPhotoUploading(null);
      }
    },
    [token]
  );

  // ── Laundry Collect + Deliver handlers ──
  // For LAUNDRY tasks, the share page has TWO buttons:
  // 1. "Collect Laundry" — when status=accepted → calls /collect → status becomes 'collected'
  // 2. "Deliver Laundry" — when status=collected → calls /deliver → status becomes 'delivered' + task COMPLETED
  // For non-laundry: standard "Complete Work" button (calls /complete)
  const isLaundry = booking?.category === "LAUNDRY";
  const isCollected = booking?.status === "collected";
  const isDelivered = booking?.status === "delivered";

  // Complete work handler (non-laundry only)
  const handleComplete = async () => {
    setIsCompleting(true);
    try {
      const res = await fetch(`/api/j/share/${token}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completionNotes: completionNotes || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to complete work");
      }
      toast.success("Work completed successfully!");
      setCompleteDialogOpen(false);
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to complete work");
    } finally {
      setIsCompleting(false);
    }
  };

  // Collect laundry handler
  const [isCollecting, setIsCollecting] = useState(false);
  const handleCollect = async () => {
    setIsCollecting(true);
    try {
      const res = await fetch(`/api/j/share/${token}/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: completionNotes || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to collect laundry");
      }
      toast.success("Laundry collected successfully!");
      setCompleteDialogOpen(false);
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to collect laundry");
    } finally {
      setIsCollecting(false);
    }
  };

  // Deliver laundry handler
  const [isDelivering, setIsDelivering] = useState(false);
  const handleDeliver = async () => {
    setIsDelivering(true);
    try {
      const res = await fetch(`/api/j/share/${token}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: completionNotes || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to deliver laundry");
      }
      toast.success("Laundry delivered successfully!");
      setCompleteDialogOpen(false);
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to deliver laundry");
    } finally {
      setIsDelivering(false);
    }
  };

  // ── Create addon handler ──
  const handleCreateAddon = async () => {
    const desc = addonDescription.trim();
    const amountStr = addonAmount.trim();

    if (!desc) {
      toast.error("Please describe the additional work");
      return;
    }

    // Parse amount: allow formats like "15", "15.00", "$15", "15.50"
    const numericAmount = parseFloat(amountStr.replace(/[$,]/g, ""));
    if (isNaN(numericAmount) || numericAmount < 0.5) {
      toast.error("Please enter a valid amount (minimum $0.50)");
      return;
    }

    setIsCreatingAddon(true);
    try {
      const res = await fetch(`/api/j/share/${token}/addons`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: desc,
          amountCents: Math.round(numericAmount * 100),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to add charge");
      }

      toast.success("Additional charge submitted — awaiting customer approval");
      setAddonDialogOpen(false);
      setAddonDescription("");
      setAddonAmount("");
      // Refresh addons list
      await fetchAddons();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to add charge"
      );
    } finally {
      setIsCreatingAddon(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* ── Sticky Header ── */}
      <div className="sticky top-0 z-10 bg-white border-b border-[var(--anna-border)] px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[var(--anna-sage)] flex items-center justify-center">
              <Home size={14} className="text-white" />
            </div>
            <span className="text-sm font-bold text-[var(--anna-slate)]">
              Anna.I
            </span>
          </div>
          <span className="text-xs font-medium text-[var(--anna-muted)]">
            {booking.vendorName}
          </span>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 max-w-lg mx-auto w-full px-4 py-6 space-y-5">
        {/* Job Number — prominent banner at the top (enlarged 200%) */}
        {booking.jobNo && (
          <div className="flex items-center justify-center">
            <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--anna-sage-light)] border border-[var(--anna-sage)]/30">
              <Hash size={20} className="text-[var(--anna-sage-dark)]" />
              <span className="text-xl font-bold font-mono tracking-wider text-[var(--anna-sage-dark)]">
                {booking.jobNo}
              </span>
            </div>
          </div>
        )}

        {/* Category Card */}
        <div className="bg-[var(--anna-bg)] rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CategoryIcon
                category={booking.category as ServiceCategory}
                size={24}
              />
              <div>
                <h1 className="text-lg font-bold text-[var(--anna-slate)]">
                  {getCategoryLabel(booking.category as ServiceCategory)}
                </h1>
                {booking.serviceName && (
                  <p className="text-xs text-[var(--anna-muted)]">
                    {booking.serviceName}
                  </p>
                )}
              </div>
            </div>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-2.5 py-0.5 font-medium",
                STATUS_STYLES[booking.status]
              )}
            >
              {STATUS_LABELS[booking.status] ?? booking.status}
            </Badge>
          </div>
        </div>

        {/* Status Timeline */}
        <div className="bg-[var(--anna-bg)] rounded-2xl p-4">
          <StatusTimeline status={booking.status} />
        </div>

        {/* Amount — with approved addon breakdown */}
        <div className="bg-[var(--anna-sage-light)] rounded-2xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--anna-slate-light)]">Service Amount</span>
            <div className="text-right">
              {(booking.discountCents || 0) > 0 && (
                <div className="text-[10px] text-[var(--anna-muted)] mb-0.5">
                  <span className="line-through">{formatSgd(booking.amountCents + approvedAddonsTotal)}</span>
                  <span className="text-emerald-600 ml-1">−{formatSgd(booking.discountCents)}</span>
                </div>
              )}
              <span className="font-data text-xl font-bold text-[var(--anna-slate)]">
                {formatSgd((booking.finalAmountCents || booking.amountCents) + approvedAddonsTotal)}
              </span>
            </div>
          </div>
          {approvedAddonsTotal > 0 && (
            <div className="border-t border-[var(--anna-border)]/40 pt-2 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                Includes Approved Add-ons
              </p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--anna-slate-light)]">Original service</span>
                <span className="font-data font-medium">{formatSgd(booking.finalAmountCents || booking.amountCents)}</span>
              </div>
              {addons
                .filter((a) => a.status === "approved")
                .map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-xs">
                    <span className="text-[var(--anna-slate-light)] truncate max-w-[60%]">{a.description}</span>
                    <span className="font-data font-medium text-[var(--anna-sage-dark)]">+{formatSgd(a.amountCents)}</span>
                  </div>
                ))}
              <div className="border-t border-[var(--anna-border)]/40 pt-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--anna-slate)]">Total</span>
                <span className="font-data text-sm font-bold text-[var(--anna-sage-dark)]">
                  {formatSgd((booking.finalAmountCents || booking.amountCents) + approvedAddonsTotal)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Details Card */}
        <div className="bg-[var(--anna-bg)] rounded-2xl p-5 space-y-5">
          {/* Scheduled */}
          <InfoRow icon={CalendarDays} label="Scheduled">
            <p className="font-medium">
              {formatDate(booking.scheduledStart)}
            </p>
            {booking.scheduledStart && (
              <span className="text-[var(--anna-muted)]">
                {formatTime(booking.scheduledStart)}
                {booking.scheduledEnd && ` – ${formatTime(booking.scheduledEnd)}`}
              </span>
            )}
          </InfoRow>

          {/* Actual times (if started) */}
          {booking.actualStart && (
            <InfoRow icon={Clock} label="Actual">
              <p className="font-medium">
                {formatDate(booking.actualStart)}
              </p>
              <span className="text-[var(--anna-muted)]">
                {formatTime(booking.actualStart)}
                {booking.actualEnd && ` – ${formatTime(booking.actualEnd)}`}
              </span>
            </InfoRow>
          )}

          {/* Location */}
          {booking.address && (
            <InfoRow icon={MapPin} label="Location">
              <p>
                {booking.address}
                {booking.unitNumber && (
                  <span className="font-medium"> #{booking.unitNumber}</span>
                )}
              </p>
            </InfoRow>
          )}

          {/* Vendor */}
          <InfoRow icon={Briefcase} label="Service Provider">
            <p className="font-medium">{booking.vendorName}</p>
            {booking.vendorPhone && (
              <a
                href={`tel:${booking.vendorPhone}`}
                className="text-[var(--anna-sage-dark)] text-xs flex items-center gap-1 mt-0.5"
              >
                <Phone size={10} />
                {booking.vendorPhone}
              </a>
            )}
          </InfoRow>

          {/* Instructions */}
          {booking.instructions && (
            <InfoRow icon={FileText} label="Instructions">
              <p>{booking.instructions}</p>
            </InfoRow>
          )}
        </div>

        {/* Assigned Staff Card */}
        {booking.staffName ? (
          <div className="bg-gradient-to-br from-[var(--anna-sage-light)]/40 to-[var(--anna-bg)] rounded-2xl p-4 border border-[var(--anna-sage)]/20">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--anna-sage-dark)] mb-3">
              <User size={12} />
              Your Assigned Staff
            </div>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[var(--anna-sage)] flex items-center justify-center">
                <User size={16} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-[var(--anna-slate)]">
                  {booking.staffName}
                </p>
                {booking.staffRole && (
                  <p className="text-[10px] text-[var(--anna-muted)] capitalize">
                    {booking.staffRole}
                  </p>
                )}
              </div>
            </div>
            {booking.staffContact && (
              <a
                href={
                  booking.staffContact.includes("@")
                    ? `mailto:${booking.staffContact}`
                    : `tel:${booking.staffContact}`
                }
                className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-[var(--anna-sage-dark)] bg-white/80 rounded-xl py-2 border border-[var(--anna-sage)]/20 hover:bg-white transition-colors"
              >
                <Phone size={11} />
                {booking.staffContact}
              </a>
            )}
          </div>
        ) : (
          <div className="bg-[var(--anna-bg)] rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--anna-border)]/50 flex items-center justify-center">
              <User size={16} className="text-[var(--anna-muted)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--anna-muted)]">
                Staff not yet assigned
              </p>
              <p className="text-[10px] text-[var(--anna-muted)]">
                The vendor is assigning a staff member
              </p>
            </div>
          </div>
        )}

        {/* ── Additional Charges Section ── */}
        <div className="bg-[var(--anna-bg)] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              <Receipt size={12} />
              Additional Charges
            </div>
            {canAddAddon && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAddonDialogOpen(true)}
                className="text-[11px] text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)] hover:text-[var(--anna-sage-dark)] h-7 px-2 font-medium"
              >
                <Plus size={13} className="mr-1" />
                Add Charge
              </Button>
            )}
          </div>

          {addonsLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 size={14} className="animate-spin text-[var(--anna-muted)]" />
              <span className="text-xs text-[var(--anna-muted)]">Loading...</span>
            </div>
          ) : addons.length === 0 ? (
            <p className="text-xs text-[var(--anna-muted)] py-1">
              No additional charges yet.
            </p>
          ) : (
            <div className="space-y-2">
              {addons.map((addon) => (
                <div
                  key={addon.id}
                  className="bg-white rounded-xl p-3.5 space-y-2 border border-[var(--anna-border)]"
                >
                  <p className="text-sm text-[var(--anna-slate)] leading-relaxed">
                    {addon.description}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="font-data text-sm font-bold text-[var(--anna-slate)]">
                      {formatSgd(addon.amountCents)}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] px-2 py-0.5 font-medium",
                        ADDON_STATUS_STYLES[addon.status]
                      )}
                    >
                      {ADDON_STATUS_LABELS[addon.status] ?? addon.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Customer Attachments (photos/videos from household) ── */}
        {booking.customerAttachments && booking.customerAttachments.length > 0 && (
          <div className="bg-[var(--anna-bg)] rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              <ImageIcon size={12} />
              Customer Attachments
              <span className="ml-1 text-[9px] font-data text-[var(--anna-muted)] bg-white px-1.5 py-0.5 rounded-md border border-[var(--anna-border)]">
                {booking.customerAttachments.length}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {booking.customerAttachments.map((att) =>
                att.fileType === "PHOTO" ? (
                  <a
                    key={att.id}
                    href={att.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative aspect-square rounded-xl overflow-hidden border border-[var(--anna-border)] group hover:border-[var(--anna-sage)]/50 transition-colors"
                  >
                    <img
                      src={att.thumbnailUrl || att.fileUrl}
                      alt={att.fileName}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-1 left-1">
                      <span className="text-[8px] font-bold px-1 py-0 h-4 rounded flex items-center bg-[var(--anna-sage)] text-white">
                        Customer
                      </span>
                    </div>
                  </a>
                ) : (
                  <a
                    key={att.id}
                    href={att.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="aspect-square rounded-xl border border-[var(--anna-border)] bg-white flex flex-col items-center justify-center gap-1 p-2 hover:border-[var(--anna-sage)]/50 transition-colors"
                  >
                    <Film size={18} className="text-[var(--anna-muted)]" />
                    <span className="text-[9px] text-[var(--anna-muted)] text-center line-clamp-2">
                      {att.fileName}
                    </span>
                  </a>
                )
              )}
            </div>
          </div>
        )}

        {/* ── Work Photos Section ── */}
        {!isCancelled && (
          <div className="bg-[var(--anna-bg)] rounded-2xl p-5 space-y-5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              <ImageIcon size={12} />
              Work Photos
            </div>

            {/* Before Work upload zone */}
            <PhotoUploadZone
              label="Before Work"
              type="before"
              disabled={actionsDisabled}
              isUploading={photoUploading === "before"}
              onFiles={(files) => handlePhotoUpload("before", files)}
              uploadedPhotos={uploadedPhotos.filter((p) => p.type === "before")}
            />

            {/* After Work upload zone */}
            <PhotoUploadZone
              label="After Work"
              type="after"
              disabled={actionsDisabled}
              isUploading={photoUploading === "after"}
              onFiles={(files) => handlePhotoUpload("after", files)}
              uploadedPhotos={uploadedPhotos.filter((p) => p.type === "after")}
            />
          </div>
        )}

        {/* ── Action Buttons ── */}
        {/* Non-laundry: standard "Complete Work" button when accepted */}
        {!isLaundry && isAccepted && (
          <Button
            onClick={() => setCompleteDialogOpen(true)}
            disabled={isCompleting}
            className="w-full bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-2xl h-12 text-sm font-semibold"
          >
            {isCompleting ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                Completing...
              </>
            ) : (
              <>
                <CheckCircle size={16} className="mr-2" />
                Complete Work
              </>
            )}
          </Button>
        )}

        {/* Laundry: "Collect Laundry" button when accepted */}
        {isLaundry && isAccepted && (
          <Button
            onClick={() => setCompleteDialogOpen(true)}
            disabled={isCollecting}
            className="w-full bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-2xl h-12 text-sm font-semibold"
          >
            {isCollecting ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                Collecting...
              </>
            ) : (
              <>
                <Package size={16} className="mr-2" />
                Collect Laundry
              </>
            )}
          </Button>
        )}

        {/* Laundry: "Deliver Laundry" button when collected */}
        {isLaundry && isCollected && (
          <Button
            onClick={() => setCompleteDialogOpen(true)}
            disabled={isDelivering}
            className="w-full bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-2xl h-12 text-sm font-semibold"
          >
            {isDelivering ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                Delivering...
              </>
            ) : (
              <>
                <Truck size={16} className="mr-2" />
                Deliver Laundry
              </>
            )}
          </Button>
        )}

        {/* Completed / Delivered confirmation */}
        {(isCompleted || isDelivered) && (
          <div className="bg-[var(--anna-success)]/10 border border-[var(--anna-success)]/20 rounded-2xl p-4 flex items-center gap-3">
            <CheckCircle2 size={20} className="text-[var(--anna-success)]" />
            <div>
              <p className="text-sm font-semibold text-[var(--anna-slate)]">
                {isDelivered ? "Laundry Delivered" : "Work Completed"}
              </p>
              <p className="text-[10px] text-[var(--anna-muted)]">
                {isDelivered
                  ? "The household has been notified. Thank you!"
                  : "The household has been notified. Thank you!"}
              </p>
            </div>
          </div>
        )}

        {/* Collected status (laundry: waiting for delivery) */}
        {isLaundry && isCollected && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
            <Package size={20} className="text-amber-600" />
            <div>
              <p className="text-sm font-semibold text-amber-800">
                Laundry Collected
              </p>
              <p className="text-[10px] text-amber-700">
                Laundry is at the facility. Tap "Deliver Laundry" when returning it to the household.
              </p>
            </div>
          </div>
        )}

        {/* Action Dialog (shared for complete/collect/deliver) */}
        <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
          <DialogContent className="sm:max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-[var(--anna-slate)]">
                {isLaundry && isAccepted ? "Collect Laundry"
                  : isLaundry && isCollected ? "Deliver Laundry"
                  : "Complete Work"}
              </DialogTitle>
              <DialogDescription className="text-[var(--anna-muted)]">
                {isLaundry && isAccepted
                  ? "Confirm that you have collected the laundry from the household. You can optionally add notes."
                  : isLaundry && isCollected
                  ? "Confirm that you have delivered the laundry back to the household. This will mark the job as completed."
                  : "Mark this job as complete. You can optionally add completion notes for the household."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <Textarea
                value={completionNotes}
                onChange={(e) => setCompletionNotes(e.target.value.slice(0, 1000))}
                placeholder="Add any notes about the completed work (optional)..."
                className="min-h-[100px] text-sm resize-none rounded-xl"
                maxLength={1000}
              />
              <p className="text-[10px] text-[var(--anna-muted)] text-right">
                {completionNotes.length}/1000
              </p>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => setCompleteDialogOpen(false)}
                className="rounded-xl flex-1 sm:flex-none"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (isLaundry && isAccepted) handleCollect();
                  else if (isLaundry && isCollected) handleDeliver();
                  else handleComplete();
                }}
                disabled={isCompleting || isCollecting || isDelivering}
                className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl flex-1 sm:flex-none"
              >
                {(isCompleting || isCollecting || isDelivering) ? (
                  <>
                    <Loader2 size={14} className="mr-1.5 animate-spin" />
                    {isLaundry && isAccepted ? "Collecting..." : isLaundry && isCollected ? "Delivering..." : "Completing..."}
                  </>
                ) : (
                  isLaundry && isAccepted ? "Confirm Collection" : isLaundry && isCollected ? "Confirm Delivery" : "Confirm Complete"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Add Additional Charge Dialog ── */}
        <Dialog open={addonDialogOpen} onOpenChange={setAddonDialogOpen}>
          <DialogContent className="sm:max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle className="text-[var(--anna-slate)]">
                Add Additional Charge
              </DialogTitle>
              <DialogDescription className="text-[var(--anna-muted)]">
                Submit an ad-hoc charge for extra work performed. The customer will review and approve or reject this charge.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--anna-slate)]">
                  Description of additional work
                </label>
                <Textarea
                  value={addonDescription}
                  onChange={(e) =>
                    setAddonDescription(e.target.value.slice(0, 500))
                  }
                  placeholder="e.g., Deep cleaning of oven interior, replaced worn-out filter..."
                  className="min-h-[80px] text-sm resize-none rounded-xl"
                  maxLength={500}
                />
                <p className="text-[10px] text-[var(--anna-muted)] text-right">
                  {addonDescription.length}/500
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--anna-slate)] flex items-center gap-1.5">
                  <DollarSign size={12} className="text-[var(--anna-muted)]" />
                  Charge Amount (SGD)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--anna-muted)] font-medium">
                    $
                  </span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={addonAmount}
                    onChange={(e) => setAddonAmount(e.target.value)}
                    placeholder="0.00"
                    className="pl-7 rounded-xl text-sm font-data"
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => {
                  setAddonDialogOpen(false);
                  setAddonDescription("");
                  setAddonAmount("");
                }}
                className="rounded-xl flex-1 sm:flex-none"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateAddon}
                disabled={isCreatingAddon || !addonDescription.trim() || !addonAmount.trim()}
                className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl flex-1 sm:flex-none"
              >
                {isCreatingAddon ? (
                  <>
                    <Loader2 size={14} className="mr-1.5 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Receipt size={14} className="mr-1.5" />
                    Submit Charge
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Auto-refresh indicator */}
        <div className="flex items-center justify-center gap-1.5 text-[10px] text-[var(--anna-muted)]">
          <RefreshCw
            size={10}
            className={cn(isLoading && "animate-spin")}
          />
          Auto-refreshes every 30s
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="mt-auto text-center py-4 border-t border-[var(--anna-border)]">
        <p className="text-[10px] text-[var(--anna-muted)]">
          Powered by Anna.I
        </p>
      </div>
    </div>
  );
}
