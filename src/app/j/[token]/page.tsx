"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { CategoryIcon, getCategoryLabel } from "@/components/anna/category-icon";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatTime, type ServiceCategory } from "@/lib/types";
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
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────

interface ShareBooking {
  id: string;
  status: string;
  scheduledStart: string;
  scheduledEnd: string | null;
  category: string;
  instructions: string | null;
  taskStatus: string;
  address: string | null;
  vendorName: string;
  vendorLogo: string | null;
  staffName: string | null;
  staffRole: string | null;
}

interface ShareData {
  booking: ShareBooking;
}

// ─── Status styles (same as vendor portal) ────────────────

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

      <div className="flex-1 max-w-lg mx-auto w-full px-4 py-6 space-y-6">
        {/* Category card */}
        <div className="bg-[var(--anna-bg)] rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="w-10 h-10 rounded-xl" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="h-5 w-32" />
        </div>

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
            <Skeleton className="h-4 w-40 h-12" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-36" />
          </div>
        </div>

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
      <div className="text-center py-4 border-t border-[var(--anna-border)]">
        <p className="text-[10px] text-[var(--anna-muted)]">
          Powered by Anna.I
        </p>
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
                size={20}
              />
              <h1 className="text-lg font-bold text-[var(--anna-slate)]">
                {getCategoryLabel(booking.category as ServiceCategory)}
              </h1>
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

        {/* Details Card */}
        <div className="bg-[var(--anna-bg)] rounded-2xl p-5 space-y-5">
          {/* Scheduled */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              <CalendarDays size={12} />
              Scheduled
            </div>
            <p className="text-sm text-[var(--anna-slate)] font-medium">
              {formatDate(booking.scheduledStart)}
              {booking.scheduledEnd && (
                <>
                  {" "}
                  <span className="text-[var(--anna-muted)]">
                    &middot; {formatTime(booking.scheduledStart)}
                    {" – "}
                    {formatTime(booking.scheduledEnd)}
                  </span>
                </>
              )}
            </p>
          </div>

          {/* Location */}
          {booking.address && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                <MapPin size={12} />
                Location
              </div>
              <p className="text-sm text-[var(--anna-slate)]">
                {booking.address}
              </p>
            </div>
          )}

          {/* Instructions */}
          {booking.instructions && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                <FileText size={12} />
                Instructions
              </div>
              <p className="text-sm text-[var(--anna-slate)] leading-relaxed">
                {booking.instructions}
              </p>
            </div>
          )}

          {/* Assigned Staff */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              <User size={12} />
              Assigned Staff
            </div>
            {booking.staffName ? (
              <p className="text-sm text-[var(--anna-slate)] font-medium">
                {booking.staffName}
                {booking.staffRole && (
                  <span className="text-[var(--anna-muted)] font-normal">
                    {" "}
                    &middot;{" "}
                    {booking.staffRole.charAt(0).toUpperCase() +
                      booking.staffRole.slice(1)}
                  </span>
                )}
              </p>
            ) : (
              <p className="text-sm text-[var(--anna-muted)] italic">
                Not yet assigned
              </p>
            )}
          </div>
        </div>

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
