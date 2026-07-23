"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useVendorUser } from "@/app/vendor/(portal)/layout";
import { VendorSchedule, type VendorScheduleItem, type VendorInfo } from "@/components/vendor/vendor-schedule";
import { VendorEarnings } from "@/components/vendor/vendor-earnings";
import { VendorTaskDetail } from "@/components/vendor/vendor-task-detail";
import { CompleteWorkDialog } from "@/components/vendor/complete-work-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatSgd, formatDate, formatTime, type ServiceCategory } from "@/lib/types";
import { CategoryIcon, getCategoryLabel } from "@/components/anna/category-icon";
import {
  CalendarDays,
  Wallet,
  Briefcase,
  Clock,
  MapPin,
  User,
  CheckCircle2,
  Star,
  TrendingUp,
  ArrowDownCircle,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────

interface DashboardStats {
  todayJobs: number;
  upcoming: number;
  active: number;
  totalCompleted: number;
  avgRating: string | null;
  weekEarnings: number;
  monthEarnings: number;
  totalEarnings: number;
  pendingPayout: number;
}

interface TodayJob {
  id: string;
  status: string;
  category: ServiceCategory;
  amountCents: number;
  instructions?: string | null;
  scheduledStart: string;
  scheduledEnd?: string | null;
  householdName: string;
  address: string;
  unitNumber?: string | null;
  assignedStaff?: { id: string; name: string } | null;
}

interface DashboardResponse {
  stats: DashboardStats;
  todayJobs: TodayJob[];
}

// ─── Stat Card ──────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  iconColor,
  iconBg,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
}) {
  return (
    <div className="bg-[var(--anna-white)] rounded-2xl p-4 border border-[var(--anna-border)]">
      <div className="flex items-center gap-2 mb-2">
        <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", iconBg)}>
          <Icon size={16} className={iconColor} />
        </div>
        <span className="text-xs text-[var(--anna-muted)] font-medium">{label}</span>
      </div>
      <p className="font-data text-xl font-bold text-[var(--anna-slate)]">{value}</p>
      {sub && <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Today's Job Card ──────────────────────────────────

const JOB_STATUS_STYLES: Record<string, string> = {
  assigned: "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)] border-[var(--anna-warning)]/20",
  accepted: "bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  in_progress: "bg-[var(--anna-sage)]/15 text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
};

const JOB_STATUS_LABELS: Record<string, string> = {
  assigned: "Assigned",
  accepted: "Accepted",
  in_progress: "In Progress",
};

function TodayJobCard({
  job,
  vendor,
  onClick,
}: {
  job: TodayJob;
  vendor: VendorInfo;
  onClick: () => void;
}) {
  const time = formatTime(job.scheduledStart);
  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4",
        "hover:shadow-sm transition-shadow cursor-pointer"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <CategoryIcon category={job.category} size={16} />
          <span className="text-sm font-semibold text-[var(--anna-slate)]">
            {getCategoryLabel(job.category)}
          </span>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] px-2 py-0.5 font-medium",
            JOB_STATUS_STYLES[job.status] ?? ""
          )}
        >
          {JOB_STATUS_LABELS[job.status] ?? job.status}
        </Badge>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-[var(--anna-muted)] mb-1">
        <User size={12} />
        <span className="font-medium text-[var(--anna-slate)]">{job.householdName}</span>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-[var(--anna-muted)] mb-2">
        <MapPin size={12} />
        <span>{job.address}{job.unitNumber ? ` #${job.unitNumber}` : ""}</span>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-[var(--anna-muted)]">
          <Clock size={12} />
          <span>{time}</span>
        </div>
        <span className="font-data text-sm font-bold text-[var(--anna-slate)]">
          {formatSgd(job.amountCents)}
        </span>
      </div>
    </div>
  );
}

// ─── Loading Skeletons ──────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl bg-[var(--anna-border)]" />
        ))}
      </div>
      <Skeleton className="h-8 w-32 rounded-xl bg-[var(--anna-border)]" />
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-24 rounded-2xl bg-[var(--anna-border)]" />
      ))}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────

