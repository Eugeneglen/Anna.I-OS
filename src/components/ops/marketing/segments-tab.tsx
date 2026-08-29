"use client";

import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, RefreshCw, Archive, RotateCcw, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOpsUser } from "@/app/ops/(dashboard)/layout";
import { formatDate } from "@/lib/ops-format";

// ============================================================
// Segments Tab — list + create + recompute + archive
// ============================================================

interface SegmentItem {
  id: string;
  name: string;
  description: string | null;
  status: string;
  memberCount: number;
  lastComputedAt: string | null;
  createdAt: string;
}

export function SegmentsTab() {
  const opsCtx = useOpsUser();
  const can = opsCtx?.can;
  const canCreate = !!can && can("marketing", "create");
  const canEdit = !!can && can("marketing", "edit");
  const canDelete = !!can && can("marketing", "delete");
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useQuery<{ segments: SegmentItem[] }>({
    queryKey: ["ops-marketing-segments"],
    queryFn: async () => {
      const res = await fetch("/api/ops/marketing/segments");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 30_000,
  });

  const segments = data?.segments || [];

  const recomputeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ops/marketing/segments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recompute" }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => {
      toast.success(`Recomputed: ${data.added} added, ${data.removed} removed, ${data.total} total`);
      queryClient.invalidateQueries({ queryKey: ["ops-marketing-segments"] });
    },
    onError: () => toast.error("Failed to recompute"),
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ops/marketing/segments/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Segment archived");
      queryClient.invalidateQueries({ queryKey: ["ops-marketing-segments"] });
    },
    onError: () => toast.error("Failed to archive"),
  });

  // Phase 2 Fix 12 — reactivate an archived segment. Mirrors the archive
  // mutation but uses PATCH action=unarchive, which flips status back to
  // ACTIVE and recomputes members server-side.
  const unarchiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ops/marketing/segments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unarchive" }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => {
      const total = typeof data?.total === "number" ? data.total : null;
      toast.success(
        total !== null
          ? `Segment reactivated — ${total} member${total === 1 ? "" : "s"} recomputed`
          : "Segment reactivated",
      );
      queryClient.invalidateQueries({ queryKey: ["ops-marketing-segments"] });
    },
    onError: () => toast.error("Failed to reactivate segment"),
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">Segments</h2>
          <p className="text-sm text-[var(--anna-muted)]">
            <span className="font-data">{segments.length}</span> segments ·{" "}
            <span className="font-data">{segments.reduce((s, seg) => s + seg.memberCount, 0)}</span> total member{segments.reduce((s, seg) => s + seg.memberCount, 0) === 1 ? "" : "s"}
          </p>
        </div>
        {canCreate && (
          <Button
            onClick={() => setCreateOpen(true)}
            className="h-9 rounded-xl bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-dark)]/90 text-white"
          >
            <Plus size={14} className="mr-1" />
            Create Segment
          </Button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
      ) : segments.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-14 h-14 rounded-2xl bg-[var(--anna-sage-light)] flex items-center justify-center mx-auto mb-3">
            <Users size={24} className="text-[var(--anna-sage-dark)]" />
          </div>
          <p className="text-sm font-medium text-[var(--anna-slate)]">No segments yet</p>
          <p className="text-xs text-[var(--anna-muted)] mt-1">
            Create a segment to target specific customer groups with campaigns
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {segments.map((seg) => (
            <div
              key={seg.id}
              className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-[var(--anna-slate)]">{seg.name}</span>
                    {seg.status === "ARCHIVED" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--anna-bg)] text-[var(--anna-muted)]">Archived</span>
                    )}
                  </div>
                  {seg.description && (
                    <p className="text-xs text-[var(--anna-muted)] line-clamp-1">{seg.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-[var(--anna-muted)]">
                    <span className="font-data font-medium text-[var(--anna-sage-dark)]">{seg.memberCount} member{seg.memberCount === 1 ? "" : "s"}</span>
                    {seg.lastComputedAt && <span>Computed {formatDate(seg.lastComputedAt)}</span>}
                    <span>Created {formatDate(seg.createdAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {canEdit && seg.status === "ACTIVE" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 hover:bg-[var(--anna-sage-light)]"
                      onClick={() => recomputeMutation.mutate(seg.id)}
                      disabled={recomputeMutation.isPending}
                      title="Recompute members"
                    >
                      <RefreshCw size={14} className={recomputeMutation.isPending ? "animate-spin" : ""} />
                    </Button>
                  )}
                  {canDelete && seg.status === "ACTIVE" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 hover:bg-red-50"
                      onClick={() => archiveMutation.mutate(seg.id)}
                      title="Archive segment"
                    >
                      <Archive size={14} className="text-[var(--anna-muted)]" />
                    </Button>
                  )}
                  {/* Phase 2 Fix 12 — reactivate archived segments. */}
                  {canEdit && seg.status === "ARCHIVED" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 hover:bg-[var(--anna-sage-light)]"
                      onClick={() => unarchiveMutation.mutate(seg.id)}
                      disabled={unarchiveMutation.isPending}
                      title="Reactivate segment"
                      aria-label="Reactivate segment"
                    >
                      {unarchiveMutation.isPending && unarchiveMutation.variables === seg.id ? (
                        <Loader2 size={14} className="animate-spin text-[var(--anna-sage-dark)]" />
                      ) : (
                        <RotateCcw size={14} className="text-[var(--anna-sage-dark)]" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <CreateSegmentDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Create Segment Dialog — Phase 2 Fix 9
//   Expanded to expose all 15 supported filter types from the
//   audit. Each filter row is a (type, value) pair; the dialog
//   dynamically renders the appropriate input for the chosen
//   type. Filters are AND-combined.
// ────────────────────────────────────────────────────────────

// All 15 filter types exposed in the UI. Each maps to one (or two)
// keys on the SegmentFilters object the engine consumes.
type FilterType =
  | "minOrders"                      // 1. Booking frequency
  | "lastOrderDaysMax"               // 2a. Last booking date — before (days ago)
  | "lastOrderDaysMin"               // 2b. Last booking date — after  (days ago)
  | "minTotalSpendCents"             // 3a. Total spending — min (cents)
  | "maxTotalSpendCents"             // 3b. Total spending — max (cents)
  | "customerValue"                  // 4. Customer value (tier)
  | "subscriptionTier"               // 5. Membership (tier)
  | "minVouchersRedeemed"            // 6. Voucher usage (min redeemed)
  | "categoriesUsed"                 // 7. Service history (category)
  | "geographicArea"                 // 8. Geographic location (text)
  | "nameContains"                   // 9. Demographics (text)
  | "activityLevel"                  // 10. Activity level
  | "acquisitionSource"              // 11. Referral source
  | "marketingEngagement"            // 12. Marketing engagement
  | "rfmSegment"                     // 13. RFM segment
  | "minAutonomyLevel"               // 14. Autonomy level
  | "lifecycleStage";                // 15. Lifecycle stage

interface FilterTypeMeta {
  label: string;
  /** Control type for rendering. */
  control:
    | "number"
    | "text"
    | "select-string"
    | "select-string-multi";
  /** For select controls — option list. */
  options?: { value: string; label: string }[];
  /** Placeholder for input controls. */
  placeholder?: string;
  /** Help text under the input. */
  help?: string;
}

const SERVICE_CATEGORIES = [
  "CLEANING", "LAUNDRY", "AIRCON", "PLUMBING", "ELECTRICAL",
  "PAINTING", "PEST_CONTROL", "HANDYMAN", "LOCKSMITH", "APPLIANCE_REPAIR",
];

const ACQUISITION_SOURCES = [
  { value: "PILOT_COHORT", label: "Pilot Cohort" },
  { value: "PUBLIC_CODE", label: "Public Code" },
  { value: "PARTNERSHIP_REFERRAL", label: "Partnership Referral" },
  { value: "ORGANIC", label: "Organic" },
  { value: "OTHER", label: "Other" },
];

const LIFECYCLE_STAGES = [
  { value: "NEW", label: "New" },
  { value: "ACTIVE", label: "Active" },
  { value: "REGULAR", label: "Regular" },
  { value: "DECLINING", label: "Declining (dormant)" },
  { value: "LAPSED", label: "Lapsed (churned)" },
  { value: "REACTIVATED", label: "Reactivated" },
];

const RFM_SEGMENTS = [
  { value: "Champions", label: "Champions" },
  { value: "Loyal", label: "Loyal" },
  { value: "Recent", label: "Recent" },
  { value: "Regular", label: "Regular" },
  { value: "About to Sleep", label: "About to Sleep" },
  { value: "At Risk", label: "At Risk" },
  { value: "Lost", label: "Lost" },
  { value: "New", label: "New" },
  { value: "Average", label: "Average" },
];

const CUSTOMER_VALUES = [
  { value: "HIGH", label: "High (Champions / Loyal)" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low (At Risk / Lost)" },
];

const MEMBERSHIP_TIERS = [
  { value: "HOME", label: "Home" },
  { value: "CARE", label: "Care" },
];

const ACTIVITY_LEVELS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
];

const ENGAGEMENT_LEVELS = [
  { value: "ENGAGED", label: "Engaged" },
  { value: "NOT_ENGAGED", label: "Not Engaged" },
];

const FILTER_TYPES: { type: FilterType; meta: FilterTypeMeta }[] = [
  { type: "minOrders",            meta: { label: "Booking frequency (min orders)",     control: "number",       placeholder: "e.g. 3",   help: "Household has completed at least this many orders." } },
  { type: "lastOrderDaysMax",     meta: { label: "Last booking — within (days)",      control: "number",       placeholder: "e.g. 30",  help: "Last order was at most this many days ago." } },
  { type: "lastOrderDaysMin",     meta: { label: "Last booking — older than (days)",  control: "number",       placeholder: "e.g. 90",  help: "Last order was at least this many days ago." } },
  { type: "minTotalSpendCents",   meta: { label: "Total spending — min (cents)",      control: "number",       placeholder: "e.g. 10000", help: "Lifetime spend in cents (1 SGD = 100 cents)." } },
  { type: "maxTotalSpendCents",   meta: { label: "Total spending — max (cents)",      control: "number",       placeholder: "e.g. 50000", help: "Lifetime spend in cents — upper bound." } },
  { type: "customerValue",        meta: { label: "Customer value (tier)",             control: "select-string", options: CUSTOMER_VALUES } },
  { type: "subscriptionTier",     meta: { label: "Membership (tier)",                 control: "select-string", options: MEMBERSHIP_TIERS } },
  { type: "minVouchersRedeemed",  meta: { label: "Voucher usage (min redeemed)",       control: "number",       placeholder: "e.g. 1",   help: "Number of vouchers redeemed." } },
  { type: "categoriesUsed",       meta: { label: "Service history (category used)",    control: "select-string-multi", options: SERVICE_CATEGORIES.map((c) => ({ value: c, label: c })) } },
  { type: "geographicArea",       meta: { label: "Geographic location (zone/area)",   control: "text",         placeholder: "e.g. Tampines", help: "Substring match on the household address." } },
  { type: "nameContains",         meta: { label: "Demographics (name contains)",       control: "text",         placeholder: "e.g. Tan", help: "Substring match on the household name." } },
  { type: "activityLevel",       meta: { label: "Activity level",                     control: "select-string", options: ACTIVITY_LEVELS } },
  { type: "acquisitionSource",    meta: { label: "Referral source",                    control: "select-string-multi", options: ACQUISITION_SOURCES } },
  { type: "marketingEngagement", meta: { label: "Marketing engagement",                control: "select-string", options: ENGAGEMENT_LEVELS } },
  { type: "rfmSegment",          meta: { label: "RFM segment",                         control: "select-string", options: RFM_SEGMENTS } },
  { type: "minAutonomyLevel",    meta: { label: "Autonomy level (min 1-5)",            control: "number",       placeholder: "e.g. 3", help: "Highest autonomy level reached across categories (1-5)." } },
  { type: "lifecycleStage",       meta: { label: "Lifecycle stage",                    control: "select-string-multi", options: LIFECYCLE_STAGES } },
];

const FILTER_TYPE_LOOKUP: Record<FilterType, FilterTypeMeta> = Object.fromEntries(
  FILTER_TYPES.map(({ type, meta }) => [type, meta]),
) as Record<FilterType, FilterTypeMeta>;

interface FilterRow {
  id: string;
  type: FilterType;
  value: string;
}

function newFilterId(): string {
  return `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildFiltersFromRows(rows: FilterRow[]): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  for (const row of rows) {
    const v = row.value.trim();
    if (!v) continue;
    const meta = FILTER_TYPE_LOOKUP[row.type];
    switch (meta.control) {
      case "number": {
        const n = parseInt(v, 10);
        if (!isNaN(n)) filters[row.type] = n;
        break;
      }
      case "text":
      case "select-string": {
        filters[row.type] = v;
        break;
      }
      case "select-string-multi": {
        // Multi-value filters are stored as string[] — split by comma.
        // The engine's matchesFilters handles `categoriesUsed`, `acquisitionSource`,
        // `lifecycleStage` as arrays (OR-within-filter); single values also work.
        const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
        if (parts.length > 0) filters[row.type] = parts;
        break;
      }
    }
  }
  return filters;
}

function CreateSegmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<FilterRow[]>([]);
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  const filters = useMemo(() => buildFiltersFromRows(rows), [rows]);

  const previewMutation = useMutation({
    mutationFn: async (currentFilters: Record<string, unknown>) => {
      const res = await fetch("/api/ops/marketing/segments/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: currentFilters }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => setPreviewCount(data.count),
    onError: () => setPreviewCount(null),
  });

  // Debounced preview whenever the filter signature changes.
  const filterKey = JSON.stringify(filters);
  const hasFilters = Object.keys(filters).length > 0;
  useEffect(() => {
    if (!hasFilters) {
      // No filters — don't fire the mutation. Don't setState here either
      // (causes React cascading-render warning); the render below uses
      // `hasFilters` to show the "set filters" placeholder instead.
      return;
    }
    const timer = setTimeout(() => {
      previewMutation.mutate(filters);
    }, 500);
    return () => clearTimeout(timer);
  }, [filterKey, hasFilters, previewMutation]);

  // Effective preview count: null when no filters (or after mutation reset).
  const effectivePreviewCount = hasFilters ? previewCount : null;

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ops/marketing/segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, filters }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Segment created");
      queryClient.invalidateQueries({ queryKey: ["ops-marketing-segments"] });
      onOpenChange(false);
      setName("");
      setDescription("");
      setRows([]);
      setPreviewCount(null);
    },
    onError: () => toast.error("Failed to create segment"),
  });

  function addRow() {
    setRows((r) => [...r, { id: newFilterId(), type: "minOrders", value: "" }]);
  }

  function removeRow(id: string) {
    setRows((r) => r.filter((row) => row.id !== id));
  }

  function updateRow(id: string, patch: Partial<FilterRow>) {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function resetForm() {
    setName("");
    setDescription("");
    setRows([]);
    setPreviewCount(null);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl anna-scroll">
        <DialogHeader>
          <DialogTitle>Create Segment</DialogTitle>
          <DialogDescription>
            Define filters to dynamically group customers. Filters are AND-combined; members are recomputed automatically as behaviour changes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* Name + Description */}
          <div className="space-y-2">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lapsed 90-Day Customers"
                className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What defines this segment?"
                className="rounded-xl border-[var(--anna-border)] min-h-[60px] text-sm resize-none"
              />
            </div>
          </div>

          {/* Filters */}
          <div className="border-t border-[var(--anna-border)] pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                Filters ({rows.length})
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-lg text-xs"
                onClick={addRow}
              >
                <Plus size={12} className="mr-1" />
                Add Filter
              </Button>
            </div>

            {rows.length === 0 ? (
              <p className="text-xs text-[var(--anna-muted)] py-2">
                No filters added yet. Click “Add Filter” to define one — all 15 filter types are supported.
              </p>
            ) : (
              <div className="space-y-2">
                {rows.map((row) => (
                  <FilterRowControl
                    key={row.id}
                    row={row}
                    onChange={(patch) => updateRow(row.id, patch)}
                    onRemove={() => removeRow(row.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Live preview */}
          <div className="rounded-xl bg-[var(--anna-bg)] border border-[var(--anna-border)] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-1">Live Preview</p>
            {previewMutation.isPending ? (
              <p className="text-xs text-[var(--anna-muted)] flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Counting...</p>
            ) : effectivePreviewCount !== null ? (
              <p className="text-sm font-data font-bold text-[var(--anna-sage-dark)]">{effectivePreviewCount} household{effectivePreviewCount !== 1 ? "s" : ""} match</p>
            ) : (
              <p className="text-xs text-[var(--anna-muted)]">Add at least one filter to see matching count</p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">Cancel</Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || rows.length === 0 || createMutation.isPending}
            className="rounded-xl bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white"
          >
            {createMutation.isPending ? "Creating..." : "Create Segment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Single filter row ──

function FilterRowControl({
  row,
  onChange,
  onRemove,
}: {
  row: FilterRow;
  onChange: (patch: Partial<FilterRow>) => void;
  onRemove: () => void;
}) {
  const meta = FILTER_TYPE_LOOKUP[row.type];

  return (
    <div className="rounded-xl border border-[var(--anna-border)] bg-[var(--anna-white)] p-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <Select
          value={row.type}
          onValueChange={(v) => onChange({ type: v as FilterType, value: "" })}
        >
          <SelectTrigger className="flex-1 h-8 rounded-lg border-[var(--anna-border)] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTER_TYPES.map(({ type, meta: m }) => (
              <SelectItem key={type} value={type}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-[var(--anna-muted)] hover:bg-red-50 hover:text-red-600"
          onClick={onRemove}
          title="Remove filter"
          aria-label="Remove filter"
        >
          <X size={14} />
        </Button>
      </div>

      {/* Value input — depends on the filter's control type */}
      {meta.control === "number" && (
        <Input
          type="number"
          value={row.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder={meta.placeholder}
          className="rounded-lg border-[var(--anna-border)] h-8 text-xs"
        />
      )}
      {meta.control === "text" && (
        <Input
          type="text"
          value={row.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder={meta.placeholder}
          className="rounded-lg border-[var(--anna-border)] h-8 text-xs"
        />
      )}
      {meta.control === "select-string" && meta.options && (
        <Select value={row.value} onValueChange={(v) => onChange({ value: v })}>
          <SelectTrigger className="w-full h-8 rounded-lg border-[var(--anna-border)] text-xs">
            <SelectValue placeholder="Select value..." />
          </SelectTrigger>
          <SelectContent>
            {meta.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {meta.control === "select-string-multi" && meta.options && (
        <Select value={row.value} onValueChange={(v) => onChange({ value: v })}>
          <SelectTrigger className="w-full h-8 rounded-lg border-[var(--anna-border)] text-xs">
            <SelectValue placeholder="Select value..." />
          </SelectTrigger>
          <SelectContent>
            {meta.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Help text / multi-value hint */}
      {meta.control === "select-string-multi" ? (
        <p className="text-[10px] text-[var(--anna-muted)]">
          Pick one — to OR-match multiple values, add another filter row of the same type.
        </p>
      ) : meta.help ? (
        <p className="text-[10px] text-[var(--anna-muted)]">{meta.help}</p>
      ) : null}
    </div>
  );
}
