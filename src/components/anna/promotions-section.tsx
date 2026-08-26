"use client";

import { useQuery } from "@tanstack/react-query";
import { Ticket, History, Gift } from "lucide-react";
import { formatSgd } from "@/lib/types";

// ============================================================
// Anna.I — Household Promotions Section
// ============================================================
// Shows the household's discount code redemption history.
// Each row: code, campaign name, discount applied, date.
// ============================================================

interface Redemption {
  id: string;
  code: string;
  campaignName: string;
  campaignType: string;
  discountAppliedCents: number;
  redeemedAt: string;
  bookingId: string | null;
  subscriptionId: string | null;
}

interface PromotionsSectionProps {
  householdId: string;
}

export function PromotionsSection({ householdId }: PromotionsSectionProps) {
  const { data, isLoading } = useQuery<{ redemptions: Redemption[] }>({
    queryKey: ["household-redemptions", householdId],
    queryFn: async () => {
      const res = await fetch("/api/household/redemptions");
      if (!res.ok) throw new Error("Failed to load redemptions");
      return res.json();
    },
    staleTime: 60_000,
  });

  const redemptions = data?.redemptions || [];
  const totalSavedCents = redemptions.reduce(
    (sum, r) => sum + (r.discountAppliedCents || 0),
    0
  );

  return (
    <div className="bg-[var(--anna-white)] rounded-2xl p-5 border border-[var(--anna-border)] mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
          <Ticket size={14} />
          Promotions
        </h3>
        {redemptions.length > 0 && (
          <span className="text-[10px] font-data text-emerald-600">
            Total saved: {formatSgd(totalSavedCents)}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="h-12 rounded-xl bg-[var(--anna-bg)] animate-pulse"
            />
          ))}
        </div>
      ) : redemptions.length === 0 ? (
        <div className="text-center py-6">
          <div className="w-10 h-10 rounded-xl bg-[var(--anna-sage-light)] flex items-center justify-center mx-auto mb-2">
            <Gift size={18} className="text-[var(--anna-sage-dark)]" />
          </div>
          <p className="text-sm font-medium text-[var(--anna-slate)]">
            No promo codes redeemed yet
          </p>
          <p className="text-xs text-[var(--anna-muted)] mt-1">
            Enter a promo code on your next booking to get a discount
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {redemptions.slice(0, 5).map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between py-2 border-b border-[var(--anna-border)] last:border-0"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[var(--anna-sage-light)] flex items-center justify-center shrink-0">
                  <Ticket size={14} className="text-[var(--anna-sage-dark)]" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--anna-slate)] font-data truncate">
                    {r.code}
                  </p>
                  <p className="text-[10px] text-[var(--anna-muted)] truncate">
                    {r.campaignName}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-data font-medium text-emerald-600">
                  −{formatSgd(r.discountAppliedCents)}
                </p>
                <p className="text-[10px] text-[var(--anna-muted)]">
                  {new Date(r.redeemedAt).toLocaleDateString("en-SG", {
                    day: "2-digit",
                    month: "short",
                  })}
                </p>
              </div>
            </div>
          ))}
          {redemptions.length > 5 && (
            <p className="text-[10px] text-center text-[var(--anna-muted)] pt-2">
              +{redemptions.length - 5} more
            </p>
          )}
        </div>
      )}

      {redemptions.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--anna-border)] flex items-center gap-1.5 text-[10px] text-[var(--anna-muted)]">
          <History size={10} />
          <span>Showing last 5 redemptions</span>
        </div>
      )}
    </div>
  );
}
