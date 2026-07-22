"use client";

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bell,
  Search,
  Filter,
  MessageSquare,
  Webhook,
  Mail,
  Loader2,
  Clock,
  CheckCircle2,
  AlertCircle,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  SENT: "bg-blue-50 text-blue-700",
  DELIVERED: "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]",
  READ: "bg-emerald-50 text-emerald-700",
  FAILED: "bg-red-50 text-red-600",
};

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  WHATSAPP: MessageSquare,
  WEB_PUSH: Webhook,
  EMAIL: Mail,
};

const CHANNEL_STYLES: Record<string, string> = {
  WHATSAPP: "text-green-600 bg-green-50",
  WEB_PUSH: "text-purple-600 bg-purple-50",
  EMAIL: "text-blue-600 bg-blue-50",
};

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  TASK_CREATED: "Task Created",
  TASK_DISPATCHED: "Task Dispatched",
  VENDOR_EN_ROUTE: "Vendor En Route",
  VERIFICATION_REQUESTED: "Verification Req",
  VERIFICATION_APPROVED: "Verification OK",
  VERIFICATION_REJECTED: "Verification Rej",
  ESCROW_RELEASED: "Escrow Released",
  DISPUTE_RAISED: "Dispute Raised",
  DISPUTE_RESOLVED: "Dispute Resolved",
  REBOOKING_PROMPT: "Rebooking Prompt",
  AUTONOMY_PROMOTED: "Autonomy Promoted",
  PREDICTIVE_SUGGESTION: "Predictive Suggest",
  SYSTEM_ALERT: "System Alert",
  ANOMALY_VENDOR_LATE: "Anomaly: Vendor Late",
  ANOMALY_TASK_OVERDUE: "Anomaly: Overdue",
  ANOMALY_VERIFICATION_MISSING: "Anomaly: No Verify",
  ANOMALY_RATING_DROP: "Anomaly: Rating Drop",
  ANOMALY_ESCROW_DISPUTED: "Anomaly: Escrow",
};

