"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAnnaStore } from "@/lib/store";
import { CategoryIcon, getCategoryLabel } from "./category-icon";
import { JobTypeSelector } from "./job-type-selector";
import { QuoteBuilder } from "./quote-builder";
import { MediaUploader, type UploadedFile } from "./media-uploader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  formatSgd,
  formatDate,
  CATEGORY_DEFAULTS,
  type ServiceCategory,
  type RecurrencePattern,
  type ServiceJobType,
} from "@/lib/types";
import type { QuoteResult } from "@/lib/quote-calculator";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ArrowRight, Calendar, Clock, ChevronRight, Package, Truck, Ticket, Check, X, Loader2, Sparkles } from "lucide-react";
import { useDynamicPricing } from "@/hooks/use-dynamic-pricing";

const RECURRENCE_OPTIONS: {
  value: RecurrencePattern;
  label: string;
  desc: string;
}[] = [
  { value: "ONE_OFF", label: "One-off", desc: "Just this once" },
  { value: "WEEKLY", label: "Weekly", desc: "Every week" },
  { value: "FORTNIGHTLY", label: "Fortnightly", desc: "Every 2 weeks" },
  { value: "MONTHLY", label: "Monthly", desc: "Once a month" },
];

// Eligible-voucher response item — comes from the existing (previously dead)
// GET /api/household/vouchers/eligible endpoint. We pick it up here so the
// household no longer has to type their code by hand.
interface EligibleVoucher {
  voucherId: string;
  code: string;
  campaignName: string;
  campaignType: string;
  targetCategory: string | null;
  discountType: string | null;
  discountValue: number | null;
  minOrderValueCents: number;
  maxDiscountCapCents: number;
  expiresAt: string | null;
  ineligibleReason?: string | null;
}

interface BookingFormProps {
  category: ServiceCategory;
  initialJobType?: ServiceJobType | null;
  initialInstructions?: string;
  initialAmountCents?: number;
  /** Promo code to pre-fill (set by My Vouchers → Book Now). */
  initialPromoCode?: string;
  onBack: () => void;
  onSuccess: () => void;
  backLabel?: string;
}

