"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CAMPAIGN_QUERY_KEYS } from "./campaign-styles";

// ============================================================
// Anna.I — Ops Campaign Create Dialog
// ============================================================
// Modal for creating a new campaign + its discount rule. Owns
// its own form state, posts to /api/ops/campaigns, and shows
// field-level errors returned by the Zod schema on the API.
// Dollar inputs (minOrderValue, maxDiscountCap) are converted
// to cents on submit; dates become ISO strings.
// ============================================================

interface CampaignCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TYPE_OPTIONS = [
  { value: "FIRST_TIME", label: "First-Time" },
  { value: "CROSS_SELL", label: "Cross-Sell" },
  { value: "UPGRADE", label: "Upgrade" },
  { value: "REFERRAL", label: "Referral" },
  { value: "PUBLIC_PROMO", label: "Public Promo" },
  { value: "OTHER", label: "Other" },
];

const DISCOUNT_TYPE_OPTIONS = [
  { value: "PERCENTAGE", label: "Percentage (%)" },
  { value: "FIXED_AMOUNT", label: "Fixed Amount ($)" },
];

const APPLIES_TO_OPTIONS = [
  { value: "BOTH", label: "Both (Subscription + Job)" },
  { value: "SUBSCRIPTION_FEE", label: "Subscription Fee" },
  { value: "JOB_COMMISSION", label: "Job Commission" },
];

const ELIGIBILITY_OPTIONS = [
  { value: "ANY", label: "Anyone" },
  { value: "FIRST_TIME_HOUSEHOLD_ONLY", label: "First-time household only" },
  { value: "EXISTING_HOUSEHOLD", label: "Existing household only" },
];

const TIER_OPTIONS = [
  { value: "ALL", label: "All tiers" },
  { value: "HOME", label: "Home tier" },
  { value: "CARE", label: "Care tier" },
];

