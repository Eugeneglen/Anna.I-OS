"use client";

import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Users } from "lucide-react";
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
import { SegmentSelector } from "./segment-selector";
import { wallClockToUtcIso, timezoneLabel } from "@/lib/ops-format";

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
  /**
   * Fix 15 — Optional preselected segment. When the dialog is opened
   * with this set (e.g. from the Insights tab "Create Campaign"
   * action on a REACTIVATION recommendation), the segment dropdown
   * is seeded with this ID so the user doesn't have to scroll for it.
   * The user can still change it before submitting.
   */
  initialSegmentId?: string;
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

// ── Fix 21 — Schedule Send timezone picker ──
// Default to Asia/Singapore because the app is SG-local. The list is
// curated to the timezones most likely to be relevant to an SG ops team
// (regional neighbours + common business travel destinations). Users
// who need a different zone can request it added — the schema accepts
// any IANA name.
const TIMEZONE_OPTIONS = [
  { value: "Asia/Singapore", label: `Asia/Singapore (${timezoneLabel("Asia/Singapore")})` },
  { value: "Asia/Kuala_Lumpur", label: `Asia/Kuala_Lumpur (${timezoneLabel("Asia/Kuala_Lumpur")})` },
  { value: "Asia/Jakarta", label: `Asia/Jakarta (${timezoneLabel("Asia/Jakarta")})` },
  { value: "Asia/Bangkok", label: `Asia/Bangkok (${timezoneLabel("Asia/Bangkok")})` },
  { value: "Asia/Hong_Kong", label: `Asia/Hong_Kong (${timezoneLabel("Asia/Hong_Kong")})` },
  { value: "Asia/Shanghai", label: `Asia/Shanghai (${timezoneLabel("Asia/Shanghai")})` },
  { value: "Asia/Tokyo", label: `Asia/Tokyo (${timezoneLabel("Asia/Tokyo")})` },
  { value: "Asia/Kolkata", label: `Asia/Kolkata (${timezoneLabel("Asia/Kolkata")})` },
  { value: "Australia/Sydney", label: `Australia/Sydney (${timezoneLabel("Australia/Sydney")})` },
  { value: "Europe/London", label: `Europe/London (${timezoneLabel("Europe/London")})` },
  { value: "America/New_York", label: `America/New_York (${timezoneLabel("America/New_York")})` },
  { value: "UTC", label: "UTC" },
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
  initialSegmentId,
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
  const [segmentId, setSegmentId] = useState(""); // Phase 2: link to segment
  const [minOrderValue, setMinOrderValue] = useState("");
  const [maxDiscountCap, setMaxDiscountCap] = useState("");
  const [stackable, setStackable] = useState(false);

  // ── Phase 2 Fix 10 — campaign content editor ──
  const [subjectLine, setSubjectLine] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [smsText, setSmsText] = useState("");

  // ── Fix 21 — timezone-aware scheduled send ──
  // Optional: when set, the campaign should be activated/sent at this
  // wall-clock time in the selected timezone. Defaults to blank (no
  // schedule) so existing flow is unchanged.
  const [sendAt, setSendAt] = useState("");
  const [timezone, setTimezone] = useState("Asia/Singapore");

  // Phase 2 Fix 11 — voucher issuance job polling ──
  // When the API returns 202 with an issuanceJobId, we show a progress
  // banner ("Issuing vouchers to N members...") and poll the job status
  // every 1.5s until COMPLETED or FAILED.
  const [issuanceJob, setIssuanceJob] = useState<{
    jobId: string;
    status: string;
    totalMembers: number;
    processedCount: number;
    failedCount: number;
    error?: string | null;
  } | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ── F5.3: stall detection — if polling shows no progress for 120 s we
  // stop spinning and tell the user the background dispatcher owns the job.
  const [issuanceStalled, setIssuanceStalled] = useState(false);
  const pollStartedAtRef = useRef<number>(0);
  const lastProgressRef = useRef<{ at: number; processed: number }>({ at: 0, processed: -1 });
  const [retryingJob, setRetryingJob] = useState(false);

  // ── Phase 2 Fix 13 — estimated recipients preview ──
  // When a segment is selected, we fetch the segment's stored filters from
  // GET /api/ops/marketing/segments/[id] and then POST those filters to
  // /api/ops/marketing/segments/preview to get the live recipient count,
  // displayed prominently next to the segment selector BEFORE the user
  // submits the campaign form. No segment selected ⇒ no fetch + no display.
  const previewQuery = useQuery<{ count: number; sampleHouseholdIds: string[] } | null>({
    queryKey: ["campaign-create-segment-preview", segmentId],
    queryFn: async () => {
      if (!segmentId) return null;
      // Step 1: load the segment's stored filters.
      const segRes = await fetch(`/api/ops/marketing/segments/${segmentId}`);
      if (!segRes.ok) return null;
      const segJson = await segRes.json();
      const filters = segJson?.segment?.filters;
      if (!filters || (typeof filters === "object" && Object.keys(filters).length === 0)) {
        // No filters ⇒ 0 recipients by definition (preview API requires filters).
        return { count: 0, sampleHouseholdIds: [] };
      }
      // Step 2: call the existing preview API with the segment's filters.
      const prevRes = await fetch("/api/ops/marketing/segments/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters }),
      });
      if (!prevRes.ok) return null;
      return prevRes.json();
    },
    enabled: !!segmentId,
    staleTime: 60_000,
  });

  const previewCount: number | null = !segmentId
    ? null
    : previewQuery.isLoading
      ? null
      : previewQuery.data?.count ?? null;
  const previewLoading = !!segmentId && previewQuery.isLoading;

  // Stop polling if the dialog closes.
  useEffect(() => {
    if (!open && pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    // Note: we intentionally do NOT call setIssuanceJob(null) here — calling
    // setState synchronously inside an effect triggers React's cascading-render
    // warning. Instead, issuance state is cleared by the `resetForm()` call
    // invoked when the dialog closes (handleOpenChange) or after the job
    // completes. This keeps the effect side-effect free of state writes.
  }, [open]);

  // Fix 15 — seed the segment selector with the preselected segment when
  // the parent passes a new `initialSegmentId`. Uses the React-recommended
  // "adjust state during render when a prop changes" pattern (see
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders)
  // rather than a useEffect with setState inside, which the lint rule
  // `react-hooks/set-state-in-effect` flags. The seeding fires only when
  // the parent explicitly changes `initialSegmentId` — the user's manual
  // selection within the dialog is preserved while the prop is stable.
  const [lastInitialSegmentId, setLastInitialSegmentId] = useState<string | undefined>(initialSegmentId);
  if (initialSegmentId !== lastInitialSegmentId) {
    setLastInitialSegmentId(initialSegmentId);
    if (initialSegmentId) setSegmentId(initialSegmentId);
  }

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

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
    setSegmentId("");
    // Phase 2 Fix 10
    setSubjectLine("");
    setBodyText("");
    setSmsText("");
    // Fix 21
    setSendAt("");
    setTimezone("Asia/Singapore");
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
      return { data, status: res.status };
    },
    onSuccess: (vars) => {
      const { data, status } = vars;
      // Phase 2 Fix 11: 202 Accepted means a voucher-issuance job was created.
      // Don't close the dialog — switch to polling mode so the user sees
      // progress, and trigger the processor immediately.
      if (status === 202 && data?.issuanceJobId) {
        const n = data.totalMembers ?? 0;
        toast.success(
          `Campaign “${data?.campaign?.name || "Created"}” created — issuing vouchers to ${n} member${n === 1 ? "" : "s"} in the background.`
        );
        queryClient.invalidateQueries({ queryKey: CAMPAIGN_QUERY_KEYS.list });
        setIssuanceJob({
          jobId: data.issuanceJobId,
          status: data.issuanceStatus || "PENDING",
          totalMembers: data.totalMembers ?? 0,
          processedCount: 0,
          failedCount: 0,
          error: null,
        });
        // Kick off the processor + start polling.
        triggerProcessorAndPoll(data.issuanceJobId);
        return;
      }
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

  // Phase 2 Fix 11 — invoke the background processor + poll for status.
  // ── F5.3: also reset stall tracking on every (re)start.
  async function triggerProcessorAndPoll(jobId: string) {
    setIssuanceStalled(false);
    pollStartedAtRef.current = Date.now();
    lastProgressRef.current = { at: Date.now(), processed: -1 };
    try {
      // Fire-and-forget — the processor runs to completion server-side
      // while the client polls for status.
      await fetch("/api/ops/marketing/process-issuance-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      }).catch((err) => {
        // Non-fatal — polling will retry.
        console.error("[campaign-create] processor invocation failed:", err);
      });
    } catch (err) {
      console.error("[campaign-create] processor invocation error:", err);
    }
    // Start polling.
    pollJobStatus(jobId);
  }

  async function pollJobStatus(jobId: string) {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    const pollOnce = async () => {
      try {
        const res = await fetch(`/api/ops/marketing/issuance-jobs/${jobId}`);
        if (!res.ok) {
          console.error("[campaign-create] poll failed:", res.status);
          return false;
        }
        const json = await res.json();
        const job = json?.job;
        if (!job) return false;

        setIssuanceJob({
          jobId: job.id,
          status: job.status,
          totalMembers: job.totalMembers ?? 0,
          processedCount: job.processedCount ?? 0,
          failedCount: job.failedCount ?? 0,
          error: job.error,
        });

        if (job.status === "COMPLETED") {
          const failed = job.failedCount ?? 0;
          const issued = (job.processedCount ?? 0) - failed;
          if (failed > 0) {
            toast.success(`Issuance complete: ${issued} vouchers issued (${failed} failed).`);
          } else {
            toast.success(`Issuance complete: ${issued} vouchers issued.`);
          }
          queryClient.invalidateQueries({ queryKey: CAMPAIGN_QUERY_KEYS.list });
          // Auto-close the dialog after a short delay so the user sees the result.
          setTimeout(() => {
            resetForm();
            setIssuanceJob(null);
            onOpenChange(false);
          }, 1500);
          return true;
        }
        if (job.status === "FAILED") {
          toast.error(
            `Issuance failed: ${job.error || "unknown error"}`
          );
          return true;
        }

        // ── F5.3: stall timeout — 120 s with no progress change stops the
        // spinner and hands ownership to the server-side dispatcher. The
        // user may keep waiting via "Check again" or simply close the
        // dialog; PENDING jobs complete with zero tabs open.
        const now = Date.now();
        if (job.processedCount !== lastProgressRef.current.processed) {
          lastProgressRef.current = { at: now, processed: job.processedCount ?? 0 };
        }
        const stalledFor = now - Math.max(pollStartedAtRef.current, lastProgressRef.current.at);
        if (stalledFor > 120_000) {
          setIssuanceStalled(true);
          return true; // stop polling; banner switches to "still queued"
        }

        // Still RUNNING or PENDING — schedule next poll.
        pollTimerRef.current = setTimeout(pollOnce, 1500);
        return false;
      } catch (err) {
        console.error("[campaign-create] poll error:", err);
        // Retry on next tick.
        pollTimerRef.current = setTimeout(pollOnce, 3000);
        return false;
      }
    };

    pollOnce();
  }

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

    // ── Fix 21 — Schedule Send (optional) ──
    // The user enters a wall-clock time in the selected timezone; we
    // convert it to a UTC ISO string before sending so the server can
    // persist it as a Prisma DateTime (always UTC) without having to
    // know about timezones itself. The timezone string is also sent so
    // the detail sheet can render the schedule in the user's chosen
    // zone rather than always defaulting to SG.
    if (sendAt) {
      const iso = wallClockToUtcIso(sendAt, timezone);
      if (iso) {
        payload.sendAt = iso;
        payload.timezone = timezone;
      } else {
        // Could not parse the wall-clock — surface a field error so
        // the user fixes the input rather than silently dropping the
        // schedule.
        setFieldErrors({ sendAt: ["Enter a valid date and time"] });
        toast.error("Enter a valid scheduled send time");
        return;
      }
    }

    const minCents = dollarsToCents(minOrderValue);
    if (minCents !== undefined) payload.minOrderValueCents = minCents;
    const maxCents = dollarsToCents(maxDiscountCap);
    if (maxCents !== undefined) payload.maxDiscountCapCents = maxCents;
    if (segmentId) payload.segmentId = segmentId;

    // Phase 2 Fix 10 — campaign content fields (optional)
    if (subjectLine.trim()) payload.subjectLine = subjectLine.trim();
    if (bodyText.trim()) payload.bodyText = bodyText.trim();
    if (smsText.trim()) {
      // Enforce SMS length cap (160 chars) on submit too — the textarea
      // already enforces it visually but Zod max(160) would reject
      // anything larger, so we slice defensively.
      payload.smsText = smsText.trim().slice(0, 160);
    }

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
      // Phase 2 Fix 11 — clear any in-flight issuance job state when the
      // dialog closes. Done here (not in useEffect) to avoid the
      // cascading-render warning.
      setIssuanceJob(null);
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
            {/* Phase 2: Target Segment (optional) */}
            <div className="space-y-1">
              <Label className="text-xs">Target Segment (optional)</Label>
              <SegmentSelector value={segmentId} onChange={setSegmentId} />
              {segmentId && (
                <p className="text-[10px] text-[var(--anna-sage-dark)]">
                  Per-household vouchers will be auto-issued to all segment members on creation.
                </p>
              )}
              {/* Phase 2 Fix 13 — Estimated recipients preview.
                  Shown ONLY when a segment is selected. Loads the segment's
                  stored filters, then calls POST /api/ops/marketing/segments/preview
                  to get the live count BEFORE the user submits. */}
              {segmentId && (
                <div className="flex items-center gap-2 mt-1 px-3 py-2 rounded-xl border border-[var(--anna-sage)]/40 bg-[var(--anna-sage-light)]/40">
                  <Users size={14} className="text-[var(--anna-sage-dark)] shrink-0" />
                  {previewLoading ? (
                    <span className="text-xs text-[var(--anna-muted)] flex items-center gap-1.5">
                      <Loader2 size={11} className="animate-spin" />
                      Counting recipients…
                    </span>
                  ) : previewCount !== null ? (
                    <span className="text-xs font-medium text-[var(--anna-slate)]">
                      Estimated recipients:{" "}
                      <span className="font-data font-bold text-[var(--anna-sage-dark)]">
                        {previewCount}
                      </span>
                      <span className="text-[var(--anna-muted)] ml-1">
                        member{previewCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs text-[var(--anna-muted)]">
                      Unable to estimate recipient count
                    </span>
                  )}
                </div>
              )}
            </div>
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

            {/* ── Fix 21 — Schedule Send (optional) ── */}
            {/* Optional wall-clock "send at" time + timezone selector. */}
            {/* Stored but does NOT trigger delivery — that's a separate */}
            {/* scheduler's concern. Default timezone = Asia/Singapore. */}
            <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)]/40 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-[var(--anna-slate)]">
                    Schedule Send
                  </p>
                  <p className="text-[10px] text-[var(--anna-muted)]">
                    Optional · stored for later delivery (no auto-send yet)
                  </p>
                </div>
                <Switch checked={!!sendAt} onCheckedChange={(v) => {
                  if (v) {
                    // Default to "tomorrow at 9am local browser time" — the
                    // wall-clock is then converted to UTC using the selected
                    // timezone on submit. The browser-default here is just a
                    // convenience; the user can override.
                    if (!sendAt) {
                      const d = new Date();
                      d.setDate(d.getDate() + 1);
                      d.setHours(9, 0, 0, 0);
                      // datetime-local expects "YYYY-MM-DDTHH:mm" in local
                      // browser time — toLocaleString isn't suitable, so we
                      // build it manually from the Date parts.
                      const pad = (n: number) => String(n).padStart(2, "0");
                      setSendAt(
                        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
                      );
                    }
                  } else {
                    setSendAt("");
                  }
                }} />
              </div>
              {sendAt && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Send At</Label>
                    <Input
                      type="datetime-local"
                      value={sendAt}
                      onChange={(e) => setSendAt(e.target.value)}
                      className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                    />
                    {fieldErrors.sendAt && (
                      <p className="text-[10px] text-rose-600">
                        {fieldErrors.sendAt[0]}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Timezone</Label>
                    <Select value={timezone} onValueChange={setTimezone}>
                      <SelectTrigger className="w-full rounded-xl border-[var(--anna-border)] h-9 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMEZONE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-[var(--anna-muted)]">
                      Wall-clock time is interpreted in {timezoneLabel(timezone)}.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Phase 2 Fix 10 — Campaign Content ── */}
          <div className="border-t border-[var(--anna-border)] pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                Campaign Content
              </p>
              <span className="text-[10px] text-[var(--anna-muted)]">
                Optional · saved but not yet sent
              </span>
            </div>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Email Subject Line</Label>
                <Input
                  placeholder="e.g. 15% off your next booking"
                  value={subjectLine}
                  maxLength={200}
                  onChange={(e) => setSubjectLine(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
                {subjectLine && (
                  <p className="text-[10px] text-[var(--anna-muted)]">
                    {subjectLine.length}/200 characters
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email Body (plain text)</Label>
                <Textarea
                  placeholder="Dear {{name}}, we're excited to offer..."
                  value={bodyText}
                  maxLength={10_000}
                  onChange={(e) => setBodyText(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] text-sm min-h-[100px] resize-y"
                />
                {bodyText && (
                  <p className="text-[10px] text-[var(--anna-muted)]">
                    {bodyText.length} characters
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">
                  SMS Text{" "}
                  <span className="text-[var(--anna-muted)]">
                    ({smsText.length}/160)
                  </span>
                </Label>
                <Textarea
                  placeholder="Anna.I: 15% off your next booking. Reply STOP to opt out."
                  value={smsText}
                  maxLength={160}
                  onChange={(e) => setSmsText(e.target.value)}
                  className="rounded-xl border-[var(--anna-border)] text-sm min-h-[60px] resize-none"
                />
                <p className="text-[10px] text-[var(--anna-muted)]">
                  Standard SMS — keep under 160 chars to fit a single segment.
                </p>
              </div>
            </div>
          </div>

          {/* ── Phase 2 Fix 11 — Issuance Job Progress Banner ── */}
          {issuanceJob && (
            <div className="border-t border-[var(--anna-border)] pt-4">
              <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)] p-3 space-y-2">
                <div className="flex items-center gap-2">
                  {issuanceJob.status === "COMPLETED" || issuanceJob.status === "FAILED" || issuanceStalled ? null : (
                    <Loader2 size={14} className="animate-spin text-[var(--anna-sage-dark)]" />
                  )}
                  <p className="text-xs font-semibold text-[var(--anna-slate)]">
                    {issuanceJob.status === "PENDING" && !issuanceStalled && "Queued voucher issuance…"}
                    {issuanceJob.status === "PENDING" && issuanceStalled &&
                      "Still queued — the background dispatcher will process it automatically. You can safely close this dialog."}
                    {issuanceJob.status === "RUNNING" &&
                      `Issuing vouchers to ${issuanceJob.totalMembers} member${issuanceJob.totalMembers !== 1 ? "s" : ""}…`}
                    {issuanceJob.status === "COMPLETED" &&
                      `Issuance complete — ${issuanceJob.processedCount - issuanceJob.failedCount} of ${issuanceJob.totalMembers} voucher${issuanceJob.totalMembers !== 1 ? "s" : ""} issued`}
                    {issuanceJob.status === "FAILED" &&
                      `Issuance failed: ${issuanceJob.error || "unknown error"}`}
                  </p>
                </div>

                {/* F5.3: actions — Retry a FAILED job (server rejects unsafe
                    retries); Check again after a stall. */}
                {(issuanceJob.status === "FAILED" || issuanceStalled) && (
                  <div className="flex items-center gap-2">
                    {issuanceJob.status === "FAILED" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={retryingJob}
                        onClick={async () => {
                          setRetryingJob(true);
                          try {
                            const res = await fetch("/api/ops/marketing/process-issuance-job", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ jobId: issuanceJob.jobId }),
                            });
                            const json = await res.json().catch(() => null);
                            if (!res.ok && json?.message) {
                              toast.error(json.message);
                              return;
                            }
                            toast.success("Retrying issuance…");
                            triggerProcessorAndPoll(issuanceJob.jobId);
                          } finally {
                            setRetryingJob(false);
                          }
                        }}
                        className="h-7 rounded-lg text-xs"
                      >
                        {retryingJob ? <Loader2 size={12} className="animate-spin" /> : "Retry"}
                      </Button>
                    )}
                    {issuanceStalled && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIssuanceJob({ ...issuanceJob, status: "PENDING" });
                          triggerProcessorAndPoll(issuanceJob.jobId);
                        }}
                        className="h-7 rounded-lg text-xs"
                      >
                        Check again
                      </Button>
                    )}
                  </div>
                )}

                {/* Progress bar */}
                {issuanceJob.totalMembers > 0 && (
                  <div className="h-2 rounded-full bg-[var(--anna-white)] overflow-hidden border border-[var(--anna-border)]">
                    <div
                      className={
                        "h-full transition-all duration-500 " +
                        (issuanceJob.status === "FAILED"
                          ? "bg-rose-500"
                          : issuanceJob.status === "COMPLETED"
                          ? "bg-[var(--anna-sage-dark)]"
                          : "bg-[var(--anna-sage)]")
                      }
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            (issuanceJob.processedCount / issuanceJob.totalMembers) * 100,
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                )}

                {/* Counts line */}
                <div className="flex items-center justify-between text-[10px] text-[var(--anna-muted)] font-data">
                  <span>
                    {issuanceJob.processedCount} / {issuanceJob.totalMembers} processed
                  </span>
                  {issuanceJob.failedCount > 0 && (
                    <span className="text-rose-600">
                      {issuanceJob.failedCount} failed
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={!!issuanceJob && !issuanceStalled && issuanceJob.status !== "COMPLETED" && issuanceJob.status !== "FAILED"}
            className="rounded-xl"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || mutation.isPending || !!issuanceJob}
            className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl"
          >
            {issuanceJob
              ? issuanceJob.status === "COMPLETED"
                ? "Done"
                : issuanceJob.status === "FAILED"
                ? "Close"
                : "Issuing…"
              : mutation.isPending
              ? "Creating..."
              : "Create Campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
