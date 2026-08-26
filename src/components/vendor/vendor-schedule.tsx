"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryIcon, getCategoryLabel } from "@/components/anna/category-icon";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatSgd, formatDate, formatTime, type ServiceCategory } from "@/lib/types";
import { vendorFetch } from "@/lib/vendor-fetch";
import {
  CalendarDays,
  MapPin,
  Clock,
  CheckCircle,
  Play,
  ThumbsUp,
  User,
  CalendarX,
  AlertTriangle,
  ShieldCheck,
  Wallet,
  Search,
  Filter,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ACTIVE_CATEGORIES } from "@/lib/constants";
import { JobNoBadge } from "@/components/shared/job-no-badge";

// ─── Types ───────────────────────────────────────────────

export interface VendorScheduleItem {
  id: string;
  status: string;
  scheduledStart: string;
  scheduledEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  acceptedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  rating?: number | null;
  ratingComment?: string | null;
  completionNotes?: string | null;
  category: ServiceCategory;
  jobNo?: string | null;
  instructions?: string | null;
  amountCents: number;
  householdName: string;
  address: string;
  verificationPhotoCount: number;
  verificationPhotos?: { id: string; fileUrl: string; thumbnailUrl?: string | null; uploadedBy: string; isVerified: boolean }[];
  assignedStaff?: { id: string; name: string; role: string; contact?: string | null } | null;
  // Approved addon total for dynamic amount calculation
  approvedAddonsTotal: number;
  addons?: { id: string; description: string; amountCents: number; status: string }[];
  // Customer-uploaded attachments from household
  customerAttachments?: { id: string; fileType: string; fileUrl: string; thumbnailUrl?: string | null; fileName: string }[];
  // Task-level status and escrow for dispute awareness
  taskStatus?: string | null;
  taskDisputedAt?: string | null;
  escrow?: {
    id: string;
    state: string;
    amountCents: number;
    refundCents?: number;
    commissionCents: number;
    vendorPayoutCents: number;
    disputeReason?: string | null;
    disputeResolution?: string | null;
    disputeResolvedAt?: string | null;
  } | null;
  // All escrow entries (base + add-ons) for full refund/remaining computation
  escrowEntries?: {
    id: string;
    state: string;
    amountCents: number;
    refundCents?: number;
    commissionCents: number;
    vendorPayoutCents: number;
    disputeReason?: string | null;
    disputeResolution?: string | null;
    disputeResolvedAt?: string | null;
  }[];
}

interface VendorInfo {
  id: string;
  name: string;
  vendorType: string;
  staffCount: number;
}

interface VendorScheduleResponse {
  vendor: VendorInfo;
  schedule: VendorScheduleItem[];
  total: number;
  statusCounts: { status: string; count: number }[];
}

interface VendorScheduleProps {
  vendorId: string;
  onSelectBooking: (booking: VendorScheduleItem, vendor: VendorInfo) => void;
  onRequestComplete?: (bookingId: string, photoCount: number, category: string) => void;
}

// ─── Fetcher ─────────────────────────────────────────────

