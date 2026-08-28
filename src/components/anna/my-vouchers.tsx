"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Ticket, Clock, CheckCircle2, XCircle, Loader2, ChevronRight, PauseCircle } from "lucide-react";
import { VoucherStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { formatSgd, formatDate } from "@/lib/types";
import { useAnnaStore } from "@/lib/store";
import { Button } from "@/components/ui/button";

// ── Types ──

interface Voucher {
  id: string;
  status: VoucherStatus;
  code: string;
  campaignName: string;
  campaignType: string;
  targetCategory: string | null;
  discountType: string | null;
  discountValue: number | null;
  minOrderValueCents: number;
  maxDiscountCapCents: number;
  eligibility: string | null;
  claimedAt: string;
  usedAt: string | null;
  expiresAt: string | null;
  // Underlying code state — when isActive=false the wallet card greys out
  // and shows a "Suspended" badge, so the household sees the truth before
  // attempting to apply the code at checkout.
  codeActive?: boolean;
  usesRemaining?: number | null;
  maxUses?: number | null;
  // Service-recovery audit fields (null when not a compensation voucher)
  issuedFromTaskId?: string | null;
  compensationReason?: string | null;
  issuedByName?: string | null;
}

interface MyVouchersProps {
  // Carries the voucher's code/id/targetCategory back up to the layout shell
  // so the booking form can pre-fill the promo code and auto-apply it.
  onBookNow?: (code: string, voucherId: string, targetCategory?: string | null) => void;
}

// ── Helpers ──

function formatDiscount(v: Voucher): string {
  if (!v.discountType || !v.discountValue) return "Special Offer";
  if (v.discountType === "PERCENTAGE") return `${v.discountValue}% OFF`;
  return `$${v.discountValue} OFF`;
}

// ── Voucher Card ──

function VoucherCard({
  voucher,
  onView,
}: {
  voucher: Voucher;
  onView?: () => void;
}) {
  const [showTerms, setShowTerms] = useState(false);
  // A voucher is "suspended" when the underlying code has been paused by ops
  // (DiscountCode.isActive=false) but the Voucher row itself is still CLAIMED.
  // We surface this as a distinct visual state from "Available" so the
  // household knows before clicking Book Now.
  const isSuspended = voucher.status === "CLAIMED" && voucher.codeActive === false;
  const isAvailable = voucher.status === "CLAIMED" && !isSuspended;
  const isUsed = voucher.status === "USED";
  const isExpired = voucher.status === "EXPIRED" || voucher.status === "REVOKED";

  return (
    <div
      className={cn(
        "rounded-2xl border p-4 transition-all",
        isAvailable
          ? "border-[var(--anna-sage)]/30 bg-[var(--anna-sage-light)]/30"
          : isSuspended
            ? "border-amber-200 bg-amber-50/40 opacity-70"
            : isUsed
              ? "border-[var(--anna-border)] bg-[var(--anna-bg)] opacity-60"
              : "border-[var(--anna-border)] bg-[var(--anna-bg)] opacity-50"
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-lg font-bold text-[var(--anna-sage-dark)]">
              {formatDiscount(voucher)}
            </span>
            {isAvailable && (
              <Badge variant="outline" className="text-[10px] border-[var(--anna-sage)]/30 text-[var(--anna-sage-dark)]">
                Available
              </Badge>
            )}
            {isSuspended && (
              <Badge
                variant="outline"
                className="text-[10px] border-amber-300 bg-amber-100 text-amber-700 cursor-help"
                title="This voucher was suspended — contact support"
              >
                <PauseCircle size={10} className="inline mr-0.5" />
                Suspended
              </Badge>
            )}
            {isUsed && (
              <Badge variant="outline" className="text-[10px] border-[var(--anna-muted)] text-[var(--anna-muted)]">
                Used
              </Badge>
            )}
            {voucher.status === "EXPIRED" && (
              <Badge variant="outline" className="text-[10px] border-[var(--anna-muted)] text-[var(--anna-muted)]">
                Expired
              </Badge>
            )}
            {voucher.status === "REVOKED" && (
              <Badge variant="outline" className="text-[10px] border-[var(--anna-muted)] text-[var(--anna-muted)]">
                Removed
              </Badge>
            )}
            {voucher.issuedFromTaskId && (
              <Badge
                variant="outline"
                className="text-[9px] border-violet-300 bg-violet-100 text-violet-700 cursor-help"
                title={voucher.compensationReason
                  ? `Issued by Anna.I as compensation — ${voucher.compensationReason}`
                  : "Issued by Anna.I as compensation for a service issue"}
              >
                Compensation
              </Badge>
            )}
          </div>
          <p className="text-xs font-medium text-[var(--anna-slate)] truncate" title={voucher.campaignName}>
            {voucher.campaignName}
          </p>
          {voucher.compensationReason && (
            <p className="text-[10px] text-[var(--anna-muted)] italic mt-0.5 line-clamp-2">
              “{voucher.compensationReason}”
            </p>
          )}
        </div>
        {isAvailable && voucher.expiresAt && (
          <div className="text-right shrink-0">
            <Clock size={12} className="text-[var(--anna-muted)] inline mr-1" />
            <span className="text-[10px] text-[var(--anna-muted)]">
              Exp {formatDate(voucher.expiresAt)}
            </span>
          </div>
        )}
      </div>

      {/* Details */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {voucher.targetCategory && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--anna-white)] text-[var(--anna-slate-light)] border border-[var(--anna-border)]">
            {voucher.targetCategory.replace(/_/g, " ")}
          </span>
        )}
        {voucher.minOrderValueCents > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--anna-white)] text-[var(--anna-slate-light)] border border-[var(--anna-border)]">
            Min {formatSgd(voucher.minOrderValueCents)}
          </span>
        )}
        {voucher.code && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--anna-white)] text-[var(--anna-sage-dark)] border border-[var(--anna-border)] font-mono">
            {voucher.code}
          </span>
        )}
      </div>

      {/* Used date */}
      {isUsed && voucher.usedAt && (
        <p className="text-[10px] text-[var(--anna-muted)]">
          Used on {formatDate(voucher.usedAt)}
        </p>
      )}

      {/* Actions */}
      {isAvailable && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[var(--anna-border)]">
          <Button
            size="sm"
            className="h-7 text-xs rounded-lg bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white"
            onClick={onView}
          >
            Book Now
            <ChevronRight size={12} className="ml-1" />
          </Button>
          <button
            type="button"
            onClick={() => setShowTerms(!showTerms)}
            className="text-[10px] text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
          >
            {showTerms ? "Hide Terms" : "View Terms"}
          </button>
        </div>
      )}

      {showTerms && (
        <div className="mt-2 p-2 rounded-lg bg-[var(--anna-white)] border border-[var(--anna-border)] text-[10px] text-[var(--anna-muted)] space-y-0.5">
          <p>• Discount: {formatDiscount(voucher)}</p>
          {voucher.targetCategory && <p>• Eligible service: {voucher.targetCategory.replace(/_/g, " ")}</p>}
          {voucher.minOrderValueCents > 0 && <p>• Minimum spend: {formatSgd(voucher.minOrderValueCents)}</p>}
          {voucher.eligibility && <p>• Eligibility: {voucher.eligibility.replace(/_/g, " ").toLowerCase()}</p>}
          {voucher.expiresAt && <p>• Valid until: {formatDate(voucher.expiresAt)}</p>}
          <p>• Code: {voucher.code} (selectable at checkout)</p>
        </div>
      )}
    </div>
  );
}

