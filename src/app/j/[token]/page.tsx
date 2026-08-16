"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { CategoryIcon, getCategoryLabel } from "@/components/anna/category-icon";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSgd, formatDate, formatTime, type ServiceCategory } from "@/lib/types";
import { cn } from "@/lib/utils";
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
}

interface ShareData {
  booking: ShareBooking;
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

// ─── Job Detail View ──────────────────────────────────────

function JobDetailView({
  data,
  isLoading,
}: {
  data: ShareData;
  isLoading: boolean;
}) {
  const { booking } = data;
  const ref = `#ANN-${booking.id.slice(0, 8).toUpperCase()}`;

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

        {/* Amount */}
        <div className="bg-[var(--anna-sage-light)] rounded-2xl p-4 flex items-center justify-between">
          <span className="text-sm text-[var(--anna-slate-light)]">Service Amount</span>
          <span className="font-data text-xl font-bold text-[var(--anna-slate)]">
            {formatSgd(booking.amountCents)}
          </span>
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

        {/* Auto-refresh indicator */}
        <div className="flex items-center justify-center gap-1.5 text-[10px] text-[var(--anna-muted)]">
          <RefreshCw
            size={10}
            className={cn(isLoading && "animate-spin")}
          />
          Auto-refreshes every 30s
        </div>

        {/* Reference */}
        <p className="text-center text-[11px] text-[var(--anna-muted)] font-mono">
          Reference: {ref}
        </p>
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
    return <JobDetailView data={data} isLoading={isLoading} />;
  }

  return null;
}
