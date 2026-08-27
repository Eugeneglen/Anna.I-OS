"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, TrendingUp, DollarSign, Users, Repeat, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatSgd, formatDate } from "@/lib/ops-format";

// ── Types ──

interface PerformanceData {
  funnel: {
    targetAudienceSize: number;
    vouchersIssued: number;
    vouchersViewed: number;
    vouchersRedeemed: number;
    ordersGenerated: number;
    ordersCompleted: number;
    revenueGeneratedCents: number;
    discountGivenCents: number;
    netRevenueCents: number;
    totalDiscountCents: number;
    customerReactivation: {
      lapsedCustomersReactivated: number;
      newCustomersAcquired: number;
    };
    timeline: Array<{ date: string; event: string; count: number }>;
    rates: {
      viewRate: number;
      redemptionRate: number;
      conversionRate: number;
      completionRate: number;
    };
  };
  roi: {
    revenueAttributedCents: number;
    discountCostCents: number;
    incrementalRevenueCents: number;
    roi: number;
    attributedOrders: number;
  };
}

// ── Helpers ──

function FunnelRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-[var(--anna-slate-light)] w-40 shrink-0 truncate">{label}</span>
      <div className="flex-1 h-6 rounded-md bg-[var(--anna-bg)] overflow-hidden">
        <div className={cn("h-full rounded-md transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-data font-bold text-[var(--anna-slate)] w-16 text-right shrink-0">{value}</span>
      <span className="text-[10px] text-[var(--anna-muted)] w-12 text-right shrink-0">
        {total > 0 ? `${(pct).toFixed(0)}%` : "—"}
      </span>
    </div>
  );
}

function KpiMini({ label, icon: Icon, value, sublabel }: {
  label: string;
  icon: typeof DollarSign;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div className="bg-[var(--anna-bg)] rounded-xl p-3 border border-[var(--anna-border)]">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={12} className="text-[var(--anna-muted)]" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">{label}</span>
      </div>
      <p className="text-lg font-bold font-data text-[var(--anna-slate)]">{value}</p>
      {sublabel && <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">{sublabel}</p>}
    </div>
  );
}

// ── Main Component ──

interface CampaignPerformanceProps {
  campaignId: string;
}

export function CampaignPerformance({ campaignId }: CampaignPerformanceProps) {
  const { data, isLoading, isError } = useQuery<PerformanceData>({
    queryKey: ["campaign-performance", campaignId],
    queryFn: async () => {
      const res = await fetch(`/api/ops/marketing/${campaignId}/performance`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!campaignId,
    staleTime: 30_000,
  });

  if (isLoading) {
    return <Skeleton className="h-48 rounded-2xl" />;
  }

  if (isError || !data) {
    return (
      <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)] p-4 text-center">
        <AlertCircle size={20} className="mx-auto mb-2 text-[var(--anna-muted)]" />
        <p className="text-xs text-[var(--anna-muted)]">Failed to load performance data</p>
      </div>
    );
  }

  const f = data.funnel;
  const r = data.roi;

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
        <TrendingUp size={12} /> Campaign Performance
      </h4>

      {/* Funnel */}
      <div className="bg-[var(--anna-bg)] rounded-xl border border-[var(--anna-border)] p-3 space-y-1.5">
        <FunnelRow label="Target audience" value={f.targetAudienceSize} total={f.targetAudienceSize || 1} color="bg-[var(--anna-sage)]" />
        <FunnelRow label="Vouchers issued" value={f.vouchersIssued} total={f.targetAudienceSize || f.vouchersIssued || 1} color="bg-[var(--anna-sage)]" />
        <FunnelRow label="Vouchers viewed" value={f.vouchersViewed} total={f.vouchersIssued || 1} color="bg-blue-400" />
        <FunnelRow label="Vouchers redeemed" value={f.vouchersRedeemed} total={f.vouchersIssued || 1} color="bg-emerald-500" />
        <FunnelRow label="Orders completed" value={f.ordersCompleted} total={f.ordersGenerated || 1} color="bg-[var(--anna-sage-dark)]" />
      </div>

      {/* Rates */}
      <div className="grid grid-cols-4 gap-2">
        <KpiMini label="View" icon={Users} value={`${(f.rates.viewRate * 100).toFixed(0)}%`} />
        <KpiMini label="Redeem" icon={Repeat} value={`${(f.rates.redemptionRate * 100).toFixed(0)}%`} />
        <KpiMini label="Convert" icon={TrendingUp} value={`${(f.rates.conversionRate * 100).toFixed(0)}%`} />
        <KpiMini label="Complete" icon={Clock} value={`${(f.rates.completionRate * 100).toFixed(0)}%`} />
      </div>

      {/* Revenue + ROI */}
      <div className="grid grid-cols-2 gap-2">
        <KpiMini label="Revenue" icon={DollarSign} value={formatSgd(f.revenueGeneratedCents)} sublabel={`Net: ${formatSgd(f.netRevenueCents)}`} />
        <KpiMini label="Discount Cost" icon={DollarSign} value={formatSgd(f.discountGivenCents)} sublabel={`ROI: ${r.roi}x`} />
      </div>

      {/* Customer Impact */}
      {(f.customerReactivation.lapsedCustomersReactivated > 0 || f.customerReactivation.newCustomersAcquired > 0) && (
        <div className="grid grid-cols-2 gap-2">
          <KpiMini label="Reactivated" icon={Repeat} value={f.customerReactivation.lapsedCustomersReactivated} sublabel="lapsed customers won back" />
          <KpiMini label="New Customers" icon={Users} value={f.customerReactivation.newCustomersAcquired} sublabel="first-time orders" />
        </div>
      )}

      {/* Timeline */}
      {f.timeline.length > 0 && (
        <div className="bg-[var(--anna-bg)] rounded-xl border border-[var(--anna-border)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-2">Timeline</p>
          <div className="space-y-1 max-h-32 overflow-y-auto anna-scroll">
            {f.timeline.slice(0, 20).map((t, i) => (
              <div key={i} className="flex items-center justify-between text-[10px]">
                <span className="text-[var(--anna-slate-light)]">
                  <span className="font-data text-[var(--anna-muted)]">{formatDate(t.date)}</span> · {t.event.replace(/_/g, " ").toLowerCase()}
                </span>
                <span className="font-data font-bold text-[var(--anna-sage-dark)]">{t.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
