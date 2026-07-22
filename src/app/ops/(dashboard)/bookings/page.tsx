"use client";

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, Search, Filter, Star, Shield, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORIES, ACTIVE_CATEGORIES } from "@/lib/constants";

const BOOKING_STATUS_STYLES: Record<string, string> = {
  assigned: "bg-blue-50 text-blue-700 border-blue-200",
  accepted: "bg-indigo-50 text-indigo-700 border-indigo-200",
  in_progress: "bg-purple-50 text-purple-700 border-purple-200",
  completed: "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/20",
  cancelled: "bg-red-50 text-red-600 border-red-200",
};

const ESCROW_STYLES: Record<string, string> = {
  HELD: "bg-amber-50 text-amber-700",
  RELEASED: "bg-emerald-50 text-emerald-700",
  DISPUTED: "bg-red-50 text-red-600",
  REFUNDED: "bg-gray-100 text-gray-600",
};

function formatCents(cents: number) {
  return `$${(cents / 100).toLocaleString("en-SG", { minimumFractionDigits: 2 })}`;
}

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BookingsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (categoryFilter) params.set("category", categoryFilter);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    if (cursor) params.set("cursor", cursor);
    return params.toString();
  }, [search, statusFilter, categoryFilter, fromDate, toDate, cursor]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["ops-bookings", buildParams()],
    queryFn: async () => {
      const qs = buildParams();
      const res = await fetch(`/api/ops/bookings${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const bookings = data?.bookings || [];
  const nextCursor = data?.nextCursor;
  const statusCounts = data?.statusCounts || [];

  const activeFilterCount = [
    statusFilter,
    categoryFilter,
    fromDate,
    toDate,
  ].filter(Boolean).length;

  function clearFilters() {
    setStatusFilter("");
    setCategoryFilter("");
    setFromDate("");
    setToDate("");
    setCursor(null);
  }

  return (
    <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
            Bookings
          </h2>
          <p className="text-sm text-[var(--anna-muted)] mt-0.5">
            <span className="font-data">{bookings.length}</span> shown
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--anna-muted)]" />
            <Input
              placeholder="Search household, vendor..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCursor(null); }}
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
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <button
          onClick={() => { setStatusFilter(""); setCursor(null); }}
          className={cn(
            "shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            !statusFilter
              ? "bg-[var(--anna-sage-dark)] text-white"
              : "bg-[var(--anna-white)] text-[var(--anna-slate-light)] border border-[var(--anna-border)] hover:bg-[var(--anna-sage-light)]/50"
          )}
        >
          All
        </button>
        {statusCounts.map((s: { status: string; count: number }) => (
          <button
            key={s.status}
            onClick={() => { setStatusFilter(s.status); setCursor(null); }}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5",
              statusFilter === s.status
                ? "bg-[var(--anna-sage-dark)] text-white"
                : "bg-[var(--anna-white)] text-[var(--anna-slate-light)] border border-[var(--anna-border)] hover:bg-[var(--anna-sage-light)]/50"
            )}
          >
            {s.status.replace(/_/g, " ")}
            <span className="font-data text-[10px] opacity-70">{s.count}</span>
          </button>
        ))}
      </div>

      {/* Expandable Filters */}
      {showFilters && (
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] block mb-1.5">
                Category
              </label>
              <select
                value={categoryFilter}
                onChange={(e) => { setCategoryFilter(e.target.value); setCursor(null); }}
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
                onChange={(e) => { setFromDate(e.target.value); setCursor(null); }}
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
                onChange={(e) => { setToDate(e.target.value); setCursor(null); }}
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

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl bg-[var(--anna-border)]" />
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-[var(--anna-sage-light)] flex items-center justify-center mx-auto mb-4">
            <Clock size={24} className="text-[var(--anna-sage-dark)]" />
          </div>
          <p className="text-sm font-medium text-[var(--anna-slate)]">No bookings found</p>
          <p className="text-xs text-[var(--anna-muted)] mt-1">
            {activeFilterCount > 0 ? "Try adjusting your filters" : "Bookings will appear here once tasks are dispatched"}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)]">
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Household</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Category</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Vendor</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Staff</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Scheduled</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Amount</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Escrow</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Rating</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b: Record<string, unknown>) => {
                  const task = b.task as Record<string, unknown>;
                  const household = task?.household as Record<string, unknown>;
                  const vendor = b.vendor as Record<string, unknown>;
                  const staff = b.assignedStaff as Record<string, unknown> | null;
                  const escrow = (b.escrowLedger as Record<string, unknown>[])?.[0];
                  return (
                    <tr key={b.id as string} className="border-b border-[var(--anna-border)] last:border-0 hover:bg-[var(--anna-sage-light)]/20 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-[var(--anna-slate)]">{(household?.name as string) || "—"}</p>
                        <p className="text-[10px] text-[var(--anna-muted)] font-data">{household?.postalCode || ""}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                          {(task?.category as string)?.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-[var(--anna-slate-light)] text-xs">{(vendor?.name as string) || "—"}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--anna-muted)]">
                        {staff?.name ? (
                          <span>{staff.name as string}</span>
                        ) : (
                          <span className="italic">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-data text-xs text-[var(--anna-slate-light)]">
                        {formatDateTime(b.scheduledStart as string)}
                      </td>
                      <td className="px-4 py-3 font-data text-xs text-[var(--anna-slate)]">
                        {formatCents((task?.amountCents as number) || 0)}
                      </td>
                      <td className="px-4 py-3">
                        {escrow ? (
                          <Badge variant="secondary" className={cn("text-[10px]", ESCROW_STYLES[escrow.state as string] || "")}>
                            {(escrow.state as string)?.replace(/_/g, " ")}
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-[var(--anna-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {b.rating ? (
                          <div className="flex items-center gap-1">
                            <Star size={12} className="text-amber-500 fill-amber-500" />
                            <span className="font-data text-xs">{b.rating as number}</span>
                          </div>
                        ) : (
                          <span className="text-[10px] text-[var(--anna-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={cn("text-[10px] font-medium", BOOKING_STATUS_STYLES[b.status as string] || "")}>
                          {(b.status as string)?.replace(/_/g, " ")}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2">
            {bookings.map((b: Record<string, unknown>) => {
              const task = b.task as Record<string, unknown>;
              const household = task?.household as Record<string, unknown>;
              const vendor = b.vendor as Record<string, unknown>;
              const staff = b.assignedStaff as Record<string, unknown> | null;
              const escrow = (b.escrowLedger as Record<string, unknown>[])?.[0];
              return (
                <div key={b.id as string} className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[var(--anna-slate)] truncate">
                        {household?.name as string}
                      </p>
                      <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">
                        {(vendor?.name as string) || "No vendor"}
                        {staff?.name ? ` · ${staff.name as string}` : ""}
                      </p>
                    </div>
                    <Badge variant="outline" className={cn("text-[10px] font-medium shrink-0 ml-2", BOOKING_STATUS_STYLES[b.status as string] || "")}>
                      {(b.status as string)?.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                      {(task?.category as string)?.replace(/_/g, " ")}
                    </span>
                    <span className="font-data text-xs text-[var(--anna-slate)]">{formatCents((task?.amountCents as number) || 0)}</span>
                    {escrow && (
                      <Badge variant="secondary" className={cn("text-[10px]", ESCROW_STYLES[escrow.state as string] || "")}>
                        {(escrow.state as string)?.replace(/_/g, " ")}
                      </Badge>
                    )}
                    {b.rating && (
                      <div className="flex items-center gap-0.5">
                        <Star size={10} className="text-amber-500 fill-amber-500" />
                        <span className="font-data text-[10px]">{b.rating as number}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-[var(--anna-muted)] mt-2 font-data">
                    {formatDateTime(b.scheduledStart as string)}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Load More */}
          {nextCursor && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => setCursor(nextCursor)}
                disabled={isFetching}
                className="rounded-xl border-[var(--anna-border)] text-sm"
              >
                {isFetching ? (
                  <Loader2 size={14} className="mr-1.5 animate-spin" />
                ) : null}
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}