async function fetchVendorSchedule(vendorId: string, queryParams?: string): Promise<VendorScheduleResponse> {
  const res = await vendorFetch(`/api/vendors/${vendorId}/schedule${queryParams ? `?${queryParams}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch vendor schedule");
  return res.json();
}

// ─── Booking status helpers ──────────────────────────────

type BookingTab = "all" | "upcoming" | "completed";

function getBookingTab(status: string): BookingTab {
  if (status === "completed" || status === "delivered" || status === "cancelled") return "completed";
  return "upcoming";
}

const BOOKING_STATUS_STYLES: Record<string, string> = {
  assigned: "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)] border-[var(--anna-warning)]/20",
  accepted: "bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  collected: "bg-amber-50 text-amber-700 border-amber-200",
  delivered: "bg-[var(--anna-success)]/15 text-[var(--anna-success)] border-[var(--anna-success)]/20",
  completed: "bg-[var(--anna-success)]/15 text-[var(--anna-success)] border-[var(--anna-success)]/20",
  cancelled: "bg-[var(--anna-muted)]/15 text-[var(--anna-muted)] border-[var(--anna-muted)]/20",
};

const BOOKING_STATUS_LABELS: Record<string, string> = {
  assigned: "Assigned",
  accepted: "Accepted",
  collected: "Collected",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

function getActionForStatus(status: string): {
  label: string;
  icon: React.ElementType;
  action: string;
} | null {
  switch (status) {
    case "assigned":
      return { label: "Accept", icon: ThumbsUp, action: "accept" };
    case "accepted":
      return { label: "Complete", icon: CheckCircle, action: "complete" };
    default:
      return null;
  }
}

// ─── Booking Card ────────────────────────────────────────

function BookingCard({
  item,
  vendor,
  onAction,
  onSelect,
  isPending,
}: {
  item: VendorScheduleItem;
  vendor: VendorInfo;
  onAction: (bookingId: string, action: string) => void;
  onSelect: () => void;
  isPending: boolean;
}) {
  const action = getActionForStatus(item.status);
  const isDisputed = item.taskStatus === "DISPUTED" || item.escrow?.state === "DISPUTED";

  return (
    <div
      onClick={onSelect}
      className={cn(
        "bg-[var(--anna-white)] rounded-2xl border p-4",
        "hover:shadow-sm transition-shadow cursor-pointer",
        isDisputed
          ? "border-[var(--anna-error)]/40 ring-1 ring-[var(--anna-error)]/15"
          : "border-[var(--anna-border)]"
      )}
    >
      {/* Dispute alert banner */}
      {isDisputed && (
        <div className="mb-3 rounded-xl bg-gradient-to-r from-[var(--anna-error)]/8 to-[var(--anna-error)]/3 border border-[var(--anna-error)]/15 px-3 py-2 flex items-center gap-2">
          <AlertTriangle size={14} className="text-[var(--anna-error)] shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-[var(--anna-error)]">Dispute Raised</p>
            <p className="text-[10px] text-[var(--anna-error)]/70 truncate">
              {item.escrow?.disputeReason || "The household has raised a dispute. Ops team is reviewing."}
            </p>
          </div>
        </div>
      )}

      {/* Escrow resolution info (when dispute is resolved) */}
      {item.escrow?.state === "REFUNDED" && (
        <div className="mb-3 rounded-xl bg-gradient-to-r from-[var(--anna-warning)]/8 to-[var(--anna-warning)]/3 border border-[var(--anna-warning)]/15 px-3 py-2 flex items-center gap-2">
          <Wallet size={14} className="text-[var(--anna-warning)] shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-[var(--anna-warning)]">Refund Issued</p>
            <p className="text-[10px] text-[var(--anna-warning)]/70 truncate">
              {item.escrow?.disputeResolution || "Escrow has been refunded to the household."}
            </p>
          </div>
        </div>
      )}

      {/* Escrow released info */}
      {item.escrow?.state === "RELEASED" && item.status === "completed" && (
        <div className="mb-3 rounded-xl bg-gradient-to-r from-[var(--anna-sage)]/8 to-[var(--anna-sage)]/3 border border-[var(--anna-sage)]/15 px-3 py-2 flex items-center gap-2">
          <ShieldCheck size={14} className="text-[var(--anna-sage-dark)] shrink-0" />
          <p className="text-[11px] font-medium text-[var(--anna-sage-dark)]">
            Payment released — {formatSgd(item.escrow.vendorPayoutCents)} payout
          </p>
        </div>
      )}

      {/* Top row: job no + category + status */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <JobNoBadge jobNo={item.jobNo} size="sm" />
          <CategoryIcon category={item.category} size={16} />
          <span className="text-sm font-semibold text-[var(--anna-slate)]">
            {getCategoryLabel(item.category)}
          </span>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] px-2 py-0.5 font-medium",
            isDisputed
              ? "bg-[var(--anna-error)]/15 text-[var(--anna-error)] border-[var(--anna-error)]/20"
              : BOOKING_STATUS_STYLES[item.status]
          )}
        >
          {isDisputed ? "Disputed" : BOOKING_STATUS_LABELS[item.status] ?? item.status}
        </Badge>
      </div>

      {/* Household info */}
      <div className="flex items-center gap-1.5 text-xs text-[var(--anna-muted)] mb-1">
        <User size={12} />
        <span className="font-medium text-[var(--anna-slate)]">{item.householdName}</span>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-[var(--anna-muted)] mb-3">
        <MapPin size={12} />
        <span>{item.address}</span>
      </div>

      {/* Schedule */}
      <div className="flex items-center gap-4 text-xs text-[var(--anna-muted)] mb-3">
        <div className="flex items-center gap-1.5">
          <CalendarDays size={12} />
          <span>{formatDate(item.scheduledStart)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock size={12} />
          <span>{formatTime(item.scheduledStart)}</span>
          {item.scheduledEnd && (
            <span>&ndash; {formatTime(item.scheduledEnd)}</span>
          )}
        </div>
      </div>

      {/* Bottom row: amount + staff + action */}
      <div className="flex items-center justify-between pt-3 border-t border-[var(--anna-border)]">
        <div className="flex items-center gap-3">
          <span className="font-data text-sm font-bold text-[var(--anna-slate)]">
            {formatSgd(item.amountCents + (item.approvedAddonsTotal || 0))}
          </span>
          {(item.approvedAddonsTotal || 0) > 0 && (
            <span className="text-[10px] text-[var(--anna-sage-dark)] bg-emerald-100 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded-md">
              incl. {formatSgd(item.approvedAddonsTotal || 0)} addons
            </span>
          )}
          {/* Show assigned staff for all vendor types */}
          {item.assignedStaff && (
            <span className="text-[10px] text-[var(--anna-muted)] bg-[var(--anna-sage-light)] px-2 py-0.5 rounded-md flex items-center gap-1">
              <User size={10} />
              {item.assignedStaff.name}
            </span>
          )}
        </div>

        {action && (
          <Button
            size="sm"
            variant="default"
            disabled={isPending}
            onClick={(e) => {
              e.stopPropagation();
              onAction(item.id, action.action);
            }}
            className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl h-8 text-xs font-semibold"
          >
            <action.icon size={13} className="mr-1.5" />
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Empty state ─────────────────────────────────────────

function EmptyState({ tab }: { tab: string }) {
  const messages: Record<string, { title: string; sub: string }> = {
    upcoming: { title: "No upcoming jobs", sub: "New assignments will appear here" },
    completed: { title: "No completed jobs yet", sub: "Finished work will appear here" },
  };
  const msg = messages[tab] ?? messages.upcoming;

  return (
    <div className="flex flex-col items-center justify-center py-16 text-[var(--anna-muted)] px-4">
      <CalendarX size={32} className="mb-3 opacity-30" />
      <p className="text-sm font-medium">{msg.title}</p>
      <p className="text-xs mt-1">{msg.sub}</p>
    </div>
  );
}

// ─── Loading skeleton ────────────────────────────────────

function ScheduleSkeleton() {
  return (
    <div className="space-y-3 p-4 lg:p-6">
      <Skeleton className="h-10 w-48 rounded-xl bg-[var(--anna-border)]" />
      {[1, 2, 3].map((i) => (
        <Skeleton
          key={i}
          className="h-32 w-full rounded-2xl bg-[var(--anna-border)]"
        />
      ))}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────

export function VendorSchedule({ vendorId, onSelectBooking, onRequestComplete }: VendorScheduleProps) {
  const [activeTab, setActiveTab] = useState<BookingTab>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Build query params for API
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (categoryFilter) params.set("category", categoryFilter);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    return params.toString();
  }, [search, statusFilter, categoryFilter, fromDate, toDate]);

  const { data, isLoading } = useQuery({
    queryKey: ["vendor-schedule", vendorId, queryParams],
    queryFn: () => fetchVendorSchedule(vendorId, queryParams),
    enabled: !!vendorId,
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      bookingId,
      action,
      completionNotes,
    }: {
      bookingId: string;
      action: string;
      completionNotes?: string;
    }) => {
      const body: Record<string, string> = { action };
      if (completionNotes) body.completionNotes = completionNotes;
      const res = await vendorFetch(`/api/vendors/${vendorId}/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Status update failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Booking updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["vendor-schedule", vendorId] });
      queryClient.invalidateQueries({ queryKey: ["vendor-earnings", vendorId] });
    },
    onError: () => {
      toast({ title: "Failed to update booking", variant: "destructive" });
    },
  });

  const vendor = data?.vendor;
  const schedule = data?.schedule ?? [];
  const statusCounts = data?.statusCounts ?? [];

  // Client-side grouping based on active tab
  const displayed = useMemo(() => {
    if (activeTab === "all") return schedule;
    return schedule.filter((item) => getBookingTab(item.status) === activeTab);
  }, [schedule, activeTab]);

  // Count active filters for badge
  const activeFilterCount = [categoryFilter, fromDate, toDate].filter(Boolean).length;

  function clearFilters() {
    setCategoryFilter("");
    setFromDate("");
    setToDate("");
  }

  // When status pill is clicked, sync with statusFilter
  const handleStatusPill = (status: string) => {
    if (status === statusFilter) {
      setStatusFilter("");
    } else {
      setStatusFilter(status);
    }
  };

  if (isLoading) return <ScheduleSkeleton />;

  return (
    <div>
      {/* Header with search + filters */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h3 className="text-base font-bold text-[var(--anna-slate)]">
            All Bookings
          </h3>
          <p className="text-xs text-[var(--anna-muted)] mt-0.5">
            <span className="font-data">{displayed.length}</span> shown
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--anna-muted)]" />
            <Input
              placeholder="Search household, address..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-60 rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "rounded-xl border-[var(--anna-border)] relative",
              showFilters && "bg-[var(--anna-sage-light)] border-[var(--anna-sage)]/30"
            )}
          >
            <Filter size={14} className="mr-1.5" />
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-1.5 w-4 h-4 rounded-full bg-[var(--anna-sage-dark)] text-white text-[10px] font-data flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Status Pills */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 mb-3">
        {(["all", ...statusCounts.map((s) => s.status)] as string[]).map((s) => (
          <button
            key={s}
            onClick={() => handleStatusPill(s === "all" ? "" : s)}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5",
              (s === "all" && !statusFilter) || statusFilter === s
                ? "bg-[var(--anna-sage-dark)] text-white"
                : "bg-[var(--anna-white)] text-[var(--anna-slate-light)] border border-[var(--anna-border)] hover:bg-[var(--anna-sage-light)]/50"
            )}
          >
            {s === "all" ? "All" : s.replace(/_/g, " ")}
            {s !== "all" && statusCounts.find((sc) => sc.status === s) && (
              <span className="font-data text-[10px] opacity-70">
                {statusCounts.find((sc) => sc.status === s)!.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Expandable Filters */}
      {showFilters && (
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 space-y-3 mb-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] block mb-1.5">
                Category
              </label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm px-3 py-2 text-[var(--anna-slate)] focus:outline-none focus:ring-1 focus:ring-[var(--anna-sage)]/30"
              >
                <option value="">All Categories</option>
                {ACTIVE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] block mb-1.5">
                From
              </label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] block mb-1.5">
                To
              </label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm"
              />
            </div>
          </div>
          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="text-xs text-[var(--anna-sage-dark)] hover:underline"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Booking list */}
      {displayed.length === 0 ? (
        <EmptyState tab={activeTab} />
      ) : (
        <div className="space-y-2 px-4 lg:px-6 max-h-96 overflow-y-auto anna-scroll">
          {displayed.map((item) => (
            <BookingCard
              key={item.id}
              item={item}
              vendor={vendor!}
              onAction={(bid, a) => {
                if (a === "complete" && onRequestComplete) {
                  onRequestComplete(bid, item.verificationPhotoCount, item.category);
                } else {
                  updateMutation.mutate({ bookingId: bid, action: a });
                }
              }}
              onSelect={() => onSelectBooking(item, vendor!)}
              isPending={updateMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}