export default function VendorSchedulePage() {
  const user = useVendorUser();
  const vendorId = user?.id ?? "";
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"overview" | "schedule" | "earnings">("overview");
  const [selectedBooking, setSelectedBooking] = useState<VendorScheduleItem | null>(null);
  const [selectedVendor, setSelectedVendor] = useState<VendorInfo | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Complete Work dialog state
  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [completeBookingId, setCompleteBookingId] = useState("");
  const [completePhotoCount, setCompletePhotoCount] = useState(0);
  const [completeCategory, setCompleteCategory] = useState("");

  // Fetch dashboard stats
  const { data: dashData, isLoading: dashLoading } = useQuery<DashboardResponse>({
    queryKey: ["vendor-dashboard", vendorId],
    queryFn: async () => {
      const res = await fetch("/api/vendor/dashboard");
      if (!res.ok) throw new Error("Failed to fetch dashboard");
      return res.json();
    },
    enabled: !!vendorId,
  });

  // Handle booking action
  const actionMutation = useMutation({
    mutationFn: async ({ bookingId, action, completionNotes }: { bookingId: string; action: string; completionNotes?: string }) => {
      const body: Record<string, string> = { action };
      if (completionNotes) body.completionNotes = completionNotes;
      const res = await fetch(`/api/vendors/${vendorId}/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Action failed");
      return res.json();
    },
    onSuccess: (_, variables) => {
      const actionToStatus: Record<string, string> = {
        accept: "accepted",
        start: "in_progress",
        complete: "completed",
        reject: "cancelled",
      };
      setSelectedBooking((prev) => {
        if (!prev || prev.id !== variables.bookingId) return prev;
        return { ...prev, status: actionToStatus[variables.action] ?? prev.status };
      });
      queryClient.invalidateQueries({ queryKey: ["vendor-dashboard", vendorId] });
      queryClient.invalidateQueries({ queryKey: ["vendor-schedule", vendorId] });
      queryClient.invalidateQueries({ queryKey: ["vendor-earnings", vendorId] });
      toast({ title: "Booking updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update booking", variant: "destructive" });
    },
  });

  const vendorInfo: VendorInfo = {
    id: vendorId,
    name: user?.name ?? "",
    vendorType: user?.vendorType ?? "MICRO",
    staffCount: 0,
  };

  const handleSelectBooking = useCallback(
    (booking: VendorScheduleItem, vendor: VendorInfo) => {
      setSelectedBooking(booking);
      setSelectedVendor(vendor);
      setDetailOpen(true);
    },
    []
  );

  const handleCloseDetail = useCallback(() => {
    setDetailOpen(false);
  }, []);

  // Open complete dialog
  const openCompleteDialog = useCallback(
    (bookingId: string, photoCount: number, category: string) => {
      setCompleteBookingId(bookingId);
      setCompletePhotoCount(photoCount);
      setCompleteCategory(category);
      setCompleteDialogOpen(true);
    },
    []
  );

  // Handle complete work submission
  const handleCompleteSubmit = useCallback(
    (bookingId: string, completionNotes: string) => {
      actionMutation.mutate(
        { bookingId, action: "complete", completionNotes: completionNotes || undefined },
        {
          onSuccess: () => {
            setCompleteDialogOpen(false);
          },
        }
      );
    },
    [actionMutation]
  );

  if (!vendorId) return null;

  return (
    <div className="pb-20 md:pb-0">
      {/* Page header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
            Schedule & Jobs
          </h1>
          <p className="text-sm text-[var(--anna-muted)] mt-0.5">
            Manage your upcoming and active bookings
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "overview" | "schedule" | "earnings")}
        className="w-full"
      >
        <TabsList className="bg-[var(--anna-bg)] rounded-xl p-1 w-full sm:w-auto">
          <TabsTrigger
            value="overview"
            className="rounded-lg text-xs data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-white"
          >
            <Zap size={14} className="mr-1.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="schedule"
            className="rounded-lg text-xs data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-white"
          >
            <CalendarDays size={14} className="mr-1.5" />
            All Bookings
          </TabsTrigger>
          <TabsTrigger
            value="earnings"
            className="rounded-lg text-xs data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-white"
          >
            <Wallet size={14} className="mr-1.5" />
            Earnings
          </TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ── */}
        <TabsContent value="overview" className="mt-6">
          {dashLoading ? (
            <DashboardSkeleton />
          ) : dashData ? (
            <div className="space-y-6">
              {/* Stats grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard
                  icon={Briefcase}
                  iconColor="text-[var(--anna-sage-dark)]"
                  iconBg="bg-[var(--anna-sage-light)]"
                  label="Today&apos;s Jobs"
                  value={String(dashData.stats.todayJobs)}
                  sub={dashData.stats.active > 0 ? `${dashData.stats.active} active now` : undefined}
                />
                <StatCard
                  icon={CalendarDays}
                  iconColor="text-[var(--anna-warning)]"
                  iconBg="bg-[var(--anna-warning)]/10"
                  label="Upcoming"
                  value={String(dashData.stats.upcoming)}
                />
                <StatCard
                  icon={Wallet}
                  iconColor="text-[var(--anna-sage-dark)]"
                  iconBg="bg-[var(--anna-sage-light)]"
                  label="This Month"
                  value={formatSgd(dashData.stats.monthEarnings)}
                  sub={dashData.stats.weekEarnings > 0 ? `+${formatSgd(dashData.stats.weekEarnings)} this week` : undefined}
                />
                <StatCard
                  icon={Star}
                  iconColor="text-[var(--anna-warning)]"
                  iconBg="bg-[var(--anna-warning)]/10"
                  label="Avg Rating"
                  value={dashData.stats.avgRating ?? "—"}
                  sub={dashData.stats.avgRating ? "out of 5.0" : "No ratings yet"}
                />
              </div>

              {/* Secondary stats row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-[var(--anna-white)] rounded-2xl p-3 border border-[var(--anna-border)] text-center">
                  <p className="text-[10px] text-[var(--anna-muted)] font-medium mb-1">Total Earned</p>
                  <p className="font-data text-sm font-bold text-[var(--anna-slate)]">
                    {formatSgd(dashData.stats.totalEarnings)}
                  </p>
                </div>
                <div className="bg-[var(--anna-white)] rounded-2xl p-3 border border-[var(--anna-border)] text-center">
                  <p className="text-[10px] text-[var(--anna-muted)] font-medium mb-1">Pending Payout</p>
                  <p className="font-data text-sm font-bold text-[var(--anna-warning)]">
                    {formatSgd(dashData.stats.pendingPayout)}
                  </p>
                </div>
                <div className="bg-[var(--anna-white)] rounded-2xl p-3 border border-[var(--anna-border)] text-center">
                  <p className="text-[10px] text-[var(--anna-muted)] font-medium mb-1">Jobs Completed</p>
                  <p className="font-data text-sm font-bold text-[var(--anna-slate)]">
                    {dashData.stats.totalCompleted}
                  </p>
                </div>
              </div>

              {/* Today's jobs */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Clock size={14} className="text-[var(--anna-sage-dark)]" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-slate)]">
                    Today&apos;s Schedule
                  </h3>
                  {dashData.todayJobs.length > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                      {dashData.todayJobs.length}
                    </Badge>
                  )}
                </div>

                {dashData.todayJobs.length === 0 ? (
                  <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-8 text-center">
                    <CalendarDays size={24} className="mx-auto mb-2 text-[var(--anna-muted)] opacity-30" />
                    <p className="text-sm text-[var(--anna-muted)]">No jobs scheduled for today</p>
                    <p className="text-xs text-[var(--anna-muted)] mt-0.5">
                      New assignments will appear here
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {dashData.todayJobs.map((job) => (
                      <TodayJobCard
                        key={job.id}
                        job={job}
                        vendor={vendorInfo}
                        onClick={() => {
                          // Navigate to schedule tab with this job selected
                          // Convert TodayJob to VendorScheduleItem
                          setSelectedBooking({
                            id: job.id,
                            status: job.status,
                            scheduledStart: job.scheduledStart,
                            scheduledEnd: job.scheduledEnd,
                            actualStart: null,
                            actualEnd: null,
                            acceptedAt: null,
                            completedAt: null,
                            cancelledAt: null,
                            rating: null,
                            ratingComment: null,
                            category: job.category,
                            instructions: job.instructions,
                            amountCents: job.amountCents,
                            householdName: job.householdName,
                            address: job.address,
                            verificationPhotoCount: 0,
                            assignedStaff: job.assignedStaff
                              ? { id: job.assignedStaff.id, name: job.assignedStaff.name, role: "staff" }
                              : null,
                          });
                          setSelectedVendor(vendorInfo);
                          setDetailOpen(true);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </TabsContent>

        {/* ── Schedule Tab (existing component) ── */}
        <TabsContent value="schedule" className="mt-6">
          <VendorSchedule
            vendorId={vendorId}
            onSelectBooking={handleSelectBooking}
            onRequestComplete={openCompleteDialog}
          />
        </TabsContent>

        {/* ── Earnings Tab (existing component) ── */}
        <TabsContent value="earnings" className="mt-6">
          <VendorEarnings vendorId={vendorId} />
        </TabsContent>
      </Tabs>

      {/* Task detail panel */}
      <VendorTaskDetail
        booking={selectedBooking}
        vendor={selectedVendor}
        open={detailOpen}
        onClose={handleCloseDetail}
        onAction={(bookingId, action, payload) => {
          if (action === "complete") {
            const photoCount = selectedBooking?.verificationPhotos?.length ?? selectedBooking?.verificationPhotoCount ?? 0;
            openCompleteDialog(bookingId, photoCount, selectedBooking?.category ?? "");
          } else {
            actionMutation.mutate({ bookingId, action });
          }
        }}
        isActionPending={actionMutation.isPending}
        vendorId={vendorId}
      />

      {/* Complete Work Dialog */}
      <CompleteWorkDialog
        open={completeDialogOpen}
        onOpenChange={setCompleteDialogOpen}
        bookingId={completeBookingId}
        vendorId={vendorId}
        taskCategory={completeCategory}
        photoCount={completePhotoCount}
        onSubmit={handleCompleteSubmit}
        isSubmitting={actionMutation.isPending}
      />
    </div>
  );
}
