"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOpsUser } from "@/app/ops/(dashboard)/layout";
import { PLATFORM_COMMISSION_RATE } from "@/lib/constants";
import { OpsPageHeader } from "@/components/ops/ops-page-header";
import { PricingTab } from "@/components/ops/config/pricing-tab";
import { CategoriesTab } from "@/components/ops/config/categories-tab";
import { JobTypesTab } from "@/components/ops/config/job-types-tab";
import { ThresholdsTab } from "@/components/ops/config/thresholds-tab";
import { JobTypeEditDialog } from "@/components/ops/job-type-edit-dialog";
import type { ServiceJobType } from "@/lib/types";

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
  const isAdmin = user?.role === "ADMIN";

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

  // ── Job Type edit dialog state ──
  const [jtDialogOpen, setJtDialogOpen] = useState(false);
  const [jtDialogData, setJtDialogData] = useState<ServiceJobType | null>(null);
  const [jtDialogIsNew, setJtDialogIsNew] = useState(false);

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

  const toggleJobType = (id: string, isActive: boolean) =>
    configMutation.mutate({ action: "toggle_job_type", id, isActive });

  function savePricing() {
    const pricing = Object.entries(priceState).map(([category, priceCents]) => ({
      category,
      priceCents,
    }));
    configMutation.mutate({ action: "save_pricing", pricing });
    setLocalPriceEdits(null);
  }

  const saveCommission = () => {
    configMutation.mutate({ action: "save_commission", commissionRate: commissionState });
    setLocalCommission(null);
  };

  function resetPricing() {
    const defaults: Record<string, number> = {};
    for (const p of categoryPricing) {
      defaults[p.category] = p.defaultPriceCents;
    }
    setLocalPriceEdits(defaults);
    setLocalCommission(PLATFORM_COMMISSION_RATE);
  }

  const handlePriceChange = (category: string, cents: number) =>
    setLocalPriceEdits((prev) => ({ ...(prev ?? priceEdits), [category]: cents }));

  // ── Category handlers ──
  const toggleCategory = (category: string, isActive: boolean) =>
    configMutation.mutate({ action: "toggle_category", category, isActive });

  const createCategory = (name: string, slug: string, isActive: boolean) =>
    configMutation.mutate({ action: "create_category", name, slug, isActive });

  // ── Job type dialog handlers ──
  const handleEditJobType = (jobType: ServiceJobType) => {
    setJtDialogData(jobType);
    setJtDialogIsNew(false);
    setJtDialogOpen(true);
  };

  const handleCreateJobType = () => {
    setJtDialogData(null);
    setJtDialogIsNew(true);
    setJtDialogOpen(true);
  };

  const handleSaveJobType = (data: Record<string, unknown>) => {
    if (jtDialogIsNew) {
      configMutation.mutate({ action: "create_job_type", ...data });
    } else {
      configMutation.mutate({ action: "update_job_type", ...data });
    }
  };

  const handleDeleteJobType = (id: string) =>
    configMutation.mutate({ action: "delete_job_type", id });

  const handleUpdateJobTypePrice = (id: string, priceCents: number) =>
    configMutation.mutate({ action: "update_job_type_price", id, priceCents });

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

  const TABS = [
    { value: "pricing", label: "Pricing" },
    { value: "categories", label: "Categories" },
    { value: "job-types", label: "Job Types" },
    { value: "thresholds", label: "Autonomy" },
  ] as const;

  const categoryNames = categories.map((c: Record<string, unknown>) => c.name as string);

  return (
    <div className="space-y-4 pb-20 md:pb-0 anna-fade-in">
      <OpsPageHeader
        title="Configuration"
        subtitle="Manage categories, pricing, and autonomy thresholds"
      />

      <Tabs defaultValue="pricing">
        <TabsList className="bg-[var(--anna-white)] border border-[var(--anna-border)] rounded-xl p-1">
          {TABS.map((t) => (
            <TabsTrigger
              key={t.value}
              value={t.value}
              className="rounded-lg data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-[var(--anna-white)] text-xs font-medium text-[var(--anna-slate-light)]"
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ===== PRICING TAB ===== */}
        <TabsContent value="pricing">
          <PricingTab
            categoryPricing={categoryPricing}
            priceState={priceState}
            commissionState={commissionState}
            liveBlended={liveBlended}
            hasPriceChanges={hasPriceChanges}
            isEditing={localPriceEdits !== null}
            isAdmin={isAdmin}
            effectiveCommission={effectiveCommission}
            isPending={configMutation.isPending}
            onSave={savePricing}
            onSaveCommission={saveCommission}
            onReset={resetPricing}
            onPriceChange={handlePriceChange}
            onCommissionChange={setLocalCommission}
          />
        </TabsContent>

        {/* ===== CATEGORIES TAB ===== */}
        <TabsContent value="categories">
          <CategoriesTab
            categories={categories}
            isAdmin={isAdmin}
            onToggle={toggleCategory}
            onCreate={createCategory}
          />
        </TabsContent>

        {/* ===== JOB TYPES TAB ===== */}
        <TabsContent value="job-types">
          <JobTypesTab
            jobTypes={jobTypes}
            effectiveCommission={effectiveCommission}
            isAdmin={isAdmin}
            onToggle={toggleJobType}
            onEdit={handleEditJobType}
            onCreate={handleCreateJobType}
            onUpdatePrice={handleUpdateJobTypePrice}
          />
        </TabsContent>

        {/* ===== AUTONOMY THRESHOLDS TAB ===== */}
        <TabsContent value="thresholds">
          <ThresholdsTab
            thresholds={thresholds}
            edits={edits}
            onThresholdChange={setThreshold}
            onSave={saveThresholds}
            hasChanges={hasThresholdChanges}
            isPending={configMutation.isPending}
          />
        </TabsContent>
      </Tabs>

      {/* ===== JOB TYPE EDIT DIALOG ===== */}
      <JobTypeEditDialog
        open={jtDialogOpen}
        onOpenChange={setJtDialogOpen}
        jobType={jtDialogData}
        categories={categoryNames}
        isNew={jtDialogIsNew}
        onSave={handleSaveJobType}
        onDelete={isAdmin ? handleDeleteJobType : undefined}
      />
    </div>
  );
}