// ── Badge (inline — avoids import cycle issues) ──
function Badge({ variant, className, children }: { variant?: string; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium", className)}>
      {children}
    </span>
  );
}

// ── Main Component ──

export function MyVouchers({ onBookNow }: MyVouchersProps) {
  const { data, isLoading } = useQuery<{ vouchers: Voucher[] }>({
    queryKey: ["household-vouchers"],
    queryFn: async () => {
      const res = await fetch("/api/household/vouchers");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 30_000,
  });

  const vouchers = data?.vouchers || [];
  const available = vouchers.filter((v) => v.status === "CLAIMED" && v.codeActive !== false);
  const suspended = vouchers.filter((v) => v.status === "CLAIMED" && v.codeActive === false);
  const used = vouchers.filter((v) => v.status === "USED");
  const expired = vouchers.filter((v) => v.status === "EXPIRED" || v.status === "REVOKED");

  // Mark viewed mutation
  const viewMutation = useMutation({
    mutationFn: async (voucherId: string) => {
      await fetch(`/api/household/vouchers/${voucherId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "view" }),
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-[var(--anna-muted)]" />
      </div>
    );
  }

  return (
    <div className="space-y-5 anna-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-[var(--anna-slate)]">My Vouchers</h2>
        <p className="text-sm text-[var(--anna-muted)]">
          {available.length} available · {used.length} used · {expired.length} expired
          {suspended.length > 0 && ` · ${suspended.length} suspended`}
        </p>
      </div>

      {/* Available */}
      {available.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
            <Ticket size={12} />
            Available ({available.length})
          </h3>
          {available.map((v) => (
            <VoucherCard
              key={v.id}
              voucher={v}
              onView={() => {
                viewMutation.mutate(v.id);
                onBookNow?.(v.code, v.id, v.targetCategory);
              }}
            />
          ))}
        </div>
      )}

      {/* Suspended */}
      {suspended.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
            <PauseCircle size={12} />
            Suspended ({suspended.length})
          </h3>
          {suspended.map((v) => (
            <VoucherCard key={v.id} voucher={v} />
          ))}
        </div>
      )}

      {/* Used */}
      {used.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
            <CheckCircle2 size={12} />
            Used ({used.length})
          </h3>
          {used.map((v) => (
            <VoucherCard key={v.id} voucher={v} />
          ))}
        </div>
      )}

      {/* Expired */}
      {expired.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
            <XCircle size={12} />
            Expired ({expired.length})
          </h3>
          {expired.map((v) => (
            <VoucherCard key={v.id} voucher={v} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {vouchers.length === 0 && (
        <div className="text-center py-12">
          <div className="w-14 h-14 rounded-2xl bg-[var(--anna-sage-light)] flex items-center justify-center mx-auto mb-3">
            <Ticket size={24} className="text-[var(--anna-sage-dark)]" />
          </div>
          <p className="text-sm font-medium text-[var(--anna-slate)]">No vouchers yet</p>
          <p className="text-xs text-[var(--anna-muted)] mt-1">
            Vouchers will appear here when you receive special offers
          </p>
        </div>
      )}
    </div>
  );
}
