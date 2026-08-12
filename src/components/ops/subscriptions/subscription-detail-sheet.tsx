"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSgd, formatDate, parseCategoryList } from "@/lib/ops-format";
import { TIER_STYLES, STATUS_STYLES, type SubItem } from "./subscription-styles";

// ============================================================
// Anna.I — Ops Subscription Detail Sheet
// ============================================================
// Slide-in panel showing the subscription summary, household
// contact info, usage stats, and quick action buttons.
// Action buttons delegate back to the parent via onAction —
// the parent decides whether to open a confirm or notes dialog.
// ============================================================

/** Page-local relative-time formatter (Today / Xd ago / Xmo ago / Xy ago). */
function formatRelative(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

interface SubscriptionDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: SubItem | null;
  isLoading: boolean;
  onAction: (action: string, sub: SubItem, requiresNotes?: boolean) => void;
}

export function SubscriptionDetailSheet({
  open,
  onOpenChange,
  detail,
  isLoading,
  onAction,
}: SubscriptionDetailSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto bg-[var(--anna-white)] anna-scroll">
        {isLoading ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-6 w-48 bg-[var(--anna-border)]" />
            <Skeleton className="h-32 w-full rounded-2xl bg-[var(--anna-border)]" />
            <Skeleton className="h-40 w-full rounded-2xl bg-[var(--anna-border)]" />
          </div>
        ) : detail ? (
          <div className="p-6 space-y-5">
            <SheetHeader>
              <SheetTitle className="text-[var(--anna-slate)]">{detail.household.name}</SheetTitle>
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
                    Anna.I {TIER_STYLES[detail.tier]?.label || detail.tier}
                  </span>
                </div>
                <Badge variant="secondary" className={cn(
                  "text-[10px] font-medium",
                  STATUS_STYLES[detail.status]?.bg,
                  STATUS_STYLES[detail.status]?.text
                )}>
                  {detail.status}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)]">Price</p>
                  <p className="font-data font-semibold text-[var(--anna-slate)]">
                    {formatSgd(detail.priceCents)}
                    <span className="text-[var(--anna-muted)] font-sans font-normal">/mo</span>
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)]">Next Billing</p>
                  <p className="font-data text-[var(--anna-slate-light)]">{formatDate(detail.nextBillingDate)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)]">Cycle Start</p>
                  <p className="font-data text-[var(--anna-slate-light)]">{formatDate(detail.billingCycleStart)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)]">Created</p>
                  <p className="font-data text-[var(--anna-slate-light)]">{formatRelative(detail.createdAt)}</p>
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
                {detail.household.email}
              </div>
              <div className="flex items-center gap-2 text-[var(--anna-slate-light)]">
                <Phone size={14} className="text-[var(--anna-muted)]" />
                {detail.household.phone || "—"}
              </div>
              <div className="flex items-start gap-2 text-[var(--anna-slate-light)]">
                <MapPin size={14} className="text-[var(--anna-muted)] mt-0.5 shrink-0" />
                <span className="text-xs">{detail.household.postalCode || "—"}{detail.household.activeCategories ? ` · ${parseCategoryList(detail.household.activeCategories).length} categories` : ""}</span>
              </div>
            </div>

            {/* Usage Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[var(--anna-bg)] rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)]">Completed Tasks</p>
                <p className="text-lg font-bold font-data text-[var(--anna-slate)]">{detail.stats.completedTasks}</p>
              </div>
              <div className="bg-[var(--anna-bg)] rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-wider text-[var(--anna-muted)]">Total Spend</p>
                <p className="text-lg font-bold font-data text-[var(--anna-slate)]">{formatSgd(detail.stats.totalSpendCents)}</p>
              </div>
            </div>

            {/* Quick Actions */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
                <Clock size={12} className="inline mr-1" />Quick Actions
              </p>
              <div className="space-y-2">
                {detail.status === "ACTIVE" && detail.tier === "HOME" && (
                  <Button
                    variant="outline"
                    className="w-full justify-start h-10 rounded-xl border-purple-200 text-purple-700 hover:bg-purple-50 hover:border-purple-300 gap-2 text-sm"
                    onClick={() => onAction("upgrade_tier", detail, true)}
                  >
                    <ArrowUpCircle size={16} />
                    Upgrade to Care ({formatSgd(6800)}/mo)
                  </Button>
                )}
                {detail.status === "ACTIVE" && detail.tier === "CARE" && (
                  <Button
                    variant="outline"
                    className="w-full justify-start h-10 rounded-xl border-[var(--anna-sage)]/30 text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)] gap-2 text-sm"
                    onClick={() => onAction("downgrade_tier", detail, true)}
                  >
                    <ArrowDownCircle size={16} />
                    Downgrade to Home ({formatSgd(800)}/mo)
                  </Button>
                )}
                {detail.status === "ACTIVE" && (
                  <>
                    <Button
                      variant="outline"
                      className="w-full justify-start h-10 rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50 hover:border-amber-300 gap-2 text-sm"
                      onClick={() => onAction("mark_past_due", detail, true)}
                    >
                      <AlertCircle size={16} />
                      Mark as Past Due
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full justify-start h-10 rounded-xl border-red-200 text-red-600 hover:bg-red-50 hover:border-red-300 gap-2 text-sm"
                      onClick={() => onAction("cancel", detail, true)}
                    >
                      <XCircle size={16} />
                      Cancel Subscription
                    </Button>
                  </>
                )}
                {(detail.status === "CANCELLED" || detail.status === "PAST_DUE") && (
                  <Button
                    variant="outline"
                    className="w-full justify-start h-10 rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-300 gap-2 text-sm"
                    onClick={() => onAction("reactivate", detail)}
                  >
                    <RotateCcw size={16} />
                    Reactivate Subscription
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
