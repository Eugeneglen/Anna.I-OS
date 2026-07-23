"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryIcon, getCategoryLabel } from "@/components/anna/category-icon";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatSgd, formatDate, formatTime, type ServiceCategory } from "@/lib/types";
import {
  CalendarDays,
  MapPin,
  Clock,
  CheckCircle,
  Play,
  ThumbsUp,
  User,
  CalendarX,
} from "lucide-react";

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
  instructions?: string | null;
  amountCents: number;
  householdName: string;
  address: string;
  verificationPhotoCount: number;
  verificationPhotos?: { id: string; fileUrl: string; thumbnailUrl?: string | null; uploadedBy: string; isVerified: boolean }[];
  assignedStaff?: { id: string; name: string; role: string } | null;
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
}

interface VendorScheduleProps {
  vendorId: string;
  onSelectBooking: (booking: VendorScheduleItem, vendor: VendorInfo) => void;
  onRequestComplete?: (bookingId: string, photoCount: number, category: string) => void;
}

// ─── Fetcher ─────────────────────────────────────────────

async function fetchVendorSchedule(vendorId: string): Promise<VendorScheduleResponse> {
  const res = await fetch(`/api/vendors/${vendorId}/schedule`);
  if (!res.ok) throw new Error("Failed to fetch vendor schedule");
  return res.json();
}

// ─── Booking status helpers ──────────────────────────────

type BookingTab = "upcoming" | "in_progress" | "completed";

function getBookingTab(status: string): BookingTab {
  if (status === "completed" || status === "cancelled") return "completed";
  if (status === "in_progress") return "in_progress";
  return "upcoming";
}

const BOOKING_STATUS_STYLES: Record<string, string> = {
  assigned: "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)] border-[var(--anna-warning)]/20",
  accepted: "bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  in_progress: "bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  completed: "bg-[var(--anna-success)]/15 text-[var(--anna-success)] border-[var(--anna-success)]/20",
  cancelled: "bg-[var(--anna-muted)]/15 text-[var(--anna-muted)] border-[var(--anna-muted)]/20",
};

const BOOKING_STATUS_LABELS: Record<string, string> = {
  assigned: "Assigned",
  accepted: "Accepted",
  in_progress: "In Progress",
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
      return { label: "Start", icon: Play, action: "start" };
    case "in_progress":
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

  return (
    <div
      onClick={onSelect}
      className={cn(
        "bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4",
        "hover:shadow-sm transition-shadow cursor-pointer"
      )}
    >
      {/* Top row: category + status */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CategoryIcon category={item.category} size={16} />
          <span className="text-sm font-semibold text-[var(--anna-slate)]">
            {getCategoryLabel(item.category)}
          </span>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] px-2 py-0.5 font-medium",
            BOOKING_STATUS_STYLES[item.status]
          )}
        >
          {BOOKING_STATUS_LABELS[item.status] ?? item.status}
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
            {formatSgd(item.amountCents)}
          </span>
          {/* SME: show assigned staff */}
          {vendor.vendorType === "SME" && item.assignedStaff && (
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
    upcoming: { title: "No upcoming bookings", sub: "New assignments will appear here" },
    in_progress: { title: "No active jobs", sub: "Accepted bookings will show here when started" },
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
  const [activeTab, setActiveTab] = useState<BookingTab>("upcoming");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ["vendor-schedule", vendorId],
    queryFn: () => fetchVendorSchedule(vendorId),
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
      const res = await fetch(`/api/vendors/${vendorId}/bookings/${bookingId}`, {
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

  const grouped = useMemo(() => {
    const result = { upcoming: [], in_progress: [], completed: [] } as Record<
      BookingTab,
      VendorScheduleItem[]
    >;
    for (const item of schedule) {
      result[getBookingTab(item.status)].push(item);
    }
    // Sort each group by scheduledStart ascending
    for (const key of Object.keys(result) as BookingTab[]) {
      result[key].sort(
        (a, b) =>
          new Date(a.scheduledStart).getTime() -
          new Date(b.scheduledStart).getTime()
      );
    }
    return result;
  }, [schedule]);

  if (isLoading) return <ScheduleSkeleton />;

  return (
    <div>
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as BookingTab)}
        className="w-full"
      >
        <div className="px-4 lg:px-6">
          <TabsList className="bg-[var(--anna-bg)] rounded-xl p-1 w-full sm:w-auto">
            <TabsTrigger
              value="upcoming"
              className="rounded-lg text-xs data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-white"
            >
              Upcoming
              {grouped.upcoming.length > 0 && (
                <span className="ml-1.5 font-data text-[10px] bg-[var(--anna-sage-light)] data-[state=active]:bg-white/20 px-1.5 py-0.5 rounded-md text-[var(--anna-muted)] data-[state=active]:text-white/80">
                  {grouped.upcoming.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="in_progress"
              className="rounded-lg text-xs data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-white"
            >
              In Progress
              {grouped.in_progress.length > 0 && (
                <span className="ml-1.5 font-data text-[10px] bg-[var(--anna-sage-light)] data-[state=active]:bg-white/20 px-1.5 py-0.5 rounded-md text-[var(--anna-muted)] data-[state=active]:text-white/80">
                  {grouped.in_progress.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="completed"
              className="rounded-lg text-xs data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-white"
            >
              Completed
              {grouped.completed.length > 0 && (
                <span className="ml-1.5 font-data text-[10px] bg-[var(--anna-sage-light)] data-[state=active]:bg-white/20 px-1.5 py-0.5 rounded-md text-[var(--anna-muted)] data-[state=active]:text-white/80">
                  {grouped.completed.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="upcoming" className="mt-4">
          {grouped.upcoming.length === 0 ? (
            <EmptyState tab="upcoming" />
          ) : (
            <div className="space-y-2 px-4 lg:px-6 max-h-96 overflow-y-auto anna-scroll">
              {grouped.upcoming.map((item) => (
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
        </TabsContent>

        <TabsContent value="in_progress" className="mt-4">
          {grouped.in_progress.length === 0 ? (
            <EmptyState tab="in_progress" />
          ) : (
            <div className="space-y-2 px-4 lg:px-6 max-h-96 overflow-y-auto anna-scroll">
              {grouped.in_progress.map((item) => (
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
        </TabsContent>

        <TabsContent value="completed" className="mt-4">
          {grouped.completed.length === 0 ? (
            <EmptyState tab="completed" />
          ) : (
            <div className="space-y-2 px-4 lg:px-6 max-h-96 overflow-y-auto anna-scroll">
              {grouped.completed.map((item) => (
                <BookingCard
                  key={item.id}
                  item={item}
                  vendor={vendor!}
                  onAction={() => {}}
                  onSelect={() => onSelectBooking(item, vendor!)}
                  isPending={false}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}