export default function NotificationsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (channelFilter) params.set("channel", channelFilter);
    if (cursor) params.set("cursor", cursor);
    return params.toString();
  }, [search, statusFilter, channelFilter, cursor]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["ops-notifications", buildParams()],
    queryFn: async () => {
      const qs = buildParams();
      const res = await fetch(`/api/ops/notifications${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const notifications = data?.notifications || [];
  const nextCursor = data?.nextCursor;
  const statusCounts = data?.statusCounts || [];
  const channelCounts = data?.channelCounts || [];

  const activeFilterCount = [statusFilter, channelFilter].filter(Boolean).length;

  function clearFilters() {
    setStatusFilter("");
    setChannelFilter("");
    setCursor(null);
  }

  // Stats for summary
  const failedCount =
    (statusCounts.find((c: { status: string; _count: number }) => c.status === "FAILED")?._count as number) || 0;

  return (
    <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
            Notifications
          </h2>
          <p className="text-sm text-[var(--anna-muted)] mt-0.5">
            <span className="font-data">{notifications.length}</span> shown
            {failedCount > 0 && (
              <span className="ml-2 text-red-600">
                <span className="font-data">{failedCount}</span> failed
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--anna-muted)]"
            />
            <Input
              placeholder="Search title, body..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCursor(null);
              }}
              className="pl-9 w-60 rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "rounded-xl border-[var(--anna-border)] relative",
              showFilters &&
                "bg-[var(--anna-sage-light)] border-[var(--anna-sage)]/30"
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
          onClick={() => {
            setStatusFilter("");
            setCursor(null);
          }}
          className={cn(
            "shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
            !statusFilter
              ? "bg-[var(--anna-sage-dark)] text-white"
              : "bg-[var(--anna-white)] text-[var(--anna-slate-light)] border border-[var(--anna-border)] hover:bg-[var(--anna-sage-light)]/50"
          )}
        >
          All
        </button>
        {statusCounts.map((s: { status: string; _count: number }) => (
          <button
            key={s.status}
            onClick={() => {
              setStatusFilter(s.status);
              setCursor(null);
            }}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5",
              statusFilter === s.status
                ? "bg-[var(--anna-sage-dark)] text-white"
                : "bg-[var(--anna-white)] text-[var(--anna-slate-light)] border border-[var(--anna-border)] hover:bg-[var(--anna-sage-light)]/50"
            )}
          >
            {s.status}
            <span className="font-data text-[10px] opacity-70">
              {s._count}
            </span>
          </button>
        ))}
      </div>

      {/* Expandable Filters */}
      {showFilters && (
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] block mb-1.5">
                Channel
              </label>
              <Select
                value={channelFilter}
                onValueChange={(v) => {
                  setChannelFilter(v === "ALL" ? "" : v);
                  setCursor(null);
                }}
              >
                <SelectTrigger className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm">
                  <SelectValue placeholder="All Channels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Channels</SelectItem>
                  <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                  <SelectItem value="WEB_PUSH">Web Push</SelectItem>
                  <SelectItem value="EMAIL">Email</SelectItem>
                </SelectContent>
              </Select>
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
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-20 w-full rounded-2xl bg-[var(--anna-border)]"
            />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-[var(--anna-sage-light)] flex items-center justify-center mx-auto mb-4">
            <Bell size={24} className="text-[var(--anna-sage-dark)]" />
          </div>
          <p className="text-sm font-medium text-[var(--anna-slate)]">
            No notifications found
          </p>
          <p className="text-xs text-[var(--anna-muted)] mt-1">
            {activeFilterCount > 0
              ? "Try adjusting your filters"
              : "Notifications will appear here once tasks are created"}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)]">
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Household
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Event
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Title
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Channel
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Sent
                  </th>
                </tr>
              </thead>
              <tbody>
                {notifications.map(
                  (n: {
                    id: string;
                    eventType: string;
                    title: string;
                    channel: string;
                    status: string;
                    createdAt: string;
                    sentAt: string;
                    deliveredAt: string;
                    readAt: string;
                    failedAt: string;
                    errorMessage: string | null;
                    household: { id: string; name: string };
                    member: { id: string; name: string } | null;
                    vendor: { id: string; name: string } | null;
                  }) => {
                    const ChannelIcon = CHANNEL_ICONS[n.channel] || Bell;
                    return (
                      <tr
                        key={n.id}
                        className="border-b border-[var(--anna-border)] last:border-0 hover:bg-[var(--anna-sage-light)]/20 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-[var(--anna-slate)] text-xs">
                            {n.household?.name || "—"}
                          </p>
                          {n.member && (
                            <p className="text-[10px] text-[var(--anna-muted)]">
                              {n.member.name}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                            {EVENT_TYPE_LABELS[n.eventType] || n.eventType}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--anna-slate-light)] max-w-xs truncate">
                          {n.title}
                        </td>
                        <td className="px-4 py-3">
                          <div
                            className={cn(
                              "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium",
                              CHANNEL_STYLES[n.channel] || ""
                            )}
                          >
                            <ChannelIcon size={11} />
                            {n.channel}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-[10px]",
                              STATUS_STYLES[n.status] || ""
                            )}
                          >
                            {n.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-[10px] text-[var(--anna-muted)] space-y-0.5">
                            <p className="font-data">
                              {formatDateTime(n.sentAt)}
                            </p>
                            {n.deliveredAt && (
                              <p className="flex items-center gap-1 text-emerald-600">
                                <CheckCircle2 size={9} />
                                Delivered{" "}
                                {formatDateTime(n.deliveredAt)}
                              </p>
                            )}
                            {n.readAt && (
                              <p className="flex items-center gap-1 text-[var(--anna-sage-dark)]">
                                <Eye size={9} />
                                Read {formatDateTime(n.readAt)}
                              </p>
                            )}
                            {n.status === "FAILED" && n.errorMessage && (
                              <p className="flex items-center gap-1 text-red-600" title={n.errorMessage}>
                                <AlertCircle size={9} />
                                Error
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  }
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2">
            {notifications.map(
              (n: {
                id: string;
                eventType: string;
                title: string;
                body: string;
                channel: string;
                status: string;
                createdAt: string;
                sentAt: string;
                errorMessage: string | null;
                household: { id: string; name: string };
              }) => {
                const ChannelIcon = CHANNEL_ICONS[n.channel] || Bell;
                return (
                  <div
                    key={n.id}
                    className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[var(--anna-slate)] truncate">
                          {n.title}
                        </p>
                        <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">
                          {n.household?.name}
                        </p>
                      </div>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] shrink-0 ml-2",
                          STATUS_STYLES[n.status] || ""
                        )}
                      >
                        {n.status}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-[var(--anna-slate-light)] line-clamp-2">
                      {n.body}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <div
                        className={cn(
                          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px]",
                          CHANNEL_STYLES[n.channel] || ""
                        )}
                      >
                        <ChannelIcon size={10} />
                        {n.channel}
                      </div>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                        {EVENT_TYPE_LABELS[n.eventType] || n.eventType}
                      </span>
                      <span className="ml-auto text-[10px] text-[var(--anna-muted)] font-data">
                        {formatDateTime(n.createdAt)}
                      </span>
                    </div>
                  </div>
                );
              }
            )}
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