"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CategoryIcon, getCategoryLabel } from "@/components/anna/category-icon";
import { formatSgd, formatTime, type ServiceCategory } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  MapPin,
  Clock,
  User,
  Star,
  FileText,
  Briefcase,
  Users,
  DollarSign,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────

interface CalendarBooking {
  id: string;
  scheduledStart: string;
  scheduledEnd?: string | null;
  status: string;
  completionNotes?: string | null;
  rating?: number | null;
  task: {
    id: string;
    category: string;
    status: string;
    amountCents: number;
    instructions?: string | null;
    household: {
      name: string;
      address: string;
      unitNumber?: string | null;
      postalCode?: string | null;
    };
  };
  assignedStaff?: {
    id: string;
    name: string;
    contact: string;
    role: string;
  } | null;
  addons?: {
    id: string;
    description: string;
    amountCents: number;
    status: string;
  }[];
}

interface CalendarStaff {
  id: string;
  name: string;
  contact: string;
  role: string;
  isActive: boolean;
  jobCount: number;
}

interface CalendarSummary {
  totalBookings: number;
  completedBookings: number;
  cancelledBookings: number;
  activeBookings: number;
  totalRevenueCents: number;
  uniqueStaffCount: number;
}

interface CalendarResponse {
  bookings: CalendarBooking[];
  staff: CalendarStaff[];
  summary: CalendarSummary;
}

// ─── Booking status styles ───────────────────────────────

const STATUS_STYLES: Record<string, { border: string; bg: string; text: string; label: string }> = {
  assigned: { border: "border-l-sky-400", bg: "bg-sky-50/80", text: "text-sky-700", label: "Assigned" },
  accepted: { border: "border-l-blue-500", bg: "bg-blue-50/80", text: "text-blue-700", label: "Accepted" },
  in_progress: { border: "border-l-amber-500", bg: "bg-amber-50/80", text: "text-amber-700", label: "In Progress" },
  completed: { border: "border-l-emerald-500", bg: "bg-emerald-50/80", text: "text-emerald-700", label: "Completed" },
  cancelled: { border: "border-l-gray-300", bg: "bg-gray-50/80", text: "text-gray-500", label: "Cancelled" },
};

// ─── Helpers ──────────────────────────────────────────────

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay(); // 0=Sun, 1=Mon...
}

