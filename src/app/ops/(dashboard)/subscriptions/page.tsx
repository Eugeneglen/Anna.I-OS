"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Search,
  CreditCard,
  ChevronRight,
  Crown,
  ArrowUpCircle,
  ArrowDownCircle,
  XCircle,
  RotateCcw,
  AlertCircle,
  Home,
  Mail,
  Phone,
  MapPin,
  Clock,
  TrendingUp,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Types ──
interface SubItem {
  id: string;
  householdId: string;
  tier: "HOME" | "CARE";
  status: "ACTIVE" | "CANCELLED" | "PAST_DUE";
  priceCents: number;
  billingCycleStart: string;
  billingCycleEnd: string | null;
  nextBillingDate: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
  updatedAt: string;
  household: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    postalCode: string | null;
    activeCategories: string;
    createdAt: string;
  };
  stats: {
    completedTasks: number;
    totalSpendCents: number;
  };
}

// ── Constants ──
const TIER_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  HOME: { bg: "bg-[var(--anna-sage-light)]", text: "text-[var(--anna-sage-dark)]", label: "Home" },
  CARE: { bg: "bg-purple-50", text: "text-purple-700", label: "Care" },
};

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof CheckCircle2 }> = {
  ACTIVE: { bg: "bg-emerald-50", text: "text-emerald-700", icon: CheckCircle2 },
  CANCELLED: { bg: "bg-red-50", text: "text-red-600", icon: XCircle },
  PAST_DUE: { bg: "bg-amber-50", text: "text-amber-700", icon: AlertCircle },
};

