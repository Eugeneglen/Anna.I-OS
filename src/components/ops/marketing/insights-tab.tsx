"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  TrendingUp,
  Users,
  DollarSign,
  Zap,
  Lightbulb,
  ChevronRight,
  ArrowRight,
  Sparkles,
  Search,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// Anna.I — Ops Marketing Insights Tab
// ============================================================
// Behaviour-driven KPI cards + AI recommendation cards.
//
// Drill-down UX:
//   • "Total Households"     → dialog listing ALL households
//   • "Avg Orders / HH"      → dialog listing households sorted by
//                              order count (descending)
//   • "Avg Spend / HH"       → dialog listing households sorted by
//                              total spend (descending)
//   • "Never Ordered"        → opens the legacy NeverOrderedDialog
//                              (households with 0 completed orders)
//   • RFM Segments           → click any segment bar to open a
//                              dialog listing the households in
//                              that RFM segment
//   • Churn Risk             → click any risk card to open a dialog
//                              listing households at that risk level
//   • Lifecycle Stages       → click any stage bar to open a dialog
//                              listing households in that stage
//   • Lapse Analysis         → click any "No order in N days" row
//                              to open a dialog listing households
//                              that haven't ordered in that window
//   • Cross-Sell Opportunities → click any opportunity row to open
//                              a dialog listing the eligible
//                              households (and the categories they
//                              already use vs. the cross-sell target)
//
// Fix 15 — AI recommendation cards still carry a "Take Action"
// button whose behavior depends on the recommendation type.
// ============================================================

// ── Types ──

interface NeverOrderedHousehold {
  id: string;
  name: string;
}

/** Per-household behaviour row surfaced by the behaviour API.
 * Used by every contextual drill-down dialog. */
interface HouseholdBehaviourRow {
  id: string;
  name: string;
  totalOrders: number;
  totalSpendCents: number;
  avgOrderValueCents: number;
  rfmSegment: string;
  churnRisk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  lifecycleStage: "NEW" | "ACTIVE" | "REGULAR" | "DECLINING" | "LAPSED" | "REACTIVATED";
  lastOrderAt: string | null;
  daysSinceLastOrder: number | null;
  categoriesUsed: string[];
}

interface CrossSellOpportunity {
  from: string;
  to: string;
  eligibleHouseholds: number;
  /** Additive — the household IDs that make up `eligibleHouseholds`.
   * Used to drive the Cross-Sell drill-down dialog. */
  householdIds: string[];
}

interface BehaviourData {
  overview: {
    totalHouseholds: number;
    activeCustomers: number;
    lapsedCustomers: number;
    newCustomers: number;
    neverOrdered: number;
    avgOrdersPerHousehold: number;
    avgSpendPerHouseholdCents: number;
    totalRevenueCents: number;
  };
  // Fix 14 — additive field. Optional so older cached responses
  // (without this field) don't break the type.
  neverOrderedHouseholds?: NeverOrderedHousehold[];
  /** Additive — per-household behaviour rows used to drive the
   * contextual drill-down dialogs. */
  households?: HouseholdBehaviourRow[];
  rfmDistribution: Record<string, number>;
  lapseAnalysis: Record<string, number>;
  categoryUsage: Record<string, number>;
  crossSellOpportunities: CrossSellOpportunity[];
  churnRisk: Record<string, number>;
  lifecycleStages: Record<string, number>;
  insights: Array<{
    type: string;
    title: string;
    detail: string;
    householdIds: string[];
    priority: string;
  }>;
}

// ── Tab + action callbacks (wired by the parent marketing page) ──

type MarketingTab = "insights" | "segments" | "campaigns";

interface InsightsTabProps {
  /** Fix 15 — Switch the parent marketing page to a different tab. */
  onNavigateTab?: (tab: MarketingTab) => void;
  /**
   * Fix 15 — Open the shared Create-Campaign dialog (rendered at the
   * marketing-page level) with an optional preselected segment ID.
   */
  onOpenCreateCampaign?: (segmentId?: string) => void;
}

// ── Helpers ──