export function BookingForm({
  category,
  initialJobType,
  initialInstructions,
  initialAmountCents,
  initialPromoCode,
  onBack,
  onSuccess,
  backLabel,
}: BookingFormProps) {
  const { selectedHouseholdId } = useAnnaStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedJobType, setSelectedJobType] = useState<ServiceJobType | null>(initialJobType ?? null);
  const [instructions, setInstructions] = useState(initialInstructions ?? "");
  const { getPrice } = useDynamicPricing();
  const [amountCents, setAmountCents] = useState(
    initialAmountCents ?? (initialJobType ? initialJobType.basePriceCents : getPrice(category))
  );
  const [recurrence, setRecurrence] = useState<RecurrencePattern>("ONE_OFF");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("10:00");
  // Laundry-specific: pick-up and delivery date/time
  const [pickupDate, setPickupDate] = useState("");
  const [pickupTime, setPickupTime] = useState("09:00");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [deliveryTime, setDeliveryTime] = useState("18:00");
  const isLaundry = category === "LAUNDRY";

  // Today's date in YYYY-MM-DD format (used as min for date picker)
  const todayISO = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Singapore" });
  const [photos, setPhotos] = useState<UploadedFile[]>([]);
  const [videos, setVideos] = useState<UploadedFile[]>([]);

  // Quote state
  const [quoteResult, setQuoteResult] = useState<QuoteResult | null>(null);
  const [quoteFieldValues, setQuoteFieldValues] = useState<Record<string, number>>({});
  const [quoteSelectedAddOns, setQuoteSelectedAddOns] = useState<string[]>([]);
  const [quotationId, setQuotationId] = useState<string | null>(null);

  // ── Discount code state ──
  // seeded from `initialPromoCode` (My Vouchers → Book Now) so the wallet
  // flow auto-applies the chosen voucher.
  const [promoCode, setPromoCode] = useState(initialPromoCode ?? "");
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoDiscountCents, setPromoDiscountCents] = useState(0);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  // "Re-applying voucher…" indicator — shown when the quote changes after a
  // voucher is applied and we silently re-validate via /api/marketing/validate.
  const [promoRevalidating, setPromoRevalidating] = useState(false);

  // Eligible vouchers (auto-detected from the wallet based on amount + category)
  const [eligibleVouchers, setEligibleVouchers] = useState<EligibleVoucher[]>([]);
  const [eligibleLoading, setEligibleLoading] = useState(false);

  // Latest amount snapshot — refs let callbacks read the current value
  // WITHOUT being re-created on every change. This is the root-cause fix
  // for the silent-reset bug (audit proposal A): `handleQuoteChange` was
  // previously a `useCallback([promoApplied])` which flipped identity every
  // time promo state changed → QuoteBuilder's `useEffect([…, onQuoteChange])`
  // re-fired → handleQuoteChange saw promoApplied=true and reset it.
  const promoAppliedRef = useRef(promoApplied);
  promoAppliedRef.current = promoApplied;
  const promoCodeRef = useRef(promoCode);
  promoCodeRef.current = promoCode;
  const amountRef = useRef(amountCents);
  amountRef.current = amountCents;
  const categoryRef = useRef(category);
  categoryRef.current = category;
  const householdRef = useRef(selectedHouseholdId);
  householdRef.current = selectedHouseholdId;

  const finalAmountCents = amountCents - (promoApplied ? promoDiscountCents : 0);

  function selectJobType(jt: ServiceJobType) {
    if (selectedJobType?.id === jt.id) {
      setSelectedJobType(null);
      setQuoteResult(null);
      setAmountCents(getPrice(category));
    } else {
      setSelectedJobType(jt);
      setQuoteResult(null);
      setAmountCents(jt.basePriceCents);
    }
  }

  // ── Quote change handler ──
  // Stable identity (no promoApplied in deps) — fixes the silent-reset bug.
  // Promo reset on amount change moved OUT of this callback into a
  // dedicated useEffect below that watches `amountCents`.
  const handleQuoteChange = useCallback(
    (result: QuoteResult | null, fieldValues: Record<string, number>, selectedAddOns: string[]) => {
      if (result) {
        setQuoteResult(result);
        setAmountCents(result.totalCents);
      }
      setQuoteFieldValues(fieldValues);
      setQuoteSelectedAddOns(selectedAddOns);
    },
    []
  );

  // ── Auto re-validation when amount changes AND a voucher is applied ──
  // (Audit proposal G §3 — replaces the old "silently reset promoApplied"
  // behaviour. We now re-validate via /api/marketing/validate so the
  // discount tracks the new total. If still valid, update the discount;
  // if invalid, surface the reason and reset.)
  const prevAmountRef = useRef(amountCents);
  useEffect(() => {
    if (!promoAppliedRef.current) {
      prevAmountRef.current = amountCents;
      return;
    }
    if (prevAmountRef.current === amountCents) return;
    prevAmountRef.current = amountCents;

    let cancelled = false;
    const code = promoCodeRef.current.trim();
    if (!code || !householdRef.current) return;

    setPromoRevalidating(true);
    setPromoError(null);

    (async () => {
      try {
        const res = await fetch("/api/marketing/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            orderValueCents: amountCents,
            orderType: "job",
            category: categoryRef.current,
          }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.valid) {
          setPromoDiscountCents(data.discountCents || 0);
          setPromoApplied(true);
        } else {
          // Voucher no longer applies (e.g. min-spend now unmet) — surface
          // the reason and reset, so the Book Now button reflects the true
          // total the household will be charged.
          setPromoApplied(false);
          setPromoDiscountCents(0);
          setPromoError(
            data.reason
              ? `Your voucher no longer applies to this order: ${data.reason}`
              : "Your voucher no longer applies to this order"
          );
        }
      } catch {
        if (!cancelled) {
          setPromoError("Network error while re-validating voucher");
        }
      } finally {
        if (!cancelled) setPromoRevalidating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [amountCents]);

  // ── Eligible-vouchers picker ──
  // Debounced (300ms) fetch of GET /api/household/vouchers/eligible so the
  // household sees a "You have N vouchers available" picker above the manual
  // promo input. Clicking a picker item pre-fills promoCode + auto-applies.
  useEffect(() => {
    if (!selectedHouseholdId || amountCents <= 0) {
      setEligibleVouchers([]);
      return;
    }
    let cancelled = false;
    setEligibleLoading(true);
    const t = setTimeout(async () => {
      try {
        const url = `/api/household/vouchers/eligible?orderValueCents=${amountCents}&category=${category}`;
        const res = await fetch(url);
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && Array.isArray(data.vouchers)) {
          setEligibleVouchers(data.vouchers as EligibleVoucher[]);
        } else {
          setEligibleVouchers([]);
        }
      } catch {
        if (!cancelled) setEligibleVouchers([]);
      } finally {
        if (!cancelled) setEligibleLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [amountCents, category, selectedHouseholdId]);

  // ── Apply / remove promo code ──
  const handleApplyPromo = useCallback(async function handleApplyPromo(codeArg?: string) {
    const code = (codeArg ?? promoCodeRef.current).trim();
    if (!code || !householdRef.current) return;
    if (codeArg) setPromoCode(codeArg);
    setPromoLoading(true);
    setPromoError(null);
    try {
      const res = await fetch("/api/marketing/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          orderValueCents: amountRef.current,
          orderType: "job",
          category: categoryRef.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPromoError(data.error || "Failed to validate code");
        setPromoApplied(false);
        return;
      }
      if (!data.valid) {
        // Server returns a distinct reason for each of the 9+ voucher states
        // (Code not found / expired / suspended / removed / not-issued /
        // already-redeemed / min-spend / wrong-category / etc.) — surface it
        // verbatim so the household sees exactly what went wrong.
        setPromoError(data.reason || "Invalid code");
        setPromoApplied(false);
        return;
      }
      setPromoDiscountCents(data.discountCents || 0);
      setPromoApplied(true);
      setPromoError(null);
    } catch {
      setPromoError("Network error");
      setPromoApplied(false);
    } finally {
      setPromoLoading(false);
    }
  }, []);

  function handleRemovePromo() {
    const previousTotal = amountCents;
    setPromoApplied(false);
    setPromoDiscountCents(0);
    setPromoCode("");
    setPromoError(null);
    toast({
      title: "Voucher removed",
      description: `Price reverted to ${formatSgd(previousTotal)}`,
    });
  }

  // ── Auto-apply when initialPromoCode is provided (My Vouchers flow) ──
  // Runs ONCE on mount (after the eligible-vouchers effect picks up the
  // first amount). Using a ref guard so React 18 StrictMode double-invoke
  // doesn't trigger a second apply.
  const initialApplyRunRef = useRef(false);
  useEffect(() => {
    if (initialApplyRunRef.current) return;
    if (!initialPromoCode) return;
    if (!selectedHouseholdId) return;
    // Wait one tick for amountRef to be settled, then apply.
    initialApplyRunRef.current = true;
    setPromoCode(initialPromoCode);
    handleApplyPromo(initialPromoCode);
  }, [initialPromoCode, selectedHouseholdId, handleApplyPromo]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!category || !selectedHouseholdId) throw new Error("Missing household or category");

      let scheduledStart: string;
      let scheduledEnd: string | undefined = undefined;

      if (isLaundry) {
        scheduledStart = pickupDate
          ? new Date(`${pickupDate}T${pickupTime}:00`).toISOString()
          : new Date(Date.now() + 86400000).toISOString();
        if (deliveryDate) {
          scheduledEnd = new Date(`${deliveryDate}T${deliveryTime}:00`).toISOString();
        }
      } else {
        scheduledStart = scheduledDate
          ? new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString()
          : new Date(Date.now() + 86400000).toISOString();
      }

      // Create quotation if we have a job type
      let qId: string | null = quotationId;
      if (selectedJobType && !qId && quoteResult) {
        const quoteRes = await fetch("/api/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            householdId: selectedHouseholdId,
            jobTypeId: selectedJobType.id,
            fieldValues: quoteFieldValues,
            selectedAddOns: quoteSelectedAddOns,
          }),
        });
        if (quoteRes.ok) {
          const quoteData = await quoteRes.json();
          qId = quoteData.quotation.id;
        }
      }

      // Generate an idempotency key from the booking parameters so a
      // double-click or network retry doesn't create duplicate tasks.
      const idempotencyKey = `${selectedHouseholdId}:${category}:${qId ?? "noquote"}:${amountCents}:${Math.floor(Date.now() / 60_000)}`;

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          householdId: selectedHouseholdId,
          category,
          instructions: instructions.trim(),
          amountCents,
          discountCode: promoApplied ? promoCode.trim() : undefined,
          recurrencePattern: recurrence === "ONE_OFF" ? null : { type: recurrence, interval: 1 },
          scheduledStart,
          ...(scheduledEnd ? { scheduledEnd } : {}),
          jobTypeId: selectedJobType?.id,
          quotationId: qId,
          idempotencyKey,
          attachments: [...photos, ...videos].map(({ fileUrl, fileType, fileName, fileSize, mimeType }) => ({
            fileUrl,
            fileType,
            fileName,
            fileSize,
            mimeType,
          })),
        }),
      });
      if (!res.ok) {
        // B-7 FIX: Clean up orphaned quotation if task creation fails
        if (qId) {
          fetch(`/api/quote/cleanup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quotationId: qId }),
          }).catch(() => { /* best-effort cleanup */ });
        }
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error || "Failed to create task");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Task created successfully!" });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["household"] });
      queryClient.invalidateQueries({ queryKey: ["household-vouchers"] });
      onSuccess();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to create task";
      console.error("[BookingForm] mutation error:", err);
      toast({ title: "Booking failed", description: msg, variant: "destructive" });
    },
  });

  // Helper: look up an eligible voucher's minOrderValueCents to render
  // the "Spend $X more" hint on a picker entry whose min-spend isn't met.
  // (The eligible endpoint already filters those out, so we additionally
  //  fetch them via the wallet to surface the hint — done lazily by
  //  inspecting the wallet vouchers list.)

  return (
    <div className="space-y-5 anna-fade-in">
      {/* Back + Category chip */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-[var(--anna-muted)] hover:text-[var(--anna-slate)] transition-colors"
        >
          <ChevronRight size={14} className="rotate-180" />
          {backLabel ?? `${getCategoryLabel(category)} services`}
        </button>
      </div>

      <div>
        <h1 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)] mb-1">
          Book {getCategoryLabel(category)}
        </h1>
        <p className="text-sm text-[var(--anna-muted)]">
          {selectedJobType
            ? `Booking: ${selectedJobType.name}`
            : "Fill in the details to book this service"}
        </p>
      </div>

      {/* Selected job type chip (if came from Book Now) */}
      {initialJobType && selectedJobType && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--anna-sage-light)]/50 border border-[var(--anna-sage)]/20">
          <CategoryIcon category={category} size={14} />
          <span className="text-sm font-medium text-[var(--anna-slate)]">{selectedJobType.name}</span>
          <button
            onClick={() => {
              setSelectedJobType(null);
              setQuoteResult(null);
              setAmountCents(getPrice(category));
            }}
            className="ml-auto text-[10px] text-[var(--anna-muted)] hover:text-[var(--anna-slate)] transition-colors"
          >
            change
          </button>
        </div>
      )}

      {/* Job Type Selection (optional) */}
      <JobTypeSelector
        category={category}
        selectedJobType={selectedJobType}
        onSelect={selectJobType}
      />

      {/* QuoteBuilder — only shown when a specific job type is selected */}
      {selectedJobType && (
        <QuoteBuilder
          jobType={selectedJobType}
          onQuoteChange={handleQuoteChange}
          quotationId={quotationId}
          // Pass the live discount so the quote card can show the
          // 3-line breakdown (original / discount / final) right inside
          // the quote card, not only above the Book Now button.
          appliedDiscountCents={promoApplied ? promoDiscountCents : 0}
        />
      )}

      {/* Amount */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
          Amount
        </Label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--anna-muted)] font-data">
            SGD $
          </span>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={(amountCents / 100).toFixed(2)}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setAmountCents(Number.isFinite(val) && val >= 0 ? Math.round(val * 100) : 0);
            }}
            className="pl-14 rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] font-data text-sm focus-visible:ring-[var(--anna-sage)]/30"
          />
        </div>
        {quoteResult ? (
          <p className="text-[10px] text-[var(--anna-muted)]">
            Auto-calculated from {selectedJobType?.name}. Edit to override.
          </p>
        ) : (
          <p className="text-[10px] text-[var(--anna-muted)]">
            Default estimate for {getCategoryLabel(category)}. Edit to customize.
          </p>
        )}
      </div>

      {/* Promo Code section: picker first (auto-detected eligible vouchers),
          then manual code input. Replaces the false "auto-applied at
          checkout" copy with explicit "selectable at checkout". */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
          <Ticket size={12} />
          Promo Code <span className="font-normal text-[var(--anna-muted)]">(optional)</span>
        </Label>

        {/* Eligible vouchers picker (audit proposal C) */}
        {amountCents > 0 && (eligibleLoading || eligibleVouchers.length > 0) && (
          <div className="rounded-xl bg-[var(--anna-sage-light)]/30 border border-[var(--anna-sage)]/20 p-2.5 space-y-1.5">
            <p className="text-[10px] text-[var(--anna-sage-dark)] flex items-center gap-1 font-medium">
              <Sparkles size={10} />
              {eligibleLoading
                ? "Checking your wallet for vouchers…"
                : eligibleVouchers.length === 1
                  ? "1 voucher available for this order"
                  : `${eligibleVouchers.length} vouchers available for this order`}
            </p>
            {!eligibleLoading && eligibleVouchers.map((v) => (
              <button
                key={v.voucherId}
                type="button"
                onClick={() => {
                  setPromoCode(v.code);
                  handleApplyPromo(v.code);
                }}
                disabled={promoLoading || promoRevalidating}
                className={cn(
                  "w-full flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--anna-white)] border border-[var(--anna-sage)]/30 hover:border-[var(--anna-sage)] hover:bg-[var(--anna-sage-light)]/40 transition-all text-left",
                  promoApplied && promoCode === v.code && "ring-1 ring-[var(--anna-sage)] bg-[var(--anna-sage-light)]/50"
                )}
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[var(--anna-sage-dark)] truncate">
                    {v.discountType === "PERCENTAGE"
                      ? `${v.discountValue}% OFF`
                      : v.discountValue
                        ? `$${v.discountValue} OFF`
                        : "Special Offer"}
                  </p>
                  <p className="text-[10px] text-[var(--anna-muted)] truncate">{v.campaignName}</p>
                  {v.minOrderValueCents > 0 && (
                    <p className="text-[9px] text-[var(--anna-muted)]">
                      Min spend {formatSgd(v.minOrderValueCents)}
                      {v.expiresAt && ` · Exp ${formatDate(v.expiresAt)}`}
                    </p>
                  )}
                </div>
                <span className="text-[10px] font-medium text-[var(--anna-sage-dark)] shrink-0">
                  {promoApplied && promoCode === v.code ? (
                    <span className="flex items-center gap-0.5"><Check size={10} /> Applied</span>
                  ) : (
                    "Use"
                  )}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Applied voucher panel OR manual code input */}
        {promoApplied ? (
          <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                {promoRevalidating ? (
                  <Loader2 size={14} className="text-emerald-600 animate-spin" />
                ) : (
                  <Check size={14} className="text-emerald-600" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-emerald-900 truncate">
                  {promoCode.toUpperCase()} applied
                </p>
                <p className="text-[10px] text-emerald-700">
                  {promoRevalidating
                    ? "Re-applying voucher…"
                    : `Save ${formatSgd(promoDiscountCents)} · Final: ${formatSgd(finalAmountCents)}`}
                </p>
              </div>
            </div>
            <button
              onClick={handleRemovePromo}
              className="text-emerald-600 hover:text-emerald-800 shrink-0"
              type="button"
              aria-label="Remove voucher"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type="text"
                value={promoCode}
                onChange={(e) => {
                  setPromoCode(e.target.value.toUpperCase());
                  setPromoError(null);
                }}
                placeholder="Enter your voucher code"
                className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] font-data text-sm uppercase placeholder:normal-case focus-visible:ring-[var(--anna-sage)]/30"
              />
            </div>
            <Button
              type="button"
              onClick={() => handleApplyPromo()}
              disabled={!promoCode.trim() || promoLoading || promoRevalidating}
              variant="outline"
              className="h-10 px-4 rounded-xl border-[var(--anna-border)] text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)]"
            >
              {promoLoading ? <Loader2 size={14} className="animate-spin" /> : "Apply"}
            </Button>
          </div>
        )}
        {promoError && (
          <p className="text-[10px] text-rose-600 flex items-center gap-1">
            <X size={10} />
            {promoError}
          </p>
        )}
      </div>

      {/* Instructions */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
          Instructions <span className="font-normal text-[var(--anna-muted)]">(optional)</span>
        </Label>
        <Textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Describe what needs to be done..."
          className="min-h-[100px] rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] resize-none text-sm focus-visible:ring-[var(--anna-sage)]/30"
        />
      </div>

      {/* Photo & Video Uploads */}
      <div className="bg-[var(--anna-white)] rounded-2xl p-4 border border-[var(--anna-border)]">
        <MediaUploader
          photos={photos}
          videos={videos}
          onPhotosChange={setPhotos}
          onVideosChange={setVideos}
          maxPhotos={5}
          maxVideos={2}
        />
      </div>

      {/* Recurrence */}
      <div className="space-y-3">
        <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
          Recurrence
        </Label>
        <RadioGroup
          value={recurrence}
          onValueChange={(v) => setRecurrence(v as RecurrencePattern)}
          className="grid grid-cols-2 lg:grid-cols-4 gap-2"
        >
          {RECURRENCE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              htmlFor={`booking-${opt.value}`}
              className={cn(
                "flex flex-col p-3 rounded-xl border cursor-pointer transition-all",
                recurrence === opt.value
                  ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/50"
                  : "border-[var(--anna-border)] bg-[var(--anna-white)] hover:border-[var(--anna-sage)]/40"
              )}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value={opt.value} id={`booking-${opt.value}`} className="sr-only" />
                <span
                  className={cn(
                    "w-3.5 h-3.5 rounded-full border-2 transition-colors",
                    recurrence === opt.value
                      ? "border-[var(--anna-sage)] bg-[var(--anna-sage)]"
                      : "border-[var(--anna-border)]"
                  )}
                >
                  {recurrence === opt.value && (
                    <div className="w-full h-full rounded-full flex items-center justify-center">
                      <div className="w-1 h-1 bg-white rounded-full" />
                    </div>
                  )}
                </span>
                <span className="text-sm font-medium text-[var(--anna-slate)]">
                  {opt.label}
                </span>
              </div>
              <span className="text-[10px] text-[var(--anna-muted)] ml-5.5 mt-0.5">
                {opt.desc}
              </span>
            </label>
          ))}
        </RadioGroup>
      </div>

      {/* Schedule */}
      {isLaundry ? (
        <div className="space-y-4">
          <div className="bg-amber-50/50 border border-amber-200/50 rounded-xl p-3 space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-amber-700">
              <Package size={12} className="inline mr-1" />
              Pick-up Date & Time
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <Input type="date" value={pickupDate} min={todayISO}
                onChange={(e) => setPickupDate(e.target.value)}
                className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30" />
              <Input type="time" value={pickupTime}
                onChange={(e) => setPickupTime(e.target.value)}
                className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30" />
            </div>
          </div>
          <div className="bg-[var(--anna-sage-light)]/30 border border-[var(--anna-sage)]/20 rounded-xl p-3 space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-sage-dark)]">
              <Truck size={12} className="inline mr-1" />
              Delivery Date & Time
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <Input type="date" value={deliveryDate} min={pickupDate || todayISO}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30" />
              <Input type="time" value={deliveryTime}
                onChange={(e) => setDeliveryTime(e.target.value)}
                className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30" />
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              <Calendar size={12} className="inline mr-1" />
              Date
            </Label>
            <Input type="date" value={scheduledDate} min={todayISO}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              <Clock size={12} className="inline mr-1" />
              Time
            </Label>
            <Input type="time" value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
              className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30" />
          </div>
        </div>
      )}

      {/* Book Now Button — always shows the price the user will be charged,
          whether or not a voucher is applied. Disabled while the voucher is
          mid-validation so the user can't submit a discountless task by
          accident (audit proposal G §2). */}
      <div className="space-y-2">
        {promoApplied && promoDiscountCents > 0 && (
          <div className="flex items-center justify-between text-xs px-1">
            <span className="text-[var(--anna-muted)] line-through font-data">
              {formatSgd(amountCents)}
            </span>
            <span className="text-emerald-600 font-medium">−{formatSgd(promoDiscountCents)}</span>
          </div>
        )}
        <Button
          onClick={() => createMutation.mutate()}
          disabled={
            createMutation.isPending ||
            !amountCents ||
            amountCents <= 0 ||
            promoLoading ||
            promoRevalidating
          }
          className="w-full bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl h-12 text-sm font-semibold"
        >
          {createMutation.isPending
            ? "Booking..."
            : `Book Now · ${formatSgd(finalAmountCents)}`}
          <ArrowRight size={16} className="ml-2" />
        </Button>
      </div>
    </div>
  );
}

// Reference imported constant to avoid TS "unused" warnings in some builds.
void CATEGORY_DEFAULTS;
