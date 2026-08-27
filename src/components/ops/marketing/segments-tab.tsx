"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, RefreshCw, Archive, Loader2 } from "lucide-react";
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">Segments</h2>
          <p className="text-sm text-[var(--anna-muted)]">
            <span className="font-data">{segments.length}</span> segments ·{" "}
            <span className="font-data">{segments.reduce((s, seg) => s + seg.memberCount, 0)}</span> total members
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
                    <span className="font-data font-medium text-[var(--anna-sage-dark)]">{seg.memberCount} members</span>
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

// ── Create Segment Dialog ──

function CreateSegmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [lastOrderDaysMin, setLastOrderDaysMin] = useState("");
  const [minOrders, setMinOrders] = useState("");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const buildFilters = useCallback(() => {
    const filters: Record<string, unknown> = {};
    if (lastOrderDaysMin) filters.lastOrderDaysMin = parseInt(lastOrderDaysMin, 10);
    if (minOrders) filters.minOrders = parseInt(minOrders, 10);
    return filters;
  }, [lastOrderDaysMin, minOrders]);

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ops/marketing/segments/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filters: buildFilters() }),
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: (data) => setPreviewCount(data.count),
    onError: () => setPreviewCount(null),
  });

  const debouncedPreview = useCallback(() => {
    setPreviewLoading(true);
    const timer = setTimeout(() => {
      previewMutation.mutate();
      setPreviewLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [previewMutation]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ops/marketing/segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, filters: buildFilters() }),
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
      setLastOrderDaysMin("");
      setMinOrders("");
      setPreviewCount(null);
    },
    onError: () => toast.error("Failed to create segment"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle>Create Segment</DialogTitle>
          <DialogDescription>
            Define filters to dynamically group customers. Members are recomputed automatically as behaviour changes.
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
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Filters</p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">No order in (days)</Label>
                <Input
                  type="number"
                  value={lastOrderDaysMin}
                  onChange={(e) => { setLastOrderDaysMin(e.target.value); debouncedPreview(); }}
                  placeholder="e.g. 90"
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Min orders</Label>
                <Input
                  type="number"
                  value={minOrders}
                  onChange={(e) => { setMinOrders(e.target.value); debouncedPreview(); }}
                  placeholder="e.g. 1"
                  className="rounded-xl border-[var(--anna-border)] h-9 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Live preview */}
          <div className="rounded-xl bg-[var(--anna-bg)] border border-[var(--anna-border)] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-1">Live Preview</p>
            {previewLoading || previewMutation.isPending ? (
              <p className="text-xs text-[var(--anna-muted)] flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Counting...</p>
            ) : previewCount !== null ? (
              <p className="text-sm font-data font-bold text-[var(--anna-sage-dark)]">{previewCount} household{previewCount !== 1 ? "s" : ""} match</p>
            ) : (
              <p className="text-xs text-[var(--anna-muted)]">Set filters to see matching count</p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">Cancel</Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || createMutation.isPending}
            className="rounded-xl bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white"
          >
            {createMutation.isPending ? "Creating..." : "Create Segment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
