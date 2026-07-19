"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CategoryIcon, getCategoryLabel } from "@/components/anna/category-icon";
import { formatSgd, formatDate, type ServiceCategory } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Wallet,
  CheckCircle2,
  Star,
  TrendingUp,
  ArrowDownCircle,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────

interface EarningsResponse {
  totalEarned: number;
  pendingPayout: number;
  totalCompleted: number;
  averageRating: number;
  thisMonth: {
    earned: number;
    completed: number;
    pending: number;
  };
  recent: {
    id: string;
    category: ServiceCategory;
    householdName: string;
    address: string;
    completedAt: string;
    rating: number | null;
    payoutCents: number;
    payoutState: string;
  }[];
}

interface VendorEarningsProps {
  vendorId: string;
}

// ─── Fetcher ─────────────────────────────────────────────

async function fetchVendorEarnings(vendorId: string): Promise<EarningsResponse> {
  const res = await fetch(`/api/vendors/${vendorId}/earnings`);
  if (!res.ok) throw new Error("Failed to fetch vendor earnings");
  return res.json();
}

// ─── Summary stat card ────────────────────────────────────

function EarningsStatCard({
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
        <div
          className={cn(
            "w-8 h-8 rounded-xl flex items-center justify-center",
            iconBg
          )}
        >
          <Icon size={16} className={iconColor} />
        </div>
        <span className="text-xs text-[var(--anna-muted)] font-medium">{label}</span>
      </div>
      <p className="font-data text-xl font-bold text-[var(--anna-slate)]">{value}</p>
      {sub && <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Summary grid ─────────────────────────────────────────

function EarningsSummaryGrid({
  totalEarned,
  pendingPayout,
  completedJobs,
  avgRating,
  label,
}: {
  totalEarned: number;
  pendingPayout: number;
  completedJobs: number;
  avgRating: number;
  label: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        {label === "This Month" && (
          <TrendingUp size={14} className="text-[var(--anna-sage-dark)]" />
        )}
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-slate)]">
          {label}
        </h3>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <EarningsStatCard
          icon={Wallet}
          iconColor="text-[var(--anna-sage-dark)]"
          iconBg="bg-[var(--anna-sage-light)]"
          label={label === "This Month" ? "Earned" : "Total Earned"}
          value={formatSgd(totalEarned)}
          sub="Net of commission"
        />
        <EarningsStatCard
          icon={Wallet}
          iconColor="text-[var(--anna-warning)]"
          iconBg="bg-[var(--anna-warning)]/10"
          label="Pending Payout"
          value={formatSgd(pendingPayout)}
          sub={pendingPayout > 0 ? "Processing" : "All settled"}
        />
        <EarningsStatCard
          icon={CheckCircle2}
          iconColor="text-[var(--anna-success)]"
          iconBg="bg-[var(--anna-success)]/10"
          label="Completed Jobs"
          value={String(completedJobs)}
        />
        <EarningsStatCard
          icon={Star}
          iconColor="text-[var(--anna-warning)]"
          iconBg="bg-[var(--anna-warning)]/10"
          label="Avg Rating"
          value={avgRating > 0 ? avgRating.toFixed(1) : "—"}
          sub={avgRating > 0 ? "out of 5.0" : "No ratings yet"}
        />
      </div>
    </div>
  );
}

// ─── Payout status badge ──────────────────────────────────

const PAYOUT_STYLES: Record<string, string> = {
  released: "bg-[var(--anna-success)]/15 text-[var(--anna-success)] border-[var(--anna-success)]/20",
  held: "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)] border-[var(--anna-warning)]/20",
};

// ─── Payout row ───────────────────────────────────────────

function PayoutRow({ payout }: { payout: EarningsResponse["recent"][number] }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-[var(--anna-border)] last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <CategoryIcon category={payout.category} size={14} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--anna-slate)] truncate">
            {getCategoryLabel(payout.category)}
          </p>
          <p className="text-[10px] text-[var(--anna-muted)]">
            {payout.householdName} &middot; {formatDate(payout.completedAt)}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="font-data text-sm font-bold text-[var(--anna-slate)]">
          {formatSgd(payout.payoutCents)}
        </span>
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] px-2 py-0.5 font-medium capitalize",
            PAYOUT_STYLES[payout.payoutState] ?? PAYOUT_STYLES.held
          )}
        >
          {payout.payoutState === "released" ? "paid" : "pending"}
        </Badge>
      </div>
    </div>
  );
}

// ─── Loading skeleton ────────────────────────────────────

function EarningsSkeleton() {
  return (
    <div className="p-4 lg:p-6 space-y-6">
      <Skeleton className="h-8 w-48 rounded-xl bg-[var(--anna-border)]" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl bg-[var(--anna-border)]" />
        ))}
      </div>
      <Skeleton className="h-8 w-32 rounded-xl bg-[var(--anna-border)]" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl bg-[var(--anna-border)]" />
        ))}
      </div>
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl bg-[var(--anna-border)]" />
      ))}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────

export function VendorEarnings({ vendorId }: VendorEarningsProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["vendor-earnings", vendorId],
    queryFn: () => fetchVendorEarnings(vendorId),
    enabled: !!vendorId,
  });

  if (isLoading) return <EarningsSkeleton />;
  if (!data) return null;

  return (
    <div className="space-y-6 p-4 lg:p-6">
      {/* Overall summary */}
      <EarningsSummaryGrid
        totalEarned={data.totalEarned}
        pendingPayout={data.pendingPayout}
        completedJobs={data.totalCompleted}
        avgRating={data.averageRating}
        label="All Time"
      />

      {/* This month summary */}
      <EarningsSummaryGrid
        totalEarned={data.thisMonth.earned}
        pendingPayout={data.thisMonth.pending}
        completedJobs={data.thisMonth.completed}
        avgRating={data.averageRating}
        label="This Month"
      />

      {/* Recent payouts */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ArrowDownCircle size={14} className="text-[var(--anna-sage-dark)]" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-slate)]">
            Recent Payouts
          </h3>
          {data.recent.length > 0 && (
            <span className="font-data text-[10px] text-[var(--anna-muted)] bg-[var(--anna-sage-light)] px-1.5 py-0.5 rounded-md">
              {data.recent.length}
            </span>
          )}
        </div>

        {data.recent.length === 0 ? (
          <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-8 text-center">
            <Wallet size={24} className="mx-auto mb-2 text-[var(--anna-muted)] opacity-30" />
            <p className="text-sm text-[var(--anna-muted)]">No payouts yet</p>
            <p className="text-xs text-[var(--anna-muted)] mt-0.5">
              Earnings will appear here after completing jobs
            </p>
          </div>
        ) : (
          <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] px-4 max-h-96 overflow-y-auto anna-scroll">
            {data.recent.map((payout) => (
              <PayoutRow key={payout.id} payout={payout} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}