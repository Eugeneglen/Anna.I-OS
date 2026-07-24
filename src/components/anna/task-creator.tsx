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
import { ArrowRight, Calendar, Clock } from "lucide-react";
import { useDynamicPricing } from "@/hooks/use-dynamic-pricing";

const CATEGORIES: ServiceCategory[] = [
  "CLEANING",
  "LAUNDRY",
  "AIRCON",
  "PLUMBING",
  "ELECTRICAL",
  "PAINTING",
  "PEST_CONTROL",
  "HANDYMAN",
  "LOCKSMITH",
  "APPLIANCE_REPAIR",
];

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

// Compute initial state from store once (before component renders)
function getInitialCategoryState(): { category: ServiceCategory | null; amountCents: number } {
  const preselected = useAnnaStore.getState().preselectedCategory;
  if (preselected) {
    useAnnaStore.setState({ preselectedCategory: null });
    return { category: preselected, amountCents: CATEGORY_DEFAULTS[preselected].amount };
  }
  return { category: null, amountCents: 0 };
}

export function TaskCreator() {
  const { selectedHouseholdId, setActiveTab } = useAnnaStore();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Today's date in YYYY-MM-DD format (used as min for date picker)
  const todayISO = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Singapore" });

  const [initialState] = useState(getInitialCategoryState);
  const { getPrice } = useDynamicPricing();
  const [selectedCategory, setSelectedCategory] = useState<ServiceCategory | null>(initialState.category);
  const [selectedJobType, setSelectedJobType] = useState<ServiceJobType | null>(null);
  const [instructions, setInstructions] = useState("");
  const [amountCents, setAmountCents] = useState(initialState.amountCents);
  const [recurrence, setRecurrence] = useState<RecurrencePattern>("ONE_OFF");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("10:00");
  const [photos, setPhotos] = useState<UploadedFile[]>([]);
  const [videos, setVideos] = useState<UploadedFile[]>([]);

  // Quote state
  const [quoteResult, setQuoteResult] = useState<QuoteResult | null>(null);
  const [quoteFieldValues, setQuoteFieldValues] = useState<Record<string, number>>({});
  const [quoteSelectedAddOns, setQuoteSelectedAddOns] = useState<string[]>([]);
  const [quotationId, setQuotationId] = useState<string | null>(null);

  function selectCategory(cat: ServiceCategory) {
    setSelectedCategory(cat);
    setSelectedJobType(null);
    setQuoteResult(null);
    setQuoteFieldValues({});
    setQuoteSelectedAddOns([]);
    setAmountCents(getPrice(cat));
  }

  function selectJobType(jt: ServiceJobType) {
    if (selectedJobType?.id === jt.id) {
      // Deselect — go back to custom
      setSelectedJobType(null);
      setQuoteResult(null);
      if (selectedCategory) {
        setAmountCents(getPrice(selectedCategory));
      }
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
    },
    []
  );

  function resetForm() {
    setSelectedCategory(null);
    setSelectedJobType(null);
    setInstructions("");
    setAmountCents(0);
    setRecurrence("ONE_OFF");
    setScheduledDate("");
    setPhotos([]);
    setVideos([]);
    setQuoteResult(null);
    setQuotationId(null);
    setQuoteFieldValues({});
    setQuoteSelectedAddOns([]);
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCategory || !instructions.trim()) throw new Error("Missing fields");
      const scheduledStart = scheduledDate
        ? new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString()
        : new Date(Date.now() + 86400000).toISOString();

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
          category: selectedCategory,
          instructions: instructions.trim(),
          amountCents,
          recurrencePattern: recurrence === "ONE_OFF" ? null : { type: recurrence, interval: 1 },
          scheduledStart,
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
      if (!res.ok) throw new Error("Failed to create task");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Task created successfully!" });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["household"] });
      resetForm();
      setActiveTab("dashboard");
    },
    onError: () => {
      toast({ title: "Failed to create task", variant: "destructive" });
    },
  });

  return (
    <div className="p-4 lg:p-6 pb-20 md:pb-0 anna-fade-in">
      <h1 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)] mb-1">
        New Task
      </h1>
      <p className="text-sm text-[var(--anna-muted)] mb-6">
        {selectedCategory
          ? `Configure your ${getCategoryLabel(selectedCategory).toLowerCase()} task`
          : "Select a service category to get started"}
      </p>

      {/* Step 1: Category Selection — hidden once a category is picked */}
      <div className={cn("mb-6", selectedCategory && "hidden")}>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
          Category
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => selectCategory(cat)}
              className="flex flex-col items-center gap-3 p-4 rounded-2xl border-2 border-[var(--anna-border)] bg-[var(--anna-white)] hover:border-[var(--anna-sage)]/40 transition-all"
            >
              <CategoryIcon category={cat} size={24} />
              <span className="text-sm font-semibold text-[var(--anna-slate)]">
                {getCategoryLabel(cat)}
              </span>
              <span className="font-data text-xs text-[var(--anna-muted)]">
                from {formatSgd(getPrice(cat))}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Step 2+: Task Form — shown once a category is selected */}
      {selectedCategory && (
        <div className="space-y-5 anna-fade-in">
          {/* Selected category chip + change button */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setSelectedCategory(null);
                setSelectedJobType(null);
                setQuoteResult(null);
                setAmountCents(0);
                setInstructions("");
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[var(--anna-border)] bg-[var(--anna-white)] hover:border-[var(--anna-sage)]/40 transition-all text-sm"
            >
              <CategoryIcon category={selectedCategory} size={14} />
              <span className="font-medium text-[var(--anna-slate)]">
                {getCategoryLabel(selectedCategory)}
              </span>
              <span className="text-[10px] text-[var(--anna-muted)]">change</span>
            </button>
          </div>

          {/* Job Type Selection (optional — only shown if job types exist) */}
          <JobTypeSelector
            category={selectedCategory}
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
                onChange={(e) =>
                  setAmountCents(Math.round(parseFloat(e.target.value) * 100))
                }
                className="pl-14 rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] font-data text-sm focus-visible:ring-[var(--anna-sage)]/30"
              />
            </div>
            {quoteResult ? (
              <p className="text-[10px] text-[var(--anna-muted)]">
                Auto-calculated from {selectedJobType?.name}. Edit to override.
              </p>
            ) : (
              <p className="text-[10px] text-[var(--anna-muted)]">
                Default estimate for {getCategoryLabel(selectedCategory)}. Edit to customize.
              </p>
            )}
          </div>

          {/* Instructions */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Instructions
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
                  htmlFor={opt.value}
                  className={cn(
                    "flex flex-col p-3 rounded-xl border cursor-pointer transition-all",
                    recurrence === opt.value
                      ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/50"
                      : "border-[var(--anna-border)] bg-[var(--anna-white)] hover:border-[var(--anna-sage)]/40"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value={opt.value} id={opt.value} className="sr-only" />
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                <Calendar size={12} className="inline mr-1" />
                Date
              </Label>
              <Input
                type="date"
                value={scheduledDate}
                min={todayISO}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                <Clock size={12} className="inline mr-1" />
                Time
              </Label>
              <Input
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30"
              />
            </div>
          </div>

          {/* Create Button */}
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!instructions.trim() || createMutation.isPending || amountCents <= 0}
            className="w-full bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl h-12 text-sm font-semibold"
          >
            {createMutation.isPending ? "Creating..." : "Create Task"}
            <ArrowRight size={16} className="ml-2" />
          </Button>
        </div>
      )}
    </div>
  );
}