function formatSgd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatLastOrder(iso: string | null, daysSince: number | null): string {
  if (!iso || daysSince === null) return "Never ordered";
  if (daysSince === 0) return "Today";
  if (daysSince === 1) return "Yesterday";
  if (daysSince < 30) return `${daysSince} days ago`;
  const months = Math.floor(daysSince / 30);
  if (months < 12) return `${months} month${months > 1 ? "s" : ""} ago`;
  const years = Math.floor(daysSince / 365);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

// ── Drill-down metric ──
//
// Each dialog passes a `metric` enum that controls which per-row
// value is highlighted (and which sort order is applied).

type DrillMetric = "orders" | "spend" | "lastOrder" | "categories" | "summary";

type DrillAccent = "amber" | "emerald" | "red" | "orange" | "sage";

function sortHouseholdsByMetric(
  households: HouseholdBehaviourRow[],
  metric: DrillMetric,
): HouseholdBehaviourRow[] {
  const copy = [...households];
  switch (metric) {
    case "orders":
      // Descending by order count, ties broken by spend descending
      return copy.sort((a, b) => b.totalOrders - a.totalOrders || b.totalSpendCents - a.totalSpendCents);
    case "spend":
      // Descending by spend, ties broken by order count
      return copy.sort((a, b) => b.totalSpendCents - a.totalSpendCents || b.totalOrders - a.totalOrders);
    case "lastOrder":
      // Most recent first; never-ordered households go last
      return copy.sort((a, b) => {
        if (a.daysSinceLastOrder === null && b.daysSinceLastOrder === null) return 0;
        if (a.daysSinceLastOrder === null) return 1;
        if (b.daysSinceLastOrder === null) return -1;
        return a.daysSinceLastOrder - b.daysSinceLastOrder;
      });
    case "categories":
      // Most categories first (more cross-sell eligible)
      return copy.sort((a, b) => b.categoriesUsed.length - a.categoriesUsed.length);
    case "summary":
    default:
      // Default: most orders first
      return copy.sort((a, b) => b.totalOrders - a.totalOrders);
  }
}

const ACCENT_STYLES: Record<DrillAccent, { iconBg: string; iconColor: string }> = {
  amber: { iconBg: "bg-amber-50", iconColor: "text-amber-600" },
  emerald: { iconBg: "bg-emerald-50", iconColor: "text-emerald-600" },
  red: { iconBg: "bg-red-50", iconColor: "text-red-600" },
  orange: { iconBg: "bg-orange-50", iconColor: "text-orange-600" },
  sage: { iconBg: "bg-[var(--anna-sage-light)]", iconColor: "text-[var(--anna-sage-dark)]" },
};

function DistributionBar({
  items,
  max,
  onItemClick,
}: {
  items: Array<[string, number]>;
  max: number;
  onItemClick?: (key: string) => void;
}) {
  if (items.length === 0 || max === 0) return <p className="text-xs text-[var(--anna-muted)]">No data</p>;
  return (
    <div className="space-y-1.5">
      {items.map(([key, count]) => {
        const pct = max > 0 ? (count / max) * 100 : 0;
        const clickable = !!onItemClick && count > 0;
        return (
          <button
            key={key}
            type="button"
            disabled={!clickable}
            onClick={clickable ? () => onItemClick(key) : undefined}
            className={cn(
              "flex items-center gap-2 w-full text-left group",
              clickable && "cursor-pointer hover:bg-[var(--anna-bg)] -mx-1 px-1 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--anna-sage)] focus-visible:ring-offset-1",
              !clickable && "cursor-default",
            )}
            aria-label={`${key}: ${count} household${count === 1 ? "" : "s"}${clickable ? ". Click to view households." : ""}`}
          >
            <span className="text-xs text-[var(--anna-slate-light)] w-32 shrink-0 truncate">{key}</span>
            <div className="flex-1 h-5 rounded-md bg-[var(--anna-bg)] overflow-hidden">
              <div className="h-full bg-[var(--anna-sage)] rounded-md transition-all group-hover:bg-[var(--anna-sage-dark)]" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] font-data text-[var(--anna-muted)] w-12 text-right shrink-0">{count}</span>
            {clickable && (
              <ChevronRight
                size={12}
                className="text-[var(--anna-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── KPI Card (clickable wrapper) ──

interface KpiCardProps {
  label: string;
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  value: string | number;
  sublabel?: string;
  onClick?: () => void;
  /** Optional title/tooltip for accessibility. */
  title?: string;
  /** Render as a Next.js Link instead of a button (preferred for navigation). */
  href?: string;
}

function KpiCard({ label, icon: Icon, iconBg, iconColor, value, sublabel, onClick, title, href }: KpiCardProps) {
  const interactive = !!(onClick || href);

  const body = (
    <>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">{label}</span>
        <div className="flex items-center gap-1">
          {interactive && (
            <ChevronRight
              size={12}
              className="text-[var(--anna-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
            />
          )}
          <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", iconBg, iconColor)}>
            <Icon size={16} />
          </div>
        </div>
      </div>
      <p className="text-lg font-bold font-data text-[var(--anna-slate)]">{value}</p>
      {sublabel && <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">{sublabel}</p>}
    </>
  );

  const interactiveClasses = interactive
    ? "group cursor-pointer transition-all hover:border-[var(--anna-sage)] hover:shadow-sm hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--anna-sage)] focus-visible:ring-offset-1"
    : "";

  if (href) {
    return (
      <Link
        href={href}
        title={title}
        aria-label={`${label}: ${value}${sublabel ? ` (${sublabel})` : ""}. Open households page.`}
        className={cn(
          "bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 block",
          interactiveClasses,
        )}
      >
        {body}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={!interactive}
      aria-label={`${label}: ${value}${sublabel ? ` (${sublabel})` : ""}${title ? `. ${title}` : ""}`}
      className={cn(
        "bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 text-left w-full",
        interactiveClasses,
        !interactive && "cursor-default",
      )}
    >
      {body}
    </button>
  );
}

// ── Never-Ordered Drill-down Dialog ──

function NeverOrderedDialog({
  open,
  onOpenChange,
  households,
  total,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  households: NeverOrderedHousehold[];
  total: number;
}) {
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? households.filter((h) => h.name.toLowerCase().includes(query.trim().toLowerCase()))
    : households;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] rounded-2xl border-[var(--anna-border)] bg-[var(--anna-white)] anna-scroll">
        <DialogHeader>
          <DialogTitle className="text-lg text-[var(--anna-slate)] flex items-center gap-2">
            <AlertCircle size={16} className="text-amber-600" />
            Never-Ordered Households
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--anna-muted)]">
            {total} household{total === 1 ? "" : "s"} registered with 0 completed orders.
            {households.length < total && ` Showing the first ${households.length}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--anna-muted)]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="w-full h-9 rounded-xl border border-[var(--anna-border)] pl-8 pr-3 text-xs bg-[var(--anna-white)] focus:outline-none focus:border-[var(--anna-sage)]"
          />
        </div>

        <div className="max-h-96 overflow-y-auto anna-scroll -mx-1 px-1">
          {filtered.length === 0 ? (
            <p className="text-center text-xs text-[var(--anna-muted)] py-6">
              {query.trim() ? "No households match that name." : "No never-ordered households."}
            </p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((h) => (
                <li
                  key={h.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl hover:bg-[var(--anna-bg)] transition-colors"
                >
                  <span className="text-sm text-[var(--anna-slate)] truncate">{h.name || "Unnamed household"}</span>
                  <span className="text-[10px] font-data text-[var(--anna-muted)] truncate max-w-[120px]">{h.id.slice(-8)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-[var(--anna-border)]">
          <p className="text-[10px] text-[var(--anna-muted)]">
            Showing {filtered.length} of {total} household{total === 1 ? "" : "s"}.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-8 text-xs"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Generic Household Drill-down Dialog ──
//
// Reusable dialog for every contextual drill-down on the Insights
// tab. Each row shows the household name + the metric relevant to
// the calling context (orders / spend / last order / categories /
// summary). A search box lets the user filter by name.

interface HouseholdDrillDownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  households: HouseholdBehaviourRow[];
  total?: number;
  metric?: DrillMetric;
  accent?: DrillAccent;
  icon?: LucideIcon;
}

function HouseholdDrillDownDialog({
  open,
  onOpenChange,
  title,
  description,
  households,
  total,
  metric = "summary",
  accent = "sage",
  icon: Icon,
}: HouseholdDrillDownDialogProps) {
  const [query, setQuery] = useState("");

  // Reset the search box whenever the dialog is closed — prevents
  // a stale filter from hiding rows the next time the dialog opens
  // for a different context.
  // (state persists across opens because the component stays mounted;
  // we intentionally reset on `open` transitions to false.)
  const sorted = useMemo(
    () => sortHouseholdsByMetric(households, metric),
    [households, metric],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((h) => h.name.toLowerCase().includes(q));
  }, [sorted, query]);

  const totalCount = total ?? households.length;
  const accentStyle = ACCENT_STYLES[accent];
  const IconComp = Icon ?? Users;

  function renderMetric(h: HouseholdBehaviourRow) {
    switch (metric) {
      case "orders":
        return (
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-data font-bold text-[var(--anna-slate)]">{h.totalOrders}</span>
            <span className="text-[10px] text-[var(--anna-muted)]">order{h.totalOrders === 1 ? "" : "s"}</span>
            {h.totalOrders > 0 && (
              <span className="text-[10px] text-[var(--anna-muted)]">• {formatSgd(h.totalSpendCents)} total</span>
            )}
          </div>
        );
      case "spend":
        return (
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-data font-bold text-[var(--anna-slate)]">{formatSgd(h.totalSpendCents)}</span>
            <span className="text-[10px] text-[var(--anna-muted)]">
              • {h.totalOrders} order{h.totalOrders === 1 ? "" : "s"}
            </span>
          </div>
        );
      case "lastOrder":
        return (
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-medium text-[var(--anna-slate)]">
              {formatLastOrder(h.lastOrderAt, h.daysSinceLastOrder)}
            </span>
            {h.totalOrders > 0 && (
              <span className="text-[10px] text-[var(--anna-muted)]">• {h.totalOrders} order{h.totalOrders === 1 ? "" : "s"}</span>
            )}
          </div>
        );
      case "categories":
        return (
          <div className="flex flex-wrap items-center gap-1">
            {h.categoriesUsed.length === 0 ? (
              <span className="text-[10px] text-[var(--anna-muted)] italic">No categories yet</span>
            ) : (
              h.categoriesUsed.map((c) => (
                <span
                  key={c}
                  className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)] uppercase tracking-wider"
                >
                  {c}
                </span>
              ))
            )}
          </div>
        );
      case "summary":
      default:
        return (
          <div className="flex items-baseline gap-1.5 flex-wrap">
            <span className="text-xs font-data text-[var(--anna-slate)]">
              {h.totalOrders} order{h.totalOrders === 1 ? "" : "s"}
            </span>
            <span className="text-[10px] text-[var(--anna-muted)]">•</span>
            <span className="text-xs font-data text-[var(--anna-slate)]">{formatSgd(h.totalSpendCents)}</span>
            <span className="text-[10px] text-[var(--anna-muted)]">•</span>
            <span className="text-[10px] text-[var(--anna-muted)]">
              {formatLastOrder(h.lastOrderAt, h.daysSinceLastOrder)}
            </span>
          </div>
        );
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setQuery("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[80vh] rounded-2xl border-[var(--anna-border)] bg-[var(--anna-white)] anna-scroll">
        <DialogHeader>
          <DialogTitle className="text-lg text-[var(--anna-slate)] flex items-center gap-2">
            <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center", accentStyle.iconBg, accentStyle.iconColor)}>
              <IconComp size={14} />
            </div>
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="text-xs text-[var(--anna-muted)]">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>

        {households.length > 0 && (
          <div className="relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--anna-muted)]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name…"
              className="w-full h-9 rounded-xl border border-[var(--anna-border)] pl-8 pr-3 text-xs bg-[var(--anna-white)] focus:outline-none focus:border-[var(--anna-sage)]"
            />
          </div>
        )}

        <div className="max-h-96 overflow-y-auto anna-scroll -mx-1 px-1">
          {households.length === 0 ? (
            <p className="text-center text-xs text-[var(--anna-muted)] py-6">
              No households match this filter.
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-xs text-[var(--anna-muted)] py-6">
              No households match that name.
            </p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((h) => (
                <li
                  key={h.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl hover:bg-[var(--anna-bg)] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm text-[var(--anna-slate)] truncate">{h.name || "Unnamed household"}</span>
                      {/* Secondary chips for context: RFM + churn risk + lifecycle */}
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[var(--anna-bg)] text-[var(--anna-muted)] uppercase tracking-wider shrink-0">
                        {h.rfmSegment}
                      </span>
                    </div>
                    <div className="mt-0.5">
                      {renderMetric(h)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] font-data text-[var(--anna-muted)] truncate max-w-[120px]">{h.id.slice(-8)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-[var(--anna-border)]">
          <p className="text-[10px] text-[var(--anna-muted)]">
            Showing {filtered.length} of {totalCount} household{totalCount === 1 ? "" : "s"}.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-8 text-xs"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── AI Recommendation Card ──

interface InsightCardProps {
  insight: BehaviourData["insights"][number];
  index: number;
  onNavigateTab?: (tab: MarketingTab) => void;
  onOpenCreateCampaign?: (segmentId?: string) => void;
}

function InsightCard({ insight, index, onNavigateTab, onOpenCreateCampaign }: InsightCardProps) {
  const [expanded, setExpanded] = useState(false);

  const isReactivation = insight.type === "REACTIVATION";
  const isChurnPrevention = insight.type === "CHURN_PREVENTION";
  const isCrossSell = insight.type === "CROSS_SELL";
  const createCampaignType = isReactivation || isChurnPrevention;

  const actionLabel = createCampaignType
    ? "Create Campaign"
    : isCrossSell
      ? "View Segments"
      : "Learn More";

  function handleAction() {
    if (createCampaignType) {
      onOpenCreateCampaign?.();
      return;
    }
    if (isCrossSell) {
      onNavigateTab?.("segments");
      return;
    }
    setExpanded((v) => !v);
  }

  return (
    <div
      key={index}
      className={cn(
        "rounded-2xl border p-4 transition-colors",
        insight.priority === "HIGH"
          ? "border-amber-200 bg-amber-50/50"
          : "border-[var(--anna-border)] bg-[var(--anna-white)]",
      )}
    >
      <div className="flex items-start gap-3">
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", insight.priority === "HIGH" ? "bg-amber-100" : "bg-[var(--anna-sage-light)]")}>
          <Lightbulb size={14} className={insight.priority === "HIGH" ? "text-amber-600" : "text-[var(--anna-sage-dark)]"} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className={cn("text-[10px] font-bold uppercase tracking-wider", insight.priority === "HIGH" ? "text-amber-600" : "text-[var(--anna-sage-dark)]")}>{insight.type.replace(/_/g, " ")}</span>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", insight.priority === "HIGH" ? "bg-amber-100 text-amber-700" : "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]")}>{insight.priority}</span>
            <span className="text-[10px] text-[var(--anna-muted)]">
              {insight.householdIds.length} household{insight.householdIds.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className="text-sm font-medium text-[var(--anna-slate)] mb-0.5">{insight.title}</p>
          <p className="text-xs text-[var(--anna-muted)]">{insight.detail}</p>

          {expanded && (
            <div className="mt-2 pt-2 border-t border-[var(--anna-border)]/60 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                Affected households
              </p>
              <div className="max-h-32 overflow-y-auto anna-scroll rounded-lg bg-[var(--anna-bg)]/60 p-2">
                {insight.householdIds.length === 0 ? (
                  <p className="text-[10px] text-[var(--anna-muted)]">No household IDs attached.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {insight.householdIds.slice(0, 50).map((hid) => (
                      <li key={hid} className="text-[10px] font-data text-[var(--anna-slate-light)] truncate">
                        {hid}
                      </li>
                    ))}
                    {insight.householdIds.length > 50 && (
                      <li className="text-[10px] text-[var(--anna-muted)] italic">
                        + {insight.householdIds.length - 50} more
                      </li>
                    )}
                  </ul>
                )}
              </div>
              <p className="text-[10px] text-[var(--anna-muted)]">
                Suggested next step: build a segment targeting these households,
                then attach a campaign to it.
              </p>
            </div>
          )}

          <div className="mt-2.5 flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              onClick={handleAction}
              className={cn(
                "h-7 px-3 text-[11px] rounded-lg font-medium",
                createCampaignType
                  ? "bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-dark)]/90 text-white"
                  : isCrossSell
                    ? "bg-[var(--anna-sage-light)] hover:bg-[var(--anna-sage-light)]/80 text-[var(--anna-sage-dark)]"
                    : "bg-[var(--anna-bg)] hover:bg-[var(--anna-bg)]/70 text-[var(--anna-slate-light)] border border-[var(--anna-border)]",
              )}
            >
              {actionLabel}
              {createCampaignType && <Sparkles size={11} className="ml-1" />}
              {isCrossSell && <ArrowRight size={11} className="ml-1" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Drill-down dialog state ──
//
// One state object drives the single reusable HouseholdDrillDownDialog.
// Every clickable KPI / distribution / cross-sell row sets this state;
// closing the dialog clears it. Avoids a forest of separate useState
// hooks (one per dialog context).

interface DrillDownState {
  title: string;
  description?: string;
  households: HouseholdBehaviourRow[];
  total?: number;
  metric: DrillMetric;
  accent?: DrillAccent;
  icon?: LucideIcon;
}

// ── Main ──

export function InsightsTab({ onNavigateTab, onOpenCreateCampaign }: InsightsTabProps = {}) {
  const { data, isLoading, isError } = useQuery<BehaviourData>({
    queryKey: ["ops-marketing-behaviour"],
    queryFn: async () => {
      const res = await fetch("/api/ops/marketing/behaviour");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60_000,
  });

  const [neverOrderedOpen, setNeverOrderedOpen] = useState(false);
  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null);

  // Lookup map for the cross-sell drill-down (we get household IDs back
  // from the API but the dialog renders HouseholdBehaviourRow shapes —
  // so we resolve IDs → rows once per render via the `households` array).
  const householdMap = useMemo(() => {
    const m = new Map<string, HouseholdBehaviourRow>();
    for (const h of data?.households ?? []) m.set(h.id, h);
    return m;
  }, [data?.households]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-8 text-center">
        <AlertCircle size={32} className="mx-auto mb-3 text-[var(--anna-muted)]" />
        <p className="text-sm font-medium text-[var(--anna-slate)]">Failed to load insights</p>
        <p className="text-xs text-[var(--anna-muted)] mt-1">Your session may have expired.</p>
      </div>
    );
  }

  const ov = data.overview;
  const allHouseholds = data.households ?? [];
  const neverOrderedHouseholds = data.neverOrderedHouseholds ?? [];
  const rfmEntries = Object.entries(data.rfmDistribution).sort((a, b) => b[1] - a[1]);
  const churnEntries = Object.entries(data.churnRisk);
  const lifecycleEntries = Object.entries(data.lifecycleStages);

  // ── Drill-down openers ──

  function openAllHouseholds() {
    setDrillDown({
      title: "All Households",
      description: `${allHouseholds.length} household${allHouseholds.length === 1 ? "" : "s"} registered on the platform.`,
      households: allHouseholds,
      total: ov.totalHouseholds,
      metric: "summary",
      accent: "sage",
      icon: Users,
    });
  }

  function openByOrders() {
    setDrillDown({
      title: "Avg Orders / Household",
      description: `${allHouseholds.length} household${allHouseholds.length === 1 ? "" : "s"}, sorted by order count (highest first).`,
      households: allHouseholds,
      total: ov.totalHouseholds,
      metric: "orders",
      accent: "sage",
      icon: TrendingUp,
    });
  }

  function openBySpend() {
    setDrillDown({
      title: "Avg Spend / Household",
      description: `${allHouseholds.length} household${allHouseholds.length === 1 ? "" : "s"}, sorted by total spend (highest first).`,
      households: allHouseholds,
      total: ov.totalHouseholds,
      metric: "spend",
      accent: "emerald",
      icon: DollarSign,
    });
  }

  function openByRfmSegment(segment: string) {
    const rows = allHouseholds.filter((h) => h.rfmSegment === segment);
    setDrillDown({
      title: `RFM Segment · ${segment}`,
      description: `${rows.length} household${rows.length === 1 ? "" : "s"} in the "${segment}" RFM segment.`,
      households: rows,
      total: rows.length,
      metric: "lastOrder",
      accent: "sage",
      icon: Users,
    });
  }

  function openByChurnRisk(level: string) {
    const rows = allHouseholds.filter((h) => h.churnRisk === (level as HouseholdBehaviourRow["churnRisk"]));
    const accentMap: Record<string, DrillAccent> = {
      LOW: "emerald",
      MEDIUM: "amber",
      HIGH: "orange",
      CRITICAL: "red",
    };
    setDrillDown({
      title: `Churn Risk · ${level}`,
      description: `${rows.length} household${rows.length === 1 ? "" : "s"} at ${level} churn risk.`,
      households: rows,
      total: rows.length,
      metric: "lastOrder",
      accent: accentMap[level] ?? "amber",
      icon: AlertCircle,
    });
  }

  function openByLifecycleStage(stage: string) {
    const rows = allHouseholds.filter((h) => h.lifecycleStage === (stage as HouseholdBehaviourRow["lifecycleStage"]));
    setDrillDown({
      title: `Lifecycle Stage · ${stage}`,
      description: `${rows.length} household${rows.length === 1 ? "" : "s"} in the "${stage}" lifecycle stage.`,
      households: rows,
      total: rows.length,
      metric: "lastOrder",
      accent: "sage",
      icon: Users,
    });
  }

  function openByLapseBucket(key: string) {
    // `key` is one of "30days" | "60days" | "90days" | "180days"
    const days = Number.parseInt(key.replace("days", ""), 10);
    const rows = allHouseholds.filter(
      (h) => h.daysSinceLastOrder !== null && h.daysSinceLastOrder > days,
    );
    setDrillDown({
      title: `No Order in ${days}+ Days`,
      description: `${rows.length} household${rows.length === 1 ? "" : "s"} with no order in the last ${days} days.`,
      households: rows,
      total: rows.length,
      metric: "lastOrder",
      accent: "amber",
      icon: AlertCircle,
    });
  }

  function openCrossSell(opp: CrossSellOpportunity) {
    // Resolve the household IDs from the cross-sell row → full
    // HouseholdBehaviourRow via the lookup map. Missing IDs (e.g. a
    // household pruned from the capped `households` array) are
    // skipped silently — the eligible count in the dialog reflects
    // the rows we can actually render.
    const rows = opp.householdIds
      .map((id) => householdMap.get(id))
      .filter((h): h is HouseholdBehaviourRow => !!h);
    setDrillDown({
      title: `Cross-Sell · ${opp.from} → ${opp.to}`,
      description: `${opp.eligibleHouseholds} household${opp.eligibleHouseholds === 1 ? "" : "s"} use ${opp.from} but have never tried ${opp.to}.`,
      households: rows,
      total: opp.eligibleHouseholds,
      metric: "categories",
      accent: "sage",
      icon: Zap,
    });
  }

  return (
    <div className="space-y-4">
      {/* Overview KPIs — every card opens a contextual drill-down */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Total Households"
          icon={Users}
          iconBg="bg-[var(--anna-sage-light)]"
          iconColor="text-[var(--anna-sage-dark)]"
          value={ov.totalHouseholds}
          sublabel={`${ov.activeCustomers} active`}
          onClick={openAllHouseholds}
          title="See all households"
        />
        <KpiCard
          label="Avg Orders / HH"
          icon={TrendingUp}
          iconBg="bg-[var(--anna-sage-light)]"
          iconColor="text-[var(--anna-sage-dark)]"
          value={ov.avgOrdersPerHousehold}
          sublabel={`${ov.newCustomers} new customers`}
          onClick={openByOrders}
          title="See households sorted by order count"
        />
        <KpiCard
          label="Avg Spend / HH"
          icon={DollarSign}
          iconBg="bg-emerald-50"
          iconColor="text-emerald-700"
          value={formatSgd(ov.avgSpendPerHouseholdCents)}
          sublabel={`${ov.lapsedCustomers} lapsed`}
          onClick={openBySpend}
          title="See households sorted by spend"
        />
        <KpiCard
          label="Never Ordered"
          icon={AlertCircle}
          iconBg="bg-amber-50"
          iconColor="text-amber-700"
          value={ov.neverOrdered}
          sublabel={`${ov.totalHouseholds > 0 ? Math.round((ov.neverOrdered / ov.totalHouseholds) * 100) : 0}% of total`}
          onClick={() => setNeverOrderedOpen(true)}
          title="See households with 0 orders"
        />
      </div>

      {/* Two-column: RFM + Lapse */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">RFM Segments</h3>
          <DistributionBar
            items={rfmEntries}
            max={Math.max(...rfmEntries.map((e) => e[1]), 1)}
            onItemClick={openByRfmSegment}
          />
        </div>
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">Lapse Analysis</h3>
          <div className="space-y-2">
            {Object.entries(data.lapseAnalysis).map(([key, count]) => {
              const clickable = count > 0;
              return (
                <button
                  key={key}
                  type="button"
                  disabled={!clickable}
                  onClick={clickable ? () => openByLapseBucket(key) : undefined}
                  className={cn(
                    "flex items-center justify-between w-full text-left group -mx-1 px-1 rounded-md transition-colors",
                    clickable && "cursor-pointer hover:bg-[var(--anna-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--anna-sage)] focus-visible:ring-offset-1",
                    !clickable && "cursor-default",
                  )}
                  aria-label={`No order in ${key.replace("days", " days")}: ${count} household${count === 1 ? "" : "s"}${clickable ? ". Click to view households." : ""}`}
                >
                  <span className="text-xs text-[var(--anna-slate-light)]">
                    No order in {key.replace("days", " days")}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className={cn("text-sm font-data font-bold", count > 0 ? "text-amber-600" : "text-[var(--anna-muted)]")}>{count}</span>
                    {clickable && (
                      <ChevronRight
                        size={12}
                        className="text-[var(--anna-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Two-column: Churn + Lifecycle */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">Churn Risk</h3>
          <div className="grid grid-cols-2 gap-2">
            {churnEntries.map(([level, count]) => {
              const clickable = count > 0;
              const palette = level === "CRITICAL"
                ? "bg-red-50 border-red-200 text-red-600 hover:border-red-300"
                : level === "HIGH"
                  ? "bg-orange-50 border-orange-200 text-orange-600 hover:border-orange-300"
                  : level === "MEDIUM"
                    ? "bg-amber-50 border-amber-200 text-amber-600 hover:border-amber-300"
                    : "bg-emerald-50 border-emerald-200 text-emerald-600 hover:border-emerald-300";
              return (
                <button
                  key={level}
                  type="button"
                  disabled={!clickable}
                  onClick={clickable ? () => openByChurnRisk(level) : undefined}
                  className={cn(
                    "rounded-xl p-3 border text-center transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--anna-sage)] focus-visible:ring-offset-1",
                    palette,
                    clickable && "cursor-pointer hover:shadow-sm hover:-translate-y-px",
                    !clickable && "cursor-default",
                  )}
                  aria-label={`Churn risk ${level}: ${count} household${count === 1 ? "" : "s"}${clickable ? ". Click to view households." : ""}`}
                >
                  <div className="flex items-center justify-center gap-1">
                    <p className="text-xl font-bold font-data">{count}</p>
                    {clickable && (
                      <ChevronRight
                        size={12}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      />
                    )}
                  </div>
                  <p className="text-[10px] text-[var(--anna-muted)] uppercase tracking-wider">{level}</p>
                </button>
              );
            })}
          </div>
        </div>
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">Lifecycle Stages</h3>
          <DistributionBar
            items={lifecycleEntries}
            max={Math.max(...lifecycleEntries.map((e) => e[1]), 1)}
            onItemClick={openByLifecycleStage}
          />
        </div>
      </div>

      {/* Category Usage + Cross-sell */}
      {data.crossSellOpportunities.length > 0 && (
        <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3 flex items-center gap-1.5">
            <Zap size={12} /> Cross-Sell Opportunities
          </h3>
          <div className="space-y-1.5">
            {data.crossSellOpportunities.slice(0, 5).map((opp, i) => (
              <button
                key={i}
                type="button"
                onClick={() => openCrossSell(opp)}
                className="flex items-center justify-between py-1 w-full text-left group -mx-1 px-1 rounded-md hover:bg-[var(--anna-bg)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--anna-sage)] focus-visible:ring-offset-1 cursor-pointer"
                aria-label={`Cross-sell from ${opp.from} to ${opp.to}: ${opp.eligibleHouseholds} eligible household${opp.eligibleHouseholds === 1 ? "" : "s"}. Click to view households.`}
              >
                <span className="text-xs text-[var(--anna-slate-light)]">
                  <span className="font-medium">{opp.from}</span> → <span className="font-medium">{opp.to}</span>
                </span>
                <span className="flex items-center gap-1">
                  <span className="text-xs font-data text-[var(--anna-sage-dark)]">{opp.eligibleHouseholds} eligible</span>
                  <ChevronRight
                    size={12}
                    className="text-[var(--anna-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* AI Insights — Fix 15: each card has a "Take Action" button */}
      {data.insights.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
            <Lightbulb size={12} /> AI Recommendations
          </h3>
          {data.insights.map((ins, i) => (
            <InsightCard
              key={i}
              insight={ins}
              index={i}
              onNavigateTab={onNavigateTab}
              onOpenCreateCampaign={onOpenCreateCampaign}
            />
          ))}
        </div>
      )}

      {/* Never-Ordered drill-down dialog (legacy — kept for its
          name-only list since these households have no behavioural
          data to show in the generic dialog) */}
      <NeverOrderedDialog
        open={neverOrderedOpen}
        onOpenChange={setNeverOrderedOpen}
        households={neverOrderedHouseholds}
        total={ov.neverOrdered}
      />

      {/* Reusable contextual drill-down dialog — driven by the
          single `drillDown` state object set from every clickable
          KPI / distribution / cross-sell row above. */}
      <HouseholdDrillDownDialog
        open={!!drillDown}
        onOpenChange={(o) => !o && setDrillDown(null)}
        title={drillDown?.title ?? ""}
        description={drillDown?.description}
        households={drillDown?.households ?? []}
        total={drillDown?.total}
        metric={drillDown?.metric ?? "summary"}
        accent={drillDown?.accent ?? "sage"}
        icon={drillDown?.icon}
      />
    </div>
  );
}