// Convert Sunday=0 to Monday=0 layout (Mon=0 ... Sun=6)
function toMondayBased(sundayBased: number): number {
  return sundayBased === 0 ? 6 : sundayBased - 1;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getApprovedAddonsTotal(booking: CalendarBooking): number {
  return (booking.addons ?? [])
    .filter((a) => a.status === "approved")
    .reduce((s, a) => s + a.amountCents, 0);
}

// ─── Main Component ──────────────────────────────────────

export default function VendorCalendarPage() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [staffFilter, setStaffFilter] = useState<string>("all");
  const [selectedBooking, setSelectedBooking] = useState<CalendarBooking | null>(
    null
  );
  const [sheetOpen, setSheetOpen] = useState(false);

  // ─── Data fetching ───
  const queryParams = useMemo(() => {
    const params = new URLSearchParams({
      year: year.toString(),
      month: month.toString(),
    });
    if (staffFilter !== "all") params.set("staffId", staffFilter);
    return params.toString();
  }, [year, month, staffFilter]);

  const { data, isLoading } = useQuery<CalendarResponse>({
    queryKey: ["vendor-calendar", queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/vendor/calendar?${queryParams}`);
      if (!res.ok) throw new Error("Failed to load calendar");
      return res.json();
    },
  });

  const bookings = data?.bookings ?? [];
  const staffList = data?.staff ?? [];
  const summary = data?.summary ?? {
    totalBookings: 0,
    completedBookings: 0,
    cancelledBookings: 0,
    activeBookings: 0,
    totalRevenueCents: 0,
    uniqueStaffCount: 0,
  };

  // ─── Calendar grid computation ───
  const { calendarDays, bookingsByDate } = useMemo(() => {
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = toMondayBased(getFirstDayOfMonth(year, month));
    const prevMonthDays =
      month === 1 ? getDaysInMonth(year - 1, 12) : getDaysInMonth(year, month - 1);

    const days: {
      day: number;
      isCurrentMonth: boolean;
      dateStr: string;
    }[] = [];

    for (let i = 0; i < 42; i++) {
      if (i < firstDay) {
        const day = prevMonthDays - firstDay + 1 + i;
        const m = month === 1 ? 12 : month - 1;
        const y = month === 1 ? year - 1 : year;
        days.push({
          day,
          isCurrentMonth: false,
          dateStr: `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        });
      } else if (i - firstDay < daysInMonth) {
        const day = i - firstDay + 1;
        days.push({
          day,
          isCurrentMonth: true,
          dateStr: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        });
      } else {
        const day = i - firstDay - daysInMonth + 1;
        const m = month === 12 ? 1 : month + 1;
        const y = month === 12 ? year + 1 : year;
        days.push({
          day,
          isCurrentMonth: false,
          dateStr: `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        });
      }
    }

    // Group bookings by date string
    const byDate: Record<string, CalendarBooking[]> = {};
    for (const b of bookings) {
      const d = new Date(b.scheduledStart);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(b);
    }

    return { calendarDays: days, bookingsByDate: byDate };
  }, [year, month, bookings]);

  // Today check
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // ─── Navigation handlers ───
  const goToPrevMonth = () => {
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else {
      setMonth((m) => m - 1);
    }
  };
  const goToNextMonth = () => {
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else {
      setMonth((m) => m + 1);
    }
  };
  const goToToday = () => {
    setYear(today.getFullYear());
    setMonth(today.getMonth() + 1);
  };

  // ─── Job detail handlers ───
  const openBookingDetail = (booking: CalendarBooking) => {
    setSelectedBooking(booking);
    setSheetOpen(true);
  };

  return (
    <div className="space-y-5 pb-8 md:pb-4 anna-fade-in">
      {/* ─── Page Header ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--anna-sage)] flex items-center justify-center">
            <CalendarDays size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[var(--anna-slate)]">
              Job Calendar
            </h1>
            <p className="text-xs text-[var(--anna-muted)]">
              Overview of all allocated jobs &amp; staff
            </p>
          </div>
        </div>

        {/* Staff Filter */}
        <div className="flex items-center gap-2">
          <Users size={14} className="text-[var(--anna-muted)]" />
          <Select value={staffFilter} onValueChange={setStaffFilter}>
            <SelectTrigger className="w-[180px] h-9 rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm">
              <SelectValue placeholder="All Staff" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Staff</SelectItem>
              {staffList.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} ({s.jobCount})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ─── Summary Stats ─── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-white)] p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <Briefcase size={14} className="text-[var(--anna-sage)]" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Total Jobs
            </span>
          </div>
          <p className="text-xl font-bold text-[var(--anna-slate)] font-data">
            {summary.totalBookings}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-white)] p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <CheckCircle2 size={14} className="text-emerald-500" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Completed
            </span>
          </div>
          <p className="text-xl font-bold text-emerald-600 font-data">
            {summary.completedBookings}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-white)] p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <Users size={14} className="text-sky-500" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Staff
            </span>
          </div>
          <p className="text-xl font-bold text-[var(--anna-slate)] font-data">
            {summary.uniqueStaffCount}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-white)] p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <DollarSign size={14} className="text-amber-500" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Revenue
            </span>
          </div>
          <p className="text-xl font-bold text-[var(--anna-slate)] font-data">
            {formatSgd(summary.totalRevenueCents)}
          </p>
        </div>
      </div>

      {/* ─── Month Navigation ─── */}
      <div className="flex items-center justify-between rounded-xl border border-[var(--anna-border)] bg-[var(--anna-white)] px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={goToPrevMonth}
          className="rounded-lg hover:bg-[var(--anna-sage-light)] h-8 w-8 p-0"
        >
          <ChevronLeft size={16} />
        </Button>

        <div className="flex items-center gap-2.5">
          <h2 className="text-base font-bold text-[var(--anna-slate)]">
            {MONTH_NAMES[month - 1]} {year}
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={goToToday}
            className="rounded-lg text-[10px] font-semibold uppercase tracking-wider border-[var(--anna-border)] text-[var(--anna-muted)] hover:bg-[var(--anna-sage-light)] hover:text-[var(--anna-slate)] h-7 px-2.5"
          >
            Today
          </Button>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={goToNextMonth}
          className="rounded-lg hover:bg-[var(--anna-sage-light)] h-8 w-8 p-0"
        >
          <ChevronRight size={16} />
        </Button>
      </div>

      {/* ─── Calendar Grid ─── */}
      {isLoading ? (
        <div className="grid grid-cols-7 gap-px rounded-xl border border-[var(--anna-border)] overflow-hidden bg-[var(--anna-border)]">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="bg-[var(--anna-white)] px-2 py-2">
              <Skeleton className="h-3 w-8 mb-2" />
            </div>
          ))}
          {Array.from({ length: 35 }).map((_, i) => (
            <div
              key={`skel-${i}`}
              className="bg-[var(--anna-white)] p-1.5 min-h-[90px]"
            >
              <Skeleton className="h-4 w-5 mb-1.5" />
              <Skeleton className="h-8 w-full rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--anna-border)] overflow-hidden bg-[var(--anna-border)]">
          {/* Day headers */}
          <div className="grid grid-cols-7 bg-[var(--anna-white)]">
            {DAY_LABELS.map((day) => (
              <div
                key={day}
                className="px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] border-b border-[var(--anna-border)]"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar cells */}
          <div className="grid grid-cols-7 gap-px bg-[var(--anna-border)]">
            {calendarDays.map((cell, idx) => {
              const dayBookings = bookingsByDate[cell.dateStr] ?? [];
              const isCurrentDay = cell.dateStr === todayStr;
              const maxVisible = 3;

              return (
                <div
                  key={idx}
                  className={cn(
                    "bg-[var(--anna-white)] p-1.5 min-h-[90px] md:min-h-[110px] flex flex-col",
                    !cell.isCurrentMonth && "bg-[var(--anna-bg)]/50",
                    isCurrentDay && cell.isCurrentMonth && "bg-[var(--anna-sage-light)]/30"
                  )}
                >
                  {/* Day number */}
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={cn(
                        "text-[11px] font-medium leading-none",
                        cell.isCurrentMonth
                          ? isCurrentDay
                            ? "bg-[var(--anna-sage)] text-white rounded-md px-1.5 py-0.5 font-bold"
                            : "text-[var(--anna-slate)]"
                          : "text-[var(--anna-muted)]"
                      )}
                    >
                      {cell.day}
                    </span>
                    {dayBookings.length > 0 && cell.isCurrentMonth && (
                      <span className="text-[9px] font-bold text-[var(--anna-muted)] font-data">
                        {dayBookings.length}
                      </span>
                    )}
                  </div>

                  {/* Job cards */}
                  <div className="flex-1 space-y-0.5 overflow-hidden">
                    {dayBookings.slice(0, maxVisible).map((booking) => {
                      const style =
                        STATUS_STYLES[booking.status] ?? STATUS_STYLES.assigned;
                      const staffName =
                        booking.assignedStaff?.name ?? "Unassigned";

                      return (
                        <button
                          key={booking.id}
                          onClick={() => openBookingDetail(booking)}
                          className={cn(
                            "w-full text-left rounded-md p-1.5 border-l-[3px] transition-all hover:brightness-95 hover:shadow-sm cursor-pointer",
                            style.bg,
                            style.border,
                            booking.status === "cancelled" && "opacity-50"
                          )}
                        >
                          <div className="flex items-center gap-1 mb-0.5">
                            <Clock
                              size={9}
                              className="text-[var(--anna-muted)] shrink-0"
                            />
                            <span className="text-[9px] font-medium text-[var(--anna-slate)] font-data truncate">
                              {formatTime(booking.scheduledStart)}
                            </span>
                          </div>
                          <p className="text-[10px] font-medium text-[var(--anna-slate)] truncate leading-tight">
                            {booking.task.household.name}
                          </p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-[8px] font-medium text-[var(--anna-muted)] truncate">
                              {staffName}
                            </span>
                          </div>
                        </button>
                      );
                    })}

                    {/* +N more overflow */}
                    {dayBookings.length > maxVisible && (
                      <button
                        onClick={() => {
                          openBookingDetail(dayBookings[maxVisible]);
                        }}
                        className="w-full text-center text-[9px] font-medium text-[var(--anna-sage)] hover:text-[var(--anna-sage-dark)] py-0.5 rounded-md hover:bg-[var(--anna-sage-light)]/30 cursor-pointer"
                      >
                        +{dayBookings.length - maxVisible} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Legend ─── */}
      <div className="flex flex-wrap items-center gap-3 px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
          Status:
        </span>
        {Object.entries(STATUS_STYLES).map(([key, val]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div
              className={cn(
                "w-2.5 h-2.5 rounded-sm border-l-[3px]",
                val.bg,
                val.border
              )}
            />
            <span className="text-[10px] text-[var(--anna-muted)]">
              {val.label}
            </span>
          </div>
        ))}
      </div>

      {/* ─── Booking Detail Sheet ─── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg p-0 overflow-y-auto"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Job Details</SheetTitle>
            <SheetDescription>Full details for this booking</SheetDescription>
          </SheetHeader>

          {selectedBooking && (
            <div className="space-y-0">
              {/* Header gradient */}
              <div className="bg-gradient-to-r from-[var(--anna-sage)] to-[var(--anna-sage-dark)] px-5 py-5 text-white">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-white/60 text-xs font-medium uppercase tracking-wider">
                      {(selectedBooking.task.category ?? "").replace(/_/g, " ")}
                    </p>
                    <h3 className="text-lg font-bold mt-1">
                      {selectedBooking.task.household.name}
                    </h3>
                  </div>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-[10px] font-medium border-0",
                      selectedBooking.status === "completed" &&
                        "bg-emerald-500/20 text-emerald-100",
                      selectedBooking.status === "in_progress" &&
                        "bg-amber-500/20 text-amber-100",
                      selectedBooking.status === "cancelled" &&
                        "bg-gray-500/20 text-gray-200",
                      (selectedBooking.status === "assigned" ||
                        selectedBooking.status === "accepted") &&
                        "bg-sky-500/20 text-sky-100"
                    )}
                  >
                    {(STATUS_STYLES[selectedBooking.status]?.label ??
                      selectedBooking.status).toUpperCase()}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-3 text-white/70 text-xs">
                  <div className="flex items-center gap-1">
                    <CalendarDays size={12} />
                    <span>
                      {new Date(
                        selectedBooking.scheduledStart
                      ).toLocaleDateString("en-SG", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock size={12} />
                    <span>
                      {formatTime(selectedBooking.scheduledStart)}
                      {selectedBooking.scheduledEnd &&
                        ` – ${formatTime(selectedBooking.scheduledEnd)}`}
                    </span>
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="px-5 py-4 space-y-5">
                {/* Customer & Location */}
                <section>
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2.5 flex items-center gap-1.5">
                    <MapPin size={12} />
                    Customer &amp; Location
                  </h4>
                  <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)] p-3.5 space-y-2">
                    <div className="flex items-center gap-2.5">
                      <Avatar className="h-9 w-9 rounded-lg">
                        <AvatarFallback className="bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)] text-xs font-bold rounded-lg">
                          {getInitials(selectedBooking.task.household.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-sm font-medium text-[var(--anna-slate)]">
                          {selectedBooking.task.household.name}
                        </p>
                        <p className="text-[11px] text-[var(--anna-muted)]">
                          {selectedBooking.task.household.address}
                          {selectedBooking.task.household.unitNumber
                            ? `, ${selectedBooking.task.household.unitNumber}`
                            : ""}
                          {selectedBooking.task.household.postalCode
                            ? ` ${selectedBooking.task.household.postalCode}`
                            : ""}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                <Separator />

                {/* Job Details */}
                <section>
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2.5 flex items-center gap-1.5">
                    <Briefcase size={12} />
                    Job Details
                  </h4>
                  <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)] p-3.5 space-y-3">
                    {/* Category */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--anna-muted)]">
                        Category
                      </span>
                      <div className="flex items-center gap-1.5">
                        <CategoryIcon
                          category={
                            selectedBooking.task.category as ServiceCategory
                          }
                          size={14}
                        />
                        <span className="text-xs font-medium text-[var(--anna-slate)]">
                          {getCategoryLabel(
                            selectedBooking.task.category as ServiceCategory
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Amount */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--anna-muted)]">
                        Base Amount
                      </span>
                      <span className="text-sm font-bold text-[var(--anna-slate)] font-data">
                        {formatSgd(selectedBooking.task.amountCents)}
                      </span>
                    </div>

                    {/* Add-ons */}
                    {(selectedBooking.addons ?? []).length > 0 && (
                      <>
                        <Separator />
                        <div className="space-y-1.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                            Add-ons
                          </span>
                          {(selectedBooking.addons ?? []).map((addon) => (
                            <div
                              key={addon.id}
                              className="flex items-center justify-between text-xs"
                            >
                              <span className="text-[var(--anna-slate)]">
                                {addon.description}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    "text-[9px] px-1.5 py-0",
                                    addon.status === "approved" &&
                                      "bg-emerald-50 text-emerald-600",
                                    addon.status === "pending" &&
                                      "bg-amber-50 text-amber-600",
                                    addon.status === "rejected" &&
                                      "bg-red-50 text-red-600"
                                  )}
                                >
                                  {addon.status}
                                </Badge>
                                <span className="font-data text-[var(--anna-slate)]">
                                  {formatSgd(addon.amountCents)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                        {getApprovedAddonsTotal(selectedBooking) > 0 && (
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
                              Total with Add-ons
                            </span>
                            <span className="text-sm font-bold text-emerald-600 font-data">
                              {formatSgd(
                                selectedBooking.task.amountCents +
                                  getApprovedAddonsTotal(selectedBooking)
                              )}
                            </span>
                          </div>
                        )}
                      </>
                    )}

                    {/* Instructions */}
                    {selectedBooking.task.instructions && (
                      <>
                        <Separator />
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] block mb-1">
                            Instructions
                          </span>
                          <p className="text-xs text-[var(--anna-slate)] leading-relaxed">
                            {selectedBooking.task.instructions}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </section>

                <Separator />

                {/* Staff Allocated */}
                <section>
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2.5 flex items-center gap-1.5">
                    <User size={12} />
                    Staff Allocated
                  </h4>
                  <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)] p-3.5">
                    {selectedBooking.assignedStaff ? (
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10 rounded-lg">
                          <AvatarFallback className="bg-sky-50 text-sky-600 text-xs font-bold rounded-lg">
                            {getInitials(selectedBooking.assignedStaff.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium text-[var(--anna-slate)]">
                            {selectedBooking.assignedStaff.name}
                          </p>
                          <p className="text-[11px] text-[var(--anna-muted)]">
                            {selectedBooking.assignedStaff.contact}
                          </p>
                          <Badge
                            variant="secondary"
                            className="text-[9px] mt-1 bg-sky-50 text-sky-600"
                          >
                            {selectedBooking.assignedStaff.role}
                          </Badge>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-amber-600">
                        <AlertTriangle size={14} />
                        <span className="text-xs font-medium">
                          No staff assigned yet
                        </span>
                      </div>
                    )}
                  </div>
                </section>

                {/* Completion Notes */}
                {selectedBooking.completionNotes && (
                  <>
                    <Separator />
                    <section>
                      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2.5 flex items-center gap-1.5">
                        <FileText size={12} />
                        Completion Notes
                      </h4>
                      <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)] p-3.5">
                        <p className="text-xs text-[var(--anna-slate)] leading-relaxed whitespace-pre-wrap">
                          {selectedBooking.completionNotes}
                        </p>
                      </div>
                    </section>
                  </>
                )}

                {/* Rating */}
                {selectedBooking.rating && (
                  <>
                    <Separator />
                    <section>
                      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2.5 flex items-center gap-1.5">
                        <Star size={12} />
                        Customer Rating
                      </h4>
                      <div className="flex items-center gap-2">
                        <div className="flex">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              size={18}
                              className={
                                i < selectedBooking.rating!
                                  ? "text-amber-400 fill-amber-400"
                                  : "text-gray-200"
                              }
                            />
                          ))}
                        </div>
                        <span className="text-sm font-bold text-[var(--anna-slate)] font-data">
                          {selectedBooking.rating}/5
                        </span>
                      </div>
                    </section>
                  </>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