function dollarsToCents(val: string): number | undefined {
  if (!val.trim()) return undefined;
  const n = parseFloat(val);
  if (isNaN(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

export function CampaignCreateDialog({
  open,
  onOpenChange,
}: CampaignCreateDialogProps) {
  const queryClient = useQueryClient();

  // ── Required fields ──
  const [name, setName] = useState("");
  const [type, setType] = useState("FIRST_TIME");
  const [discountType, setDiscountType] = useState("PERCENTAGE");
  const [discountValue, setDiscountValue] = useState("");

  // ── Optional fields ──
  const [description, setDescription] = useState("");
  const [appliesTo, setAppliesTo] = useState("BOTH");
  const [targetTier, setTargetTier] = useState("ALL");
  const [targetCategory, setTargetCategory] = useState("");
  const [eligibility, setEligibility] = useState("ANY");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [minOrderValue, setMinOrderValue] = useState("");
  const [maxDiscountCap, setMaxDiscountCap] = useState("");
  const [stackable, setStackable] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>(
    {}
  );

  function resetForm() {
    setName("");
    setType("FIRST_TIME");
    setDiscountType("PERCENTAGE");
    setDiscountValue("");
    setDescription("");
    setAppliesTo("BOTH");
    setTargetTier("ALL");
    setTargetCategory("");
    setEligibility("ANY");
    setMaxRedemptions("");
    setStartDate("");
    setEndDate("");
    setMinOrderValue("");
    setMaxDiscountCap("");
    setStackable(false);
    setFieldErrors({});
  }

  const mutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch("/api/ops/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The API returns `{ error: "..." }` (string) on 500/409 and
        // `{ error: { field: [msgs] } }` (object) on 400 (Zod flatten).
        // We serialise the error payload as JSON in the thrown message
        // so onError can parse it back into field-level UI.
        throw new Error(JSON.stringify(data.error));
      }
      return { data };
    },
    onSuccess: (vars) => {
      const { data } = vars;
      toast.success(
        `Campaign “${data?.campaign?.name || "Created"}” created`
      );
      queryClient.invalidateQueries({ queryKey: CAMPAIGN_QUERY_KEYS.list });
      resetForm();
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      const msg = error instanceof Error ? error.message : "Failed";
      try {
        const parsed = JSON.parse(msg);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const errors = parsed as Record<string, string[]>;
          setFieldErrors(errors);
          const firstKey = Object.keys(errors)[0];
          const firstMsg = errors[firstKey]?.[0];
          toast.error(firstMsg || "Please fix the highlighted fields");
          return;
        }
        if (typeof parsed === "string" && parsed.length > 0) {
          toast.error(parsed);
          return;
        }
      } catch {
        // not JSON — fall through
      }
      toast.error("Failed to create campaign");
    },
  });

  function handleSubmit() {
    setFieldErrors({});
    const dv = parseFloat(discountValue);
    if (isNaN(dv) || dv <= 0) {
      setFieldErrors({ discountValue: ["Enter a positive number"] });
      toast.error("Enter a positive discount value");
      return;
    }

    const payload: Record<string, unknown> = {
      name: name.trim(),
      type,
      discountType,
      discountValue: dv,
      appliesTo,
      eligibility,
      stackable,
    };

    if (description.trim()) payload.description = description.trim();
    if (targetTier !== "ALL") payload.targetTier = targetTier;
    if (targetCategory.trim()) payload.targetCategory = targetCategory.trim();
    if (maxRedemptions.trim()) {
      const n = parseInt(maxRedemptions, 10);
      if (!isNaN(n) && n > 0) payload.maxRedemptions = n;
    }
    if (startDate) payload.startDate = new Date(startDate).toISOString();
    if (endDate) payload.endDate = new Date(endDate).toISOString();

    const minCents = dollarsToCents(minOrderValue);
    if (minCents !== undefined) payload.minOrderValueCents = minCents;
    const maxCents = dollarsToCents(maxDiscountCap);
    if (maxCents !== undefined) payload.maxDiscountCapCents = maxCents;

    mutation.mutate(payload);
  }

  const isValid =
    name.trim().length > 0 &&
    discountValue.trim() !== "" &&
    !isNaN(parseFloat(discountValue)) &&
    parseFloat(discountValue) > 0;

  function handleOpenChange(open: boolean) {
    if (!open) {
      // Reset on close so reopening starts fresh.
      resetForm();
    }
    onOpenChange(open);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border-[var(--anna-border)] bg-[var(--anna-white)] anna-scroll">
        <DialogHeader>
          <DialogTitle className="text-lg text-[var(--anna-slate)]">
            New Campaign
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--anna-muted)]">
            Create a marketing campaign and its discount rule. The campaign
            starts as a draft — activate it once you’re ready to issue codes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* ── Required ── */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Campaign
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Name *</Label>
                <Input
                  placeholder="e.g. Q4 Public Launch"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
                {fieldErrors.name && (
                  <p className="text-[10px] text-rose-600">
                    {fieldErrors.name[0]}
                  </p>
                )}
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Description</Label>
                <Textarea
                  placeholder="What is this campaign for?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] text-sm min-h-[64px] resize-none"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Type *</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger className="w-full rounded-xl border-[var(--anna-border)] h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Applies To</Label>
                <Select value={appliesTo} onValueChange={setAppliesTo}>
                  <SelectTrigger className="w-full rounded-xl border-[var(--anna-border)] h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APPLIES_TO_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Target Tier</Label>
                <Select value={targetTier} onValueChange={setTargetTier}>
                  <SelectTrigger className="w-full rounded-xl border-[var(--anna-border)] h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIER_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Target Category</Label>
                <Input
                  placeholder="e.g. CLEANING (blank = all)"
                  value={targetCategory}
                  onChange={(e) => setTargetCategory(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
            </div>
          </div>

          {/* ── Discount Rule ── */}
          <div className="border-t border-[var(--anna-border)] pt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Discount Rule
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Discount Type *</Label>
                <Select
                  value={discountType}
                  onValueChange={setDiscountType}
                >
                  <SelectTrigger className="w-full rounded-xl border-[var(--anna-border)] h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DISCOUNT_TYPE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  Discount Value *{" "}
                  <span className="text-[var(--anna-muted)]">
                    ({discountType === "PERCENTAGE" ? "%" : "$"})
                  </span>
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={discountType === "PERCENTAGE" ? "15" : "20"}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
                {fieldErrors.discountValue && (
                  <p className="text-[10px] text-rose-600">
                    {fieldErrors.discountValue[0]}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Min Order Value ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 50"
                  value={minOrderValue}
                  onChange={(e) => setMinOrderValue(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max Discount Cap ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 30"
                  value={maxDiscountCap}
                  onChange={(e) => setMaxDiscountCap(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Eligibility</Label>
                <Select value={eligibility} onValueChange={setEligibility}>
                  <SelectTrigger className="w-full rounded-xl border-[var(--anna-border)] h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ELIGIBILITY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 flex items-center justify-between rounded-xl border border-[var(--anna-border)] px-3 h-9">
                <div>
                  <p className="text-xs font-medium text-[var(--anna-slate)]">
                    Stackable
                  </p>
                  <p className="text-[10px] text-[var(--anna-muted)]">
                    Allow combining with other discounts
                  </p>
                </div>
                <Switch checked={stackable} onCheckedChange={setStackable} />
              </div>
            </div>
          </div>

          {/* ── Schedule & Cap ── */}
          <div className="border-t border-[var(--anna-border)] pt-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Schedule & Cap
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Max Redemptions</Label>
                <Input
                  type="number"
                  min="1"
                  placeholder="blank = unlimited"
                  value={maxRedemptions}
                  onChange={(e) => setMaxRedemptions(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Start Date</Label>
                <Input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">End Date</Label>
                <Input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="rounded-xl"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || mutation.isPending}
            className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl"
          >
            {mutation.isPending ? "Creating..." : "Create Campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
