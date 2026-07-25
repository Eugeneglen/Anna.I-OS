"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Crown,
  ArrowUpCircle,
  AlertTriangle,
  CreditCard,
  ExternalLink,
  Loader2,
  Info,
  ShieldCheck,
} from "lucide-react";
import { formatSgd, type Subscription } from "@/lib/types";

interface BillingSectionProps {
  sub: Subscription | undefined;
  householdId: string;
}

interface BillingConfig {
  publishableKey: string;
  enabled: boolean;
}

export function BillingSection({ sub, householdId }: BillingSectionProps) {
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  // ── Fetch billing config ──
  const { data: billingConfig } = useQuery<BillingConfig>({
    queryKey: ["billing-config"],
    queryFn: () =>
      fetch("/api/billing/config").then((r) => r.json()),
  });

  const isBillingAvailable = billingConfig?.enabled === true;

  // ── Checkout mutation ──
  const checkoutMutation = useMutation({
    mutationFn: async ({ tier }: { tier: "HOME" | "CARE" }) => {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create checkout session");
      }
      return res.json() as Promise<{ checkoutUrl: string }>;
    },
    onMutate: () => {
      setCheckoutLoading(true);
    },
    onSuccess: (data) => {
      // Redirect to Stripe Checkout
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    },
    onError: (err) => {
      toast.error(err.message);
      setCheckoutLoading(false);
    },
  });

  // ── Portal mutation ──
  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to open billing portal");
      }
      return res.json() as Promise<{ portalUrl: string }>;
    },
    onSuccess: (data) => {
      if (data.portalUrl) {
        window.open(data.portalUrl, "_blank", "noopener,noreferrer");
      }
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  // ── Determine if household has an active Stripe subscription ──
  const hasStripeSubscription = !!sub?.stripeSubscriptionId;

  // ── Show subscription info ──
  return (
    <div className="bg-[var(--anna-white)] rounded-2xl p-5 border border-[var(--anna-border)] mb-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
          Subscription & Billing
        </h3>
        {isBillingAvailable && (
          <span className="flex items-center gap-1 text-[10px] text-[var(--anna-sage-dark)]">
            <ShieldCheck size={10} />
            Stripe
          </span>
        )}
      </div>

      {sub ? (
        <div className="space-y-3">
          {/* ── Status and tier ── */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown size={16} className="text-[var(--anna-warning)]" />
              <span className="text-sm font-semibold text-[var(--anna-slate)]">
                {sub.tier === "HOME" ? "Home" : "Care"} Tier
              </span>
            </div>
            <span
              className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${
                sub.status === "ACTIVE"
                  ? "bg-[var(--anna-success)]/15 text-[var(--anna-success)]"
                  : sub.status === "PAST_DUE"
                  ? "bg-[var(--anna-warning)]/15 text-[var(--anna-warning)]"
                  : "bg-[var(--anna-error)]/15 text-[var(--anna-error)]"
              }`}
            >
              {sub.status.replace(/_/g, " ")}
            </span>
          </div>

          {/* ── Price ── */}
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--anna-muted)]">Price</span>
            <span className="font-data font-semibold text-[var(--anna-slate)]">
              {formatSgd(sub.priceCents)}
              <span className="text-[var(--anna-muted)] font-sans font-normal">
                /mo
              </span>
            </span>
          </div>

          {/* ── Next billing ── */}
          {sub.nextBillingDate && sub.status === "ACTIVE" && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--anna-muted)]">Next billing</span>
              <span className="font-data text-[var(--anna-slate-light)]">
                {new Date(sub.nextBillingDate).toLocaleDateString("en-SG", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
          )}

          {/* ── Upgrade prompt for HOME tier ── */}
          {sub.tier === "HOME" && sub.status === "ACTIVE" && (
            <div className="bg-[var(--anna-sage-light)] rounded-xl p-3 mt-2 border border-[var(--anna-sage)]/20">
              <div className="flex items-start gap-2">
                <ArrowUpCircle size={18} className="text-[var(--anna-sage-dark)] shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-[var(--anna-slate)]">
                    Upgrade to Anna.I Care
                  </p>
                  <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">
                    Premium eldercare companion bundles, priority support, and dedicated coordinator access.
                  </p>
                  <p className="text-xs font-data font-semibold text-[var(--anna-slate)] mt-1">
                    SGD $68/mo
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── Action buttons ── */}
          <div className="pt-1 space-y-2">
            {/* ── Upgrade button: HOME → CARE ── */}
            {sub.tier === "HOME" && sub.status === "ACTIVE" && isBillingAvailable && (
              <Button
                size="sm"
                className="w-full h-9 text-xs rounded-xl bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-dark)]/90 text-white"
                onClick={() => checkoutMutation.mutate({ tier: "CARE" })}
                disabled={checkoutLoading || checkoutMutation.isPending}
              >
                {(checkoutLoading || checkoutMutation.isPending) ? (
                  <>
                    <Loader2 size={14} className="animate-spin mr-1.5" />
                    Redirecting to payment…
                  </>
                ) : (
                  <>
                    <CreditCard size={14} className="mr-1.5" />
                    Upgrade to Care — SGD $68/mo
                  </>
                )}
              </Button>
            )}

            {/* ── Upgrade note when billing is not available ── */}
            {sub.tier === "HOME" && sub.status === "ACTIVE" && !isBillingAvailable && (
              <div className="flex items-center gap-1.5 text-[10px] text-[var(--anna-muted)]">
                <Info size={10} />
                Contact Ops to upgrade your plan
              </div>
            )}

            {/* ── Manage Billing button (for paid subscriptions with Stripe) ── */}
            {hasStripeSubscription && isBillingAvailable && sub.status !== "CANCELLED" && (
              <Button
                variant="outline"
                size="sm"
                className="w-full h-9 text-xs rounded-xl border-[var(--anna-border)] text-[var(--anna-slate)] hover:bg-[var(--anna-bg)]"
                onClick={() => portalMutation.mutate()}
                disabled={portalMutation.isPending}
              >
                {portalMutation.isPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin mr-1.5" />
                    Opening…
                  </>
                ) : (
                  <>
                    <CreditCard size={14} className="mr-1.5" />
                    Manage Billing
                    <ExternalLink size={10} className="ml-1.5 opacity-50" />
                  </>
                )}
              </Button>
            )}

            {/* ── Ops cancel (when no Stripe integration) ── */}
            {sub.status === "ACTIVE" && !hasStripeSubscription && !isBillingAvailable && (
              <p className="text-[10px] text-[var(--anna-muted)]">
                Contact Ops to manage your subscription
              </p>
            )}
          </div>

          {/* ── CARE tier badge ── */}
          {sub.tier === "CARE" && sub.status === "ACTIVE" && (
            <div className="bg-[var(--anna-sage-light)] rounded-xl p-3 mt-2 border border-[var(--anna-sage)]/20">
              <div className="flex items-center gap-2">
                <Crown size={16} className="text-[var(--anna-sage-dark)]" />
                <div>
                  <p className="text-xs font-semibold text-[var(--anna-slate)]">Care Tier Active</p>
                  <p className="text-[10px] text-[var(--anna-muted)]">
                    Eldercare companion bundles + priority support
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── CANCELLED state ── */}
          {sub.status === "CANCELLED" && (
            <div className="bg-[var(--anna-error)]/10 rounded-xl p-3 mt-2 border border-[var(--anna-error)]/20">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-[var(--anna-error)]" />
                <div>
                  <p className="text-xs font-semibold text-[var(--anna-error)]">
                    Subscription Cancelled
                  </p>
                  <p className="text-[10px] text-[var(--anna-muted)]">
                    {isBillingAvailable
                      ? "You can reactivate your subscription from the Stripe billing portal."
                      : "Contact Ops to reactivate."}
                  </p>
                </div>
              </div>
              {isBillingAvailable && hasStripeSubscription && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs rounded-lg mt-2 border-[var(--anna-border)] text-[var(--anna-slate)]"
                  onClick={() => portalMutation.mutate()}
                  disabled={portalMutation.isPending}
                >
                  {portalMutation.isPending ? (
                    <>
                      <Loader2 size={12} className="animate-spin mr-1" />
                      Opening…
                    </>
                  ) : (
                    <>
                      <ExternalLink size={12} className="mr-1" />
                      Open Billing Portal
                    </>
                  )}
                </Button>
              )}
            </div>
          )}

          {/* ── PAST_DUE state ── */}
          {sub.status === "PAST_DUE" && (
            <div className="bg-[var(--anna-warning)]/10 rounded-xl p-3 mt-2 border border-[var(--anna-warning)]/20">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-[var(--anna-warning)]" />
                <div>
                  <p className="text-xs font-semibold text-[var(--anna-warning)]">
                    Payment Overdue
                  </p>
                  <p className="text-[10px] text-[var(--anna-muted)]">
                    Please update your payment method to continue using Anna.I services.
                  </p>
                </div>
              </div>
              {isBillingAvailable && hasStripeSubscription && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs rounded-lg mt-2 border-[var(--anna-warning)]/30 text-[var(--anna-warning)]"
                  onClick={() => portalMutation.mutate()}
                  disabled={portalMutation.isPending}
                >
                  {portalMutation.isPending ? (
                    <>
                      <Loader2 size={12} className="animate-spin mr-1" />
                      Opening…
                    </>
                  ) : (
                    <>
                      <CreditCard size={12} className="mr-1" />
                      Update Payment Method
                    </>
                  )}
                </Button>
              )}
            </div>
          )}
        </div>
      ) : (
        /* ── No subscription ── */
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-[var(--anna-bg)] flex items-center justify-center">
            <Crown size={16} className="text-[var(--anna-muted)]" />
          </div>
          <div>
            <p className="text-sm font-medium text-[var(--anna-slate)]">Home Tier</p>
            <p className="text-xs text-[var(--anna-muted)]">Free tier included</p>
          </div>
        </div>
      )}
    </div>
  );
}
