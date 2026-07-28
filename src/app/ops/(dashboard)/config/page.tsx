"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Save, Info, DollarSign, Calculator, TrendingUp, RotateCcw, Plus, Pencil, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { JobTypeEditDialog } from "@/components/ops/job-type-edit-dialog";
import type { ServiceJobType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useOpsUser } from "@/app/ops/(dashboard)/layout";
import {
  AUTONOMY_LEVEL_NAMES,
  MAX_AUTONOMY_LEVEL,
  PLATFORM_COMMISSION_RATE,
} from "@/lib/constants";

function formatPrice(cents: number) {
  return `SGD $${(cents / 100).toFixed(2)}`;
}

export default function ConfigPage() {
  const user = useOpsUser();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["ops-config"],
    queryFn: async () => {
      const res = await fetch("/api/ops/config");
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const configMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/ops/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops-config"] });
      toast.success("Config updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const categories = data?.categories || [];
  const jobTypes = data?.jobTypes || [];
  const thresholds = data?.thresholds || [];
  const categoryPricing = data?.categoryPricing || [];
  const effectiveCommission = data?.commissionRate ?? PLATFORM_COMMISSION_RATE;
  const blendedJobValueCents = data?.blendedJobValueCents ?? 0;
  const isAdmin = user?.role === "ADMIN";

  // ── Job Type Dialog state ──
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingJobType, setEditingJobType] = useState<ServiceJobType | null>(null);
  const [isNewJobType, setIsNewJobType] = useState(false);
  const [expandedJobCats, setExpandedJobCats] = useState<Record<string, boolean>>({});
  const [expandedPriceCats, setExpandedPriceCats] = useState<Record<string, boolean>>({});

  // ── Category management state ──
  const [showCreateCat, setShowCreateCat] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatActive, setNewCatActive] = useState(true);

  function openCreateDialog() {
    setEditingJobType(null);
    setIsNewJobType(true);
    setDialogOpen(true);
  }

  function openEditDialog(jt: ServiceJobType) {
    setEditingJobType(jt as unknown as ServiceJobType);
    setIsNewJobType(false);
    setDialogOpen(true);
  }

  function handleSaveJobType(data: Record<string, unknown>) {
    const action = isNewJobType ? "create_job_type" : "update_job_type";
    configMutation.mutate(
      { action, ...data },
      {
        onSuccess: () => {
          setDialogOpen(false);
          setEditingJobType(null);
          qc.invalidateQueries({ queryKey: ["ops-config"] });
          toast.success(isNewJobType ? "Job type created" : "Job type updated");
        },
      }
    );
  }

  function handleDeleteJobType(id: string) {
    if (!confirm("Delete this job type? This cannot be undone.")) return;
    configMutation.mutate(
      { action: "delete_job_type", id },
      {
        onSuccess: () => {
          setDialogOpen(false);
          setEditingJobType(null);
          qc.invalidateQueries({ queryKey: ["ops-config"] });
          toast.success("Job type deleted");
        },
      }
    );
  }

  // ── Threshold editing state ──
  const thresholdEdits = (() => {
    const edits: Record<string, number> = {};
    for (const t of thresholds) {
      edits[`${t.category}-${t.level}`] = t.cyclesRequired;
    }
    return edits;
  })();

  const [localEdits, setLocalEdits] = useState<Record<string, number> | null>(null);
  const edits = localEdits ?? thresholdEdits;

  // ── Pricing editing state ──
  const priceEdits = (() => {
    const edits: Record<string, number> = {};
    for (const p of categoryPricing) {
      edits[p.category] = p.activePriceCents;
    }
    return edits;
  })();

  const [localPriceEdits, setLocalPriceEdits] = useState<Record<string, number> | null>(null);
  const [localCommission, setLocalCommission] = useState<number | null>(null);
  const priceState = localPriceEdits ?? priceEdits;
  const commissionState = localCommission ?? effectiveCommission;

  function setThreshold(category: string, level: number, value: number) {
    setLocalEdits((prev) => ({
      ...(prev ?? thresholdEdits),
      [`${category}-${level}`]: value,
    }));
  }

  function saveThresholds() {
    const arr = Object.entries(edits).map(([key, cyclesRequired]) => {
      const [category, level] = key.split("-");
      return { category, level: parseInt(level), cyclesRequired };
    });
    configMutation.mutate({ action: "save_thresholds", thresholds: arr });
  }

  function toggleJobType(id: string, isActive: boolean) {
    configMutation.mutate({ action: "toggle_job_type", id, isActive });
  }

  function savePricing() {
    const pricing = Object.entries(priceState).map(([category, priceCents]) => ({
      category,
      priceCents,
    }));
    configMutation.mutate({ action: "save_pricing", pricing });
    setLocalPriceEdits(null);
  }

  function saveCommission() {
    configMutation.mutate({ action: "save_commission", commissionRate: commissionState });
    setLocalCommission(null);
  }

  function resetPricing() {
    const defaults: Record<string, number> = {};
    for (const p of categoryPricing) {
      defaults[p.category] = p.defaultPriceCents;
    }
    setLocalPriceEdits(defaults);
    setLocalCommission(PLATFORM_COMMISSION_RATE);
  }

  function toggleCategory(name: string, isActive: boolean) {
    configMutation.mutate({ action: "toggle_category", name, isActive });
  }

  function createCategory() {
    const trimmed = newCatName.trim();
    if (!trimmed) return;
    configMutation.mutate(
      { action: "create_category", name: trimmed, isActive: newCatActive },
      {
        onSuccess: () => {
          setShowCreateCat(false);
          setNewCatName("");
          setNewCatActive(true);
          toast.success("Category created");
        },
      }
    );
  }

  // Compute live blended value from edits
  const liveBlended = (() => {
    const activePrices = categoryPricing
      .filter((c: Record<string, unknown>) => c.isActive)
      .map((c: Record<string, unknown>) => priceState[c.category as string] || c.activePriceCents);
    return activePrices.length > 0
      ? Math.round(activePrices.reduce((sum: number, v: number) => sum + v, 0) / activePrices.length)
      : 0;
  })();

  const hasPriceChanges = localPriceEdits !== null || localCommission !== null;
  const hasThresholdChanges = localEdits !== null;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-48 rounded-xl bg-[var(--anna-border)]" />
        <Skeleton className="h-96 w-full rounded-2xl bg-[var(--anna-border)]" />
      </div>
    );
  }

  const uniqueCats = [
    ...new Set(
      jobTypes.map((j: Record<string, unknown>) => j.category as string)
    ),
  ];

  return (
    <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
      <div>
        <h2 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)]">
          Configuration
        </h2>
        <p className="text-sm text-[var(--anna-muted)] mt-0.5">
          Manage categories, pricing, and autonomy thresholds
        </p>
      </div>

      <Tabs defaultValue="pricing">
        <TabsList className="bg-[var(--anna-white)] border border-[var(--anna-border)] rounded-xl p-1">
          <TabsTrigger
            value="pricing"
            className="rounded-lg data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-[var(--anna-white)] text-xs font-medium text-[var(--anna-slate-light)]"
          >
            Pricing
          </TabsTrigger>
          <TabsTrigger
            value="categories"
            className="rounded-lg data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-[var(--anna-white)] text-xs font-medium text-[var(--anna-slate-light)]"
          >
            Categories
          </TabsTrigger>
          <TabsTrigger
            value="job-types"
            className="rounded-lg data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-[var(--anna-white)] text-xs font-medium text-[var(--anna-slate-light)]"
          >
            Job Types
          </TabsTrigger>
          <TabsTrigger
            value="thresholds"
            className="rounded-lg data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-[var(--anna-white)] text-xs font-medium text-[var(--anna-slate-light)]"
          >
            Autonomy
          </TabsTrigger>
        </TabsList>

        {/* ===== PRICING TAB ===== */}
        <TabsContent value="pricing" className="mt-4 space-y-4">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-gradient-to-br from-[var(--anna-sage-light)] to-[var(--anna-bg)] rounded-2xl p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Blended Job Value</p>
              <p className="text-xl font-bold font-data text-[var(--anna-slate)] mt-1">
                {formatPrice(liveBlended)}
              </p>
              <p className="text-[10px] text-emerald-600 mt-0.5 flex items-center gap-1">
                <TrendingUp size={10} /> Live average
              </p>
            </div>
            <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Commission Rate</p>
              <p className="text-xl font-bold font-data text-[var(--anna-slate)] mt-1">
                {commissionState}%
              </p>
              <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">Platform cut per job</p>
            </div>
            <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Active Categories</p>
              <p className="text-xl font-bold font-data text-[var(--anna-slate)] mt-1">
                {categoryPricing.filter((c: Record<string, unknown>) => c.isActive).length}
              </p>
              <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">Of {categoryPricing.length} total</p>
            </div>
            <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Avg Vendor Payout</p>
              <p className="text-xl font-bold font-data text-[var(--anna-slate)] mt-1">
                {formatPrice(Math.round(liveBlended * (100 - commissionState) / 100))}
              </p>
              <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">After commission</p>
            </div>
          </div>

          {/* Category Pricing Sections */}
          <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--anna-border)] flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                Category Base Prices
              </h3>
              <div className="flex items-center gap-2">
                {isAdmin && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[10px] text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
                      onClick={resetPricing}
                      disabled={!hasPriceChanges}
                    >
                      <RotateCcw size={12} className="mr-1" />
                      Reset
                    </Button>
                    <Button
                      onClick={savePricing}
                      disabled={configMutation.isPending || !hasPriceChanges}
                      size="sm"
                      className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl text-xs font-semibold h-7"
                    >
                      <Save className="h-3 w-3 mr-1" />
                      {configMutation.isPending ? "Saving..." : "Save"}
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="max-h-[28rem] overflow-y-auto anna-scroll">
              {categoryPricing.map((p: Record<string, unknown>, idx: number) => {
                const isCustom = p.isCustom as boolean;
                const isActive = p.isActive as boolean;
                const cat = p.category as string;
                const currentPrice = priceState[cat] || p.activePriceCents;
                const vendorPayout = Math.round(currentPrice * (100 - commissionState) / 100);
                const changed = localPriceEdits && priceState[cat] !== (p.activePriceCents as number);
                const isOpen = expandedPriceCats[cat] !== undefined ? expandedPriceCats[cat] : idx === 0;
                return (
                  <Collapsible
                    key={cat}
                    open={isOpen}
                    onOpenChange={(v) => setExpandedPriceCats((prev) => ({ ...prev, [cat]: v }))}
                  >
                    <CollapsibleTrigger
                      className={cn(
                        "w-full px-5 py-3 flex items-center justify-between transition-colors border-b border-[var(--anna-border)]",
                        isActive ? "hover:bg-[var(--anna-sage-light)]/30" : "opacity-50"
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="font-medium text-sm text-[var(--anna-slate)]">
                          {p.label as string}
                        </span>
                        {!isActive && (
                          <Badge variant="secondary" className="text-[8px] bg-[var(--anna-bg)] text-[var(--anna-muted)]">
                            Inactive
                          </Badge>
                        )}
                        {isCustom ? (
                          <Badge variant="secondary" className="text-[8px] bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                            Custom
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[8px] bg-[var(--anna-bg)] text-[var(--anna-muted)]">
                            Default
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={cn(
                          "font-data text-sm",
                          isCustom ? "text-[var(--anna-sage-dark)] font-semibold" : "text-[var(--anna-slate)]"
                        )}>
                          {formatPrice(currentPrice)}
                        </span>
                        {isOpen ? (
                          <ChevronUp size={15} className="text-[var(--anna-muted)]" />
                        ) : (
                          <ChevronDown size={15} className="text-[var(--anna-muted)]" />
                        )}
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-5 py-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Default Price</p>
                          <p className="font-data text-sm text-[var(--anna-slate)] mt-1">{formatPrice(p.defaultPriceCents as number)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Current Price</p>
                          {isAdmin && isActive ? (
                            <div className="flex items-center gap-1 mt-1">
                              <span className="text-xs text-[var(--anna-muted)]">SGD $</span>
                              <Input
                                type="number"
                                min={0}
                                step={1}
                                value={Math.round(currentPrice / 100)}
                                onChange={(e) => {
                                  setLocalPriceEdits((prev) => ({
                                    ...(prev ?? priceEdits),
                                    [cat]: (parseFloat(e.target.value) || 0) * 100,
                                  }));
                                }}
                                className={cn(
                                  "w-24 h-8 text-right text-sm font-data rounded-lg border-[var(--anna-border)]",
                                  changed && "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/30"
                                )}
                              />
                            </div>
                          ) : (
                            <p className={cn(
                              "font-data text-sm mt-1",
                              isCustom ? "text-[var(--anna-sage-dark)] font-semibold" : "text-[var(--anna-slate)]"
                            )}>
                              {formatPrice(p.activePriceCents as number)}
                            </p>
                          )}
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Vendor Payout</p>
                          <p className="font-data text-sm text-emerald-700 mt-1">{formatPrice(vendorPayout)}</p>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          </div>

          {/* Commission Rate Editor */}
          {isAdmin && (
            <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Platform Commission Rate
                  </h3>
                  <p className="text-[10px] text-[var(--anna-muted)] mt-0.5">
                    Applied to all job types. Vendor payout = price × (1 - commission)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={commissionState}
                    onChange={(e) => setLocalCommission(parseInt(e.target.value) || 0)}
                    className={cn(
                      "w-16 h-8 text-center text-sm font-data rounded-lg border-[var(--anna-border)]",
                      localCommission !== null && localCommission !== effectiveCommission
                        ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/30"
                        : ""
                    )}
                  />
                  <span className="text-sm text-[var(--anna-muted)]">%</span>
                  <Button
                    onClick={saveCommission}
                    disabled={configMutation.isPending || localCommission === null || localCommission === effectiveCommission}
                    size="sm"
                    className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl text-xs font-semibold h-8"
                  >
                    Save
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Info note */}
          <div className="flex items-start gap-2.5 rounded-2xl border border-[var(--anna-border)] bg-[var(--anna-bg)] p-4 text-xs text-[var(--anna-muted)]">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p>
                <span className="font-semibold text-[var(--anna-slate)]">Blended Job Value</span> is automatically computed as the average base price across all active categories.
                Changing category prices recalculates this metric in real-time.
              </p>
              <p className="mt-1">
                Financial model baseline: SGD $68.00. Current live value:{" "}
                <span className="font-data font-semibold text-[var(--anna-sage-dark)]">{formatPrice(liveBlended)}</span>
                {liveBlended !== 6800 && (
                  <span className={liveBlended > 6800 ? " text-emerald-600" : " text-amber-600"}>
                    {" "}({liveBlended > 6800 ? "+" : ""}{((liveBlended - 6800) / 100).toFixed(2)} vs baseline)
                  </span>
                )}
              </p>
            </div>
          </div>
        </TabsContent>

        {/* ===== CATEGORIES TAB ===== */}
        <TabsContent value="categories" className="mt-4 space-y-4">
          <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--anna-border)] flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                Service Categories
              </h3>
              {isAdmin && (
                <Button
                  onClick={() => { setShowCreateCat(true); setNewCatName(""); setNewCatActive(true); }}
                  size="sm"
                  className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl text-[10px] font-semibold h-7"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Create Category
                </Button>
              )}
            </div>

            {showCreateCat && (
              <div className="px-5 py-4 border-b border-[var(--anna-border)] bg-[var(--anna-sage-light)]/20">
                <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                  <div className="flex-1">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] block mb-1.5">
                      Category Name
                    </label>
                    <Input
                      placeholder="e.g. Deep Cleaning"
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      className="h-8 text-xs rounded-lg border-[var(--anna-border)] bg-[var(--anna-white)]"
                      onKeyDown={(e) => e.key === "Enter" && createCategory()}
                    />
                    <p className="text-[9px] text-[var(--anna-muted)] mt-1">
                      Slug: <span className="font-data text-[var(--anna-slate)]">{newCatName.trim() ? newCatName.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") : "—"}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={newCatActive}
                        onCheckedChange={setNewCatActive}
                        className="data-[state=checked]:bg-[var(--anna-sage-dark)]"
                      />
                      <span className="text-xs text-[var(--anna-slate)]">Active</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        onClick={() => setShowCreateCat(false)}
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[10px] text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={createCategory}
                        disabled={!newCatName.trim() || configMutation.isPending}
                        size="sm"
                        className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl text-[10px] font-semibold h-7"
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)]">
                    <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                      Category
                    </th>
                    <th className="text-right px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c: Record<string, unknown>) => {
                    const active = c.isActive as boolean;
                    return (
                      <tr
                        key={c.name as string}
                        className={cn(
                          "border-b border-[var(--anna-border)] last:border-0 transition-colors",
                          !active && "opacity-60"
                        )}
                      >
                        <td className="px-5 py-3 font-medium text-[var(--anna-slate)]">
                          {c.label as string}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {isAdmin ? (
                            <Switch
                              checked={active}
                              onCheckedChange={(v) => toggleCategory(c.name as string, v)}
                              disabled={configMutation.isPending}
                              className="data-[state=checked]:bg-[var(--anna-sage-dark)] ml-auto"
                            />
                          ) : (
                            <Badge
                              variant="secondary"
                              className={cn(
                                "text-[10px] font-medium",
                                active
                                  ? "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
                                  : "bg-[var(--anna-bg)] text-[var(--anna-muted)]"
                              )}
                            >
                              {active ? "Active" : "Inactive"}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-[var(--anna-muted)]">
            Active categories are available to households. Inactive categories are config-only and not shown to users.
          </p>
        </TabsContent>

        {/* ===== JOB TYPES TAB ===== */}
        <TabsContent value="job-types" className="mt-4">
          {/* Header bar */}
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Service Job Types
            </h3>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <Button
                  onClick={openCreateDialog}
                  size="sm"
                  className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl text-[10px] font-semibold h-7"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Create
                </Button>
              )}
              <Badge
                variant="outline"
                className="text-[10px] font-data border-[var(--anna-border)] text-[var(--anna-slate-light)]"
              >
                Commission: {effectiveCommission}%
              </Badge>
            </div>
          </div>

          {/* Per-category collapsible sections */}
          <div className="space-y-3">
            {uniqueCats.map((cat: string, idx: number) => {
              const catJobTypes = jobTypes.filter((j: Record<string, unknown>) => j.category === cat);
              const isOpen = expandedJobCats[cat] !== undefined ? expandedJobCats[cat] : idx === 0;
              return (
                <Collapsible
                  key={cat}
                  open={isOpen}
                  onOpenChange={(v) => setExpandedJobCats((prev) => ({ ...prev, [cat]: v }))}
                  className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden"
                >
                  <CollapsibleTrigger className="w-full px-5 py-3.5 flex items-center justify-between hover:bg-[var(--anna-bg)] transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-sm text-[var(--anna-slate)]">
                        {cat.replace(/_/g, " ")}
                      </span>
                      <Badge variant="secondary" className="text-[10px] bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)] font-data">
                        {catJobTypes.length} {catJobTypes.length === 1 ? "service" : "services"}
                      </Badge>
                    </div>
                    {isOpen ? (
                      <ChevronUp size={16} className="text-[var(--anna-muted)]" />
                    ) : (
                      <ChevronDown size={16} className="text-[var(--anna-muted)]" />
                    )}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="max-h-72 overflow-y-auto anna-scroll">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-y border-[var(--anna-border)] bg-[var(--anna-bg)] sticky top-0">
                            <th className="text-left px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                              Service
                            </th>
                            <th className="text-right px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                              Price
                            </th>
                            <th className="text-left px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                              Unit
                            </th>
                            <th className="text-center px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                              Active
                            </th>
                            {isAdmin && (
                              <th className="text-center px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                                Edit
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {catJobTypes.map((j: Record<string, unknown>) => (
                            <tr
                              key={j.id as string}
                              className="border-b border-[var(--anna-border)] last:border-0 hover:bg-[var(--anna-sage-light)]/30 transition-colors"
                            >
                              <td className="px-5 py-2.5 font-medium text-[var(--anna-slate)]">
                                {j.name as string}
                              </td>
                              <td className="px-5 py-2.5 text-right">
                                {isAdmin ? (
                                  <div className="flex items-center justify-end gap-1">
                                    <span className="text-[10px] text-[var(--anna-muted)]">SGD $</span>
                                    <Input
                                      type="number"
                                      min={0}
                                      step={1}
                                      value={(j.basePriceCents as number / 100).toFixed(2)}
                                      onChange={(e) => {
                                        const newCents = Math.round((parseFloat(e.target.value) || 0) * 100);
                                        configMutation.mutate({
                                          action: "update_job_type",
                                          id: j.id,
                                          basePriceCents: newCents,
                                        });
                                      }}
                                      onBlur={(e) => {
                                        // Snap to round number on blur
                                        const raw = parseFloat(e.target.value);
                                        if (!isNaN(raw) && raw !== Math.floor(raw)) {
                                          const newCents = Math.round(raw) * 100;
                                          configMutation.mutate({
                                            action: "update_job_type",
                                            id: j.id,
                                            basePriceCents: newCents,
                                          });
                                        }
                                      }}
                                      className="w-20 h-7 text-right text-sm font-data rounded-lg border-[var(--anna-border)] bg-[var(--anna-white)]"
                                    />
                                  </div>
                                ) : (
                                  <span className="font-data text-sm text-[var(--anna-slate)]">
                                    {formatPrice(j.basePriceCents as number)}
                                  </span>
                                )}
                              </td>
                              <td className="px-5 py-2.5 text-xs text-[var(--anna-muted)]">
                                {j.unitLabel as string}
                              </td>
                              <td className="px-5 py-2.5 text-center">
                                {isAdmin ? (
                                  <Switch
                                    checked={j.isActive as boolean}
                                    onCheckedChange={(v) =>
                                      toggleJobType(j.id as string, v)
                                    }
                                    className="mx-auto"
                                  />
                                ) : (
                                  <Badge
                                    variant="secondary"
                                    className={cn(
                                      "text-[10px] font-medium",
                                      j.isActive
                                        ? "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
                                        : "bg-[var(--anna-bg)] text-[var(--anna-muted)]"
                                    )}
                                  >
                                    {j.isActive ? "On" : "Off"}
                                  </Badge>
                                )}
                              </td>
                              {isAdmin && (
                                <td className="px-3 py-2.5 text-center">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openEditDialog(j as unknown as ServiceJobType)}
                                    className="h-7 w-7 p-0 text-[var(--anna-muted)] hover:text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)]/50"
                                  >
                                    <Pencil size={13} />
                                  </Button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>

          {/* Job Type Edit/Create Dialog */}
          <JobTypeEditDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            jobType={editingJobType}
            categories={categories.map((c: Record<string, unknown>) => c.name as string)}
            isNew={isNewJobType}
            onSave={handleSaveJobType}
            onDelete={handleDeleteJobType}
          />
        </TabsContent>

        {/* ===== AUTONOMY THRESHOLDS TAB ===== */}
        <TabsContent value="thresholds" className="mt-4">
          <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--anna-border)] flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                Autonomy Thresholds
              </h3>
              <Button
                onClick={saveThresholds}
                disabled={configMutation.isPending || !hasThresholdChanges}
                size="sm"
                className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl text-xs font-semibold"
              >
                <Save className="h-3.5 w-3.5 mr-1" />
                {configMutation.isPending ? "Saving..." : "Save All"}
              </Button>
            </div>
            <div className="max-h-96 overflow-y-auto anna-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)] sticky top-0">
                    <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                      Category
                    </th>
                    {Array.from(
                      { length: MAX_AUTONOMY_LEVEL },
                      (_, i) => (
                        <th
                          key={i}
                          className="text-center px-2 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]"
                        >
                          <span className="font-data">L{i + 1}</span>
                          <br />
                          <span className="font-normal normal-case tracking-normal">
                            {AUTONOMY_LEVEL_NAMES[i]}
                          </span>
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {uniqueCats.map((cat: string) => (
                    <tr
                      key={cat}
                      className="border-b border-[var(--anna-border)] last:border-0 hover:bg-[var(--anna-sage-light)]/30 transition-colors"
                    >
                      <td className="px-5 py-2.5 font-medium text-xs text-[var(--anna-slate)]">
                        {cat.replace(/_/g, " ")}
                      </td>
                      {Array.from(
                        { length: MAX_AUTONOMY_LEVEL },
                        (_, i) => {
                          const key = `${cat}-${i + 1}`;
                          return (
                            <td
                              key={key}
                              className="px-1 py-2.5 text-center"
                            >
                              <Input
                                type="number"
                                min={0}
                                value={edits[key] ?? 0}
                                onChange={(e) =>
                                  setThreshold(
                                    cat,
                                    i + 1,
                                    parseInt(e.target.value) || 0
                                  )
                                }
                                className="w-16 h-8 text-center text-xs font-data mx-auto rounded-lg border-[var(--anna-border)]"
                              />
                            </td>
                          );
                        }
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-3 text-xs text-[var(--anna-muted)]">
            Number of verified booking cycles required before a household can be
            promoted to each autonomy level.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
