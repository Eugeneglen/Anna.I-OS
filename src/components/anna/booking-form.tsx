"use client";

import { useState, useCallback } from "react";
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
  CATEGORY_DEFAULTS,
  type ServiceCategory,
  type RecurrencePattern,
  type ServiceJobType,
} from "@/lib/types";
import type { QuoteResult } from "@/lib/quote-calculator";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ArrowRight, Calendar, Clock, ChevronRight, Package, Truck, Ticket, Check, X, Loader2 } from "lucide-react";
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

interface BookingFormProps {
  category: ServiceCategory;
  initialJobType?: ServiceJobType | null;
  initialInstructions?: string;
  initialAmountCents?: number;
  onBack: () => void;
  onSuccess: () => void;
  backLabel?: string;
}

export function BookingForm({ category, initialJobType, initialInstructions, initialAmountCents, onBack, onSuccess, backLabel }: BookingFormProps) {
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

  // Phase 3: Discount code state
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoDiscountCents, setPromoDiscountCents] = useState(0);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);

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

  const handleQuoteChange = useCallback(
    (result: QuoteResult | null, fieldValues: Record<string, number>, selectedAddOns: string[]) => {
      if (result) {
        setQuoteResult(result);
        setAmountCents(result.totalCents);
      }
      setQuoteFieldValues(fieldValues);
      setQuoteSelectedAddOns(selectedAddOns);
      // Reset promo if amount changed
      if (promoApplied) {
        setPromoApplied(false);
        setPromoDiscountCents(0);
      }
    },
    [promoApplied]
  );

  // Phase 3: Apply / remove promo code
  async function handleApplyPromo() {
    if (!promoCode.trim() || !selectedHouseholdId) return;
    setPromoLoading(true);
    setPromoError(null);
    try {
      const res = await fetch("/api/marketing/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: promoCode.trim(),
          orderValueCents: amountCents,
          orderType: "job",
          category,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPromoError(data.error || "Failed to validate code");
        setPromoApplied(false);
        return;
      }
      if (!data.valid) {
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
  }

  function handleRemovePromo() {
    setPromoApplied(false);
    setPromoDiscountCents(0);
    setPromoCode("");
    setPromoError(null);
  }

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
        throw new Error("Failed to create task");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Task created successfully!" });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["household"] });
      onSuccess();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to create task";
      console.error("[BookingForm] mutation error:", err);
      toast({ title: "Booking failed", description: msg, variant: "destructive" });
    },
  });

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

      {/* Phase 3: Promo Code */}
      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] flex items-center gap-1.5">
          <Ticket size={12} />
          Promo Code <span className="font-normal text-[var(--anna-muted)]">(optional)</span>
        </Label>
        {promoApplied ? (
          <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
                <Check size={14} className="text-emerald-600" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-emerald-900 truncate">
                  {promoCode.toUpperCase()} applied
                </p>
                <p className="text-[10px] text-emerald-700">
                  Save {formatSgd(promoDiscountCents)} · Final: {formatSgd(finalAmountCents)}
                </p>
              </div>
            </div>
            <button
              onClick={handleRemovePromo}
              className="text-emerald-600 hover:text-emerald-800 shrink-0"
              type="button"
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
                placeholder="e.g. ANNA-XXXX"
                className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] font-data text-sm uppercase placeholder:normal-case focus-visible:ring-[var(--anna-sage)]/30"
              />
            </div>
            <Button
              type="button"
              onClick={handleApplyPromo}
              disabled={!promoCode.trim() || promoLoading}
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

      {/* Book Now Button */}
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
          disabled={createMutation.isPending || !amountCents || amountCents <= 0}
          className="w-full bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl h-12 text-sm font-semibold"
        >
          {createMutation.isPending
            ? "Booking..."
            : promoApplied
              ? `Book Now · ${formatSgd(finalAmountCents)}`
              : "Book Now"}
          <ArrowRight size={16} className="ml-2" />
        </Button>
      </div>
    </div>
  );
}