function formatCents(cents: number) {
  return `SGD $${(cents / 100).toLocaleString("en-SG", { minimumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatRelative(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function formatCategories(catsJson: string | null) {
  if (!catsJson) return [];
  try {
    return JSON.parse(catsJson) as string[];
  } catch {
    return [];
  }
}

export default function SubscriptionsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionDialog, setActionDialog] = useState<{
    open: boolean;
    action: string;
    sub: SubItem | null;
  }>({ open: false, action: "", sub: null });
  const [notesDialog, setNotesDialog] = useState<{
    open: boolean;
    action: string;
    sub: SubItem | null;
  }>({ open: false, action: "", sub: null });
  const [notes, setNotes] = useState("");

  // Fetch subscriptions
  const { data, isLoading } = useQuery({
    queryKey: ["ops-subscriptions", tierFilter, statusFilter, search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (tierFilter) params.set("tier", tierFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (search) params.set("search", search);
      const res = await fetch(`/api/ops/subscriptions?${params}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const subscriptions: SubItem[] = data?.subscriptions || [];
  const summary = data?.summary || {
    totalActive: 0,
    activeHome: 0,
    activeCare: 0,
    totalMrrCents: 0,
  };

  // Detail query
  const selectedSub = selectedId
    ? subscriptions.find((s) => s.id === selectedId) || null
    : null;

  // Action mutation
  const mutation = useMutation({
    mutationFn: async ({ id, action, notes }: { id: string; action: string; notes?: string }) => {
      const res = await fetch(`/api/ops/subscriptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, notes: notes || undefined }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Action failed");
      }
      return res.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["ops-subscriptions"] });
      const actionLabels: Record<string, string> = {
        upgrade_tier: "Upgraded to Care",
        downgrade_tier: "Downgraded to Home",
        cancel: "Subscription cancelled",
        reactivate: "Subscription reactivated",
        mark_past_due: "Marked as past due",
      };
      toast.success(actionLabels[variables.action] || "Action completed");
      setActionDialog({ open: false, action: "", sub: null });
      setSelectedId(null);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  function handleAction(action: string, sub: SubItem, requiresNotes = false) {
    if (requiresNotes) {
      setNotesDialog({ open: true, action, sub });
      setNotes("");
    } else {
      setActionDialog({ open: true, action, sub });
    }
  }

  function submitAction(action: string, sub: SubItem, notesText?: string) {
    mutation.mutate({ id: sub.id, action, notes: notesText });
  }

  const filterPills = [
    { key: null, label: "All" },
    { key: "HOME", label: "Home" },
    { key: "CARE", label: "Care" },
  ];

  const statusPills = [
    { key: null, label: "All" },
    { key: "ACTIVE", label: "Active" },
    { key: "CANCELLED", label: "Cancelled" },
    { key: "PAST_DUE", label: "Past Due" },
  ];

  return (
    <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
            Subscriptions
          </h2>
          <p className="text-sm text-[var(--anna-muted)] mt-0.5">
            <span className="font-data">{subscriptions.length}</span> subscriptions
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--anna-muted)]" />
          <Input
            placeholder="Search household..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 w-64 rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30"
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Total Active</p>
          <p className="text-2xl font-bold font-data text-[var(--anna-slate)] mt-1">{summary.totalActive}</p>
          <p className="text-xs text-[var(--anna-muted)] mt-0.5">
            {summary.activeHome} Home · {summary.activeCare} Care
          </p>
        </div>
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Monthly MRR</p>
          <p className="text-2xl font-bold font-data text-[var(--anna-slate)] mt-1">
            {formatCents(summary.totalMrrCents)}
          </p>
          <p className="text-xs text-emerald-600 mt-0.5 flex items-center gap-1">
            <TrendingUp size={12} /> Recurring revenue
          </p>
        </div>
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Home Tier</p>
          <p className="text-2xl font-bold font-data text-[var(--anna-sage-dark)] mt-1">{summary.activeHome}</p>
          <p className="text-xs text-[var(--anna-muted)] mt-0.5">{formatCents(summary.activeHome * 800)}/mo</p>
        </div>
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Care Tier</p>
          <p className="text-2xl font-bold font-data text-purple-700 mt-1">{summary.activeCare}</p>
          <p className="text-xs text-[var(--anna-muted)] mt-0.5">{formatCents(summary.activeCare * 6800)}/mo</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-1 bg-[var(--anna-bg)] rounded-xl p-0.5">
          {filterPills.map((pill) => (
            <button
              key={pill.key || "all"}
              onClick={() => setTierFilter(pill.key)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-lg transition-colors",
                tierFilter === pill.key
                  ? "bg-[var(--anna-white)] text-[var(--anna-slate)] shadow-sm"
                  : "text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
              )}
            >
              {pill.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-[var(--anna-bg)] rounded-xl p-0.5">
          {statusPills.map((pill) => (
            <button
              key={pill.key || "all-status"}
              onClick={() => setStatusFilter(pill.key)}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-lg transition-colors",
                statusFilter === pill.key
                  ? "bg-[var(--anna-white)] text-[var(--anna-slate)] shadow-sm"
                  : "text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
              )}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl bg-[var(--anna-border)]" />
          ))}
        </div>
      ) : subscriptions.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-14 h-14 rounded-2xl bg-[var(--anna-sage-light)] flex items-center justify-center mx-auto mb-4">
            <CreditCard size={24} className="text-[var(--anna-sage-dark)]" />
          </div>
          <p className="text-sm font-medium text-[var(--anna-slate)]">No subscriptions found</p>
          <p className="text-xs text-[var(--anna-muted)] mt-1">
            {search ? "Try a different search term" : "Subscriptions will appear once households sign up"}
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
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Tier</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Status</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Price</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Next Billing</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Tasks</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Total Spend</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub) => {
                  const tierStyle = TIER_STYLES[sub.tier] || TIER_STYLES.HOME;
                  const statusStyle = STATUS_STYLES[sub.status] || STATUS_STYLES.ACTIVE;
                  const StatusIcon = statusStyle.icon;
                  return (
                    <tr
                      key={sub.id}
                      onClick={() => setSelectedId(sub.id)}
                      className="border-b border-[var(--anna-border)] last:border-0 hover:bg-[var(--anna-sage-light)]/30 cursor-pointer transition-colors group"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[var(--anna-slate)]">{sub.household.name}</span>
                          <ChevronRight size={14} className="text-[var(--anna-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <p className="text-[10px] text-[var(--anna-muted)]">{sub.household.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className={cn("text-[10px] font-medium", tierStyle.bg, tierStyle.text)}>
                          <Crown size={10} className="mr-1" />
                          {tierStyle.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className={cn("text-[10px] font-medium", statusStyle.bg, statusStyle.text)}>
                          <StatusIcon size={10} className="mr-1" />
                          {sub.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-data text-xs text-[var(--anna-slate)]">
                        {formatCents(sub.priceCents)}
                        <span className="text-[var(--anna-muted)]">/mo</span>
                      </td>
                      <td className="px-4 py-3 font-data text-xs text-[var(--anna-muted)]">
                        {formatDate(sub.nextBillingDate)}
                      </td>
                      <td className="px-4 py-3 font-data text-xs text-[var(--anna-slate-light)]">
                        {sub.stats.completedTasks}
                      </td>
                      <td className="px-4 py-3 font-data text-xs text-[var(--anna-slate-light)]">
                        {formatCents(sub.stats.totalSpendCents)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-2">
            {subscriptions.map((sub) => {
              const tierStyle = TIER_STYLES[sub.tier] || TIER_STYLES.HOME;
              const statusStyle = STATUS_STYLES[sub.status] || STATUS_STYLES.ACTIVE;
              const StatusIcon = statusStyle.icon;
              return (
                <div
                  key={sub.id}
                  onClick={() => setSelectedId(sub.id)}
                  className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 hover:shadow-sm transition-all cursor-pointer"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-[var(--anna-slate)]">{sub.household.name}</p>
                      <p className="text-xs text-[var(--anna-muted)] mt-0.5">{sub.household.email}</p>
                    </div>
                    <ChevronRight size={16} className="text-[var(--anna-muted)] shrink-0 mt-0.5" />
                  </div>
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className={cn("text-[10px] font-medium", tierStyle.bg, tierStyle.text)}>
                      <Crown size={10} className="mr-1" />
                      {tierStyle.label}
                    </Badge>
                    <Badge variant="secondary" className={cn("text-[10px] font-medium", statusStyle.bg, statusStyle.text)}>
                      <StatusIcon size={10} className="mr-1" />
                      {sub.status}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="font-data text-[var(--anna-slate)]">{formatCents(sub.priceCents)}/mo</span>
                    <span className="text-[var(--anna-muted)]">{sub.stats.completedTasks} tasks</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Detail Sheet */}
      <Sheet open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto bg-[var(--anna-white)] anna-scroll">
          {selectedSub ? (
            <div className="p-6 space-y-5">
              <SheetHeader>
                <SheetTitle className="text-[var(--anna-slate)]">{selectedSub.household.name}</SheetTitle>
                <SheetDescription className="text-[var(--anna-muted)]">
                  Subscription management
                </SheetDescription>
              </SheetHeader>

              {/* Subscription Info */}
              <div className="bg-gradient-to-br from-[var(--anna-sage-light)] to-[var(--anna-bg)] rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Crown size={20} className="text-[var(--anna-warning)]" />
                    <span className="font-semibold text-[var(--anna-slate)]">
                      Anna.I {TIER_STYLES[selectedSub.tier]?.label || selectedSub.tier}
                    </span>
                  </div>
                  <Badge variant="secondary" className={cn(
                    "text-[10px] font-medium",
                    STATUS_STYLES[selectedSub.status]?.bg,
                    STATUS_STYLES[selectedSub.status]?.text
                  )}>
                    {selectedSub.status}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)]">Price</p>
                    <p className="font-data font-semibold text-[var(--anna-slate)]">
                      {formatCents(selectedSub.priceCents)}
                      <span className="text-[var(--anna-muted)] font-sans font-normal">/mo</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)]">Next Billing</p>
                    <p className="font-data text-[var(--anna-slate-light)]">{formatDate(selectedSub.nextBillingDate)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)]">Cycle Start</p>
                    <p className="font-data text-[var(--anna-slate-light)]">{formatDate(selectedSub.billingCycleStart)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)]">Created</p>
                    <p className="font-data text-[var(--anna-slate-light)]">{formatRelative(selectedSub.createdAt)}</p>
                  </div>
                </div>
              </div>

              {/* Household Contact */}
              <div className="space-y-2 text-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">
                  <Home size={12} className="inline mr-1" />Household
                </p>
                <div className="flex items-center gap-2 text-[var(--anna-slate-light)]">
                  <Mail size={14} className="text-[var(--anna-muted)]" />
                  {selectedSub.household.email}
                </div>
                <div className="flex items-center gap-2 text-[var(--anna-slate-light)]">
                  <Phone size={14} className="text-[var(--anna-muted)]" />
                  {selectedSub.household.phone || "—"}
                </div>
                <div className="flex items-start gap-2 text-[var(--anna-slate-light)]">
                  <MapPin size={14} className="text-[var(--anna-muted)] mt-0.5 shrink-0" />
                  <span className="text-xs">{selectedSub.household.postalCode || "—"}{selectedSub.household.activeCategories ? ` · ${formatCategories(selectedSub.household.activeCategories).length} categories` : ""}</span>
                </div>
              </div>

              {/* Usage Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[var(--anna-bg)] rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)]">Completed Tasks</p>
                  <p className="text-lg font-bold font-data text-[var(--anna-slate)]">{selectedSub.stats.completedTasks}</p>
                </div>
                <div className="bg-[var(--anna-bg)] rounded-xl p-3">
                  <p className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)]">Total Spend</p>
                  <p className="text-lg font-bold font-data text-[var(--anna-slate)]">{formatCents(selectedSub.stats.totalSpendCents)}</p>
                </div>
              </div>

              {/* Quick Actions */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
                  <Clock size={12} className="inline mr-1" />Quick Actions
                </p>
                <div className="space-y-2">
                  {selectedSub.status === "ACTIVE" && selectedSub.tier === "HOME" && (
                    <Button
                      variant="outline"
                      className="w-full justify-start h-10 rounded-xl border-purple-200 text-purple-700 hover:bg-purple-50 hover:border-purple-300 gap-2 text-sm"
                      onClick={() => handleAction("upgrade_tier", selectedSub, true)}
                    >
                      <ArrowUpCircle size={16} />
                      Upgrade to Care ({formatCents(6800)}/mo)
                    </Button>
                  )}
                  {selectedSub.status === "ACTIVE" && selectedSub.tier === "CARE" && (
                    <Button
                      variant="outline"
                      className="w-full justify-start h-10 rounded-xl border-[var(--anna-sage)]/30 text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)] gap-2 text-sm"
                      onClick={() => handleAction("downgrade_tier", selectedSub, true)}
                    >
                      <ArrowDownCircle size={16} />
                      Downgrade to Home ({formatCents(800)}/mo)
                    </Button>
                  )}
                  {selectedSub.status === "ACTIVE" && (
                    <>
                      <Button
                        variant="outline"
                        className="w-full justify-start h-10 rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50 hover:border-amber-300 gap-2 text-sm"
                        onClick={() => handleAction("mark_past_due", selectedSub, true)}
                      >
                        <AlertCircle size={16} />
                        Mark as Past Due
                      </Button>
                      <Button
                        variant="outline"
                        className="w-full justify-start h-10 rounded-xl border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 gap-2 text-sm"
                        onClick={() => handleAction("cancel", selectedSub, true)}
                      >
                        <XCircle size={16} />
                        Cancel Subscription
                      </Button>
                    </>
                  )}
                  {(selectedSub.status === "CANCELLED" || selectedSub.status === "PAST_DUE") && (
                    <Button
                      variant="outline"
                      className="w-full justify-start h-10 rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 gap-2 text-sm"
                      onClick={() => handleAction("reactivate", selectedSub)}
                    >
                      <RotateCcw size={16} />
                      Reactivate Subscription
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-4">
              <Skeleton className="h-6 w-48 bg-[var(--anna-border)]" />
              <Skeleton className="h-32 w-full rounded-2xl bg-[var(--anna-border)]" />
              <Skeleton className="h-40 w-full rounded-2xl bg-[var(--anna-border)]" />
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Confirm Action Dialog (no notes) */}
      <AlertDialog open={actionDialog.open} onOpenChange={(open) => !open && setActionDialog({ open: false, action: "", sub: null })}>
        <AlertDialogContent className="rounded-2xl border-[var(--anna-border)]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[var(--anna-slate)]">
              {actionDialog.action === "reactivate" ? "Reactivate Subscription" : ""}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--anna-muted)]">
              {actionDialog.action === "reactivate" && actionDialog.sub
                ? `Reactivate ${actionDialog.sub.household.name}'s ${TIER_STYLES[actionDialog.sub.tier]?.label} subscription? They will be billed ${formatCents(actionDialog.sub.priceCents)}/mo starting next billing cycle.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => actionDialog.sub && submitAction(actionDialog.action, actionDialog.sub)}
              disabled={mutation.isPending}
              className="rounded-xl bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)]"
            >
              {mutation.isPending ? "Processing..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Notes + Action Dialog (for tier changes, cancel, past due) */}
      <Dialog open={notesDialog.open} onOpenChange={(open) => !open && setNotesDialog({ open: false, action: "", sub: null })}>
        <DialogContent className="rounded-2xl border-[var(--anna-border)]">
          <DialogHeader>
            <DialogTitle className="text-[var(--anna-slate)]">
              {notesDialog.action === "upgrade_tier" && "Upgrade to Care"}
              {notesDialog.action === "downgrade_tier" && "Downgrade to Home"}
              {notesDialog.action === "cancel" && "Cancel Subscription"}
              {notesDialog.action === "mark_past_due" && "Mark Past Due"}
            </DialogTitle>
            <DialogDescription className="text-[var(--anna-muted)]">
              {notesDialog.action === "upgrade_tier" && notesDialog.sub
                ? `Upgrade ${notesDialog.sub.household.name} from Home (${formatCents(800)}) to Care (${formatCents(6800)})/mo`
                : ""}
              {notesDialog.action === "downgrade_tier" && notesDialog.sub
                ? `Downgrade ${notesDialog.sub.household.name} from Care (${formatCents(6800)}) to Home (${formatCents(800)})/mo`
                : ""}
              {notesDialog.action === "cancel" && notesDialog.sub
                ? `Cancel ${notesDialog.sub.household.name}'s ${TIER_STYLES[notesDialog.sub.tier]?.label} subscription. The household will be notified.`
                : ""}
              {notesDialog.action === "mark_past_due" && notesDialog.sub
                ? `Mark ${notesDialog.sub.household.name}'s subscription as past due. This may affect service access.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs font-medium text-[var(--anna-slate)]">Notes (optional)</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for this action..."
              rows={3}
              className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm resize-none"
              maxLength={500}
            />
            <p className="text-[10px] text-[var(--anna-muted)] text-right">{notes.length}/500</p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setNotesDialog({ open: false, action: "", sub: null })}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              onClick={() => notesDialog.sub && submitAction(notesDialog.action, notesDialog.sub, notes)}
              disabled={mutation.isPending}
              className={cn(
                "rounded-xl",
                notesDialog.action === "cancel" || notesDialog.action === "mark_past_due"
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)]"
              )}
            >
              {mutation.isPending ? "Processing..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
