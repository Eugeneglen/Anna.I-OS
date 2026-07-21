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
import { Save, Info, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOpsUser } from "@/app/ops/(dashboard)/layout";
import {
  AUTONOMY_LEVEL_NAMES,
  MAX_AUTONOMY_LEVEL,
  PLATFORM_COMMISSION_RATE,
} from "@/lib/constants";

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
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
  const isAdmin = user?.role === "ADMIN";

  // Threshold editing state
  const thresholdEdits = (() => {
    const edits: Record<string, number> = {};
    for (const t of thresholds) {
      edits[`${t.category}-${t.level}`] = t.cyclesRequired;
    }
    return edits;
  })();

  const [localEdits, setLocalEdits] = useState<Record<string, number> | null>(
    null
  );
  const edits = localEdits ?? thresholdEdits;

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
    configMutation.mutate({
      action: "save_thresholds",
      thresholds: arr,
    });
  }

  function toggleJobType(id: string, isActive: boolean) {
    configMutation.mutate({ action: "toggle_job_type", id, isActive });
  }

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

      <Tabs defaultValue="categories">
        <TabsList className="bg-[var(--anna-white)] border border-[var(--anna-border)] rounded-xl p-1">
          <TabsTrigger
            value="categories"
            className="rounded-lg data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-[var(--anna-white)] text-xs font-medium text-[var(--anna-slate-light)]"
          >
            Categories
          </TabsTrigger>
          <TabsTrigger
            value="pricing"
            className="rounded-lg data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-[var(--anna-white)] text-xs font-medium text-[var(--anna-slate-light)]"
          >
            Pricing
          </TabsTrigger>
          <TabsTrigger
            value="thresholds"
            className="rounded-lg data-[state=active]:bg-[var(--anna-sage)] data-[state=active]:text-[var(--anna-white)] text-xs font-medium text-[var(--anna-slate-light)]"
          >
            Autonomy
          </TabsTrigger>
        </TabsList>

        {/* ===== CATEGORIES TAB ===== */}
        <TabsContent value="categories" className="mt-4">
          <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--anna-border)]">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                Service Categories
              </h3>
            </div>
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)]">
                    <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                      Category
                    </th>
                    <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c: Record<string, unknown>) => (
                    <tr
                      key={c.name as string}
                      className="border-b border-[var(--anna-border)] last:border-0"
                    >
                      <td className="px-5 py-3 font-medium text-[var(--anna-slate)]">
                        {c.label as string}
                      </td>
                      <td className="px-5 py-3">
                        <Badge
                          variant="secondary"
                          className={cn(
                            "text-[10px] font-medium",
                            c.isActive
                              ? "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
                              : "bg-[var(--anna-bg)] text-[var(--anna-muted)]"
                          )}
                        >
                          {c.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-3 text-xs text-[var(--anna-muted)]">
            Active categories are available to households. Inactive categories
            (Painting, Pest Control, Locksmith) are config-only and not shown to
            users.
          </p>
        </TabsContent>

        {/* ===== PRICING TAB ===== */}
        <TabsContent value="pricing" className="mt-4 space-y-4">
          <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--anna-border)] flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                Service Job Types
              </h3>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="text-[10px] font-data border-[var(--anna-border)] text-[var(--anna-slate-light)]"
                >
                  Commission: {PLATFORM_COMMISSION_RATE}%
                </Badge>
                <Tooltip>
                  <TooltipTrigger>
                    <Info className="h-3.5 w-3.5 text-[var(--anna-muted)]" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs">
                    Anna.I sets all prices. Vendor payout = price minus{" "}
                    {PLATFORM_COMMISSION_RATE}% commission.
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto anna-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)] sticky top-0">
                    <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                      Category
                    </th>
                    <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                      Service
                    </th>
                    <th className="text-right px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                      Price
                    </th>
                    <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                      Unit
                    </th>
                    <th className="text-center px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                      Active
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {jobTypes.map((j: Record<string, unknown>) => (
                    <tr
                      key={j.id as string}
                      className="border-b border-[var(--anna-border)] last:border-0 hover:bg-[var(--anna-sage-light)]/30 transition-colors"
                    >
                      <td className="px-5 py-2.5 text-xs text-[var(--anna-muted)]">
                        {(j.category as string).replace(/_/g, " ")}
                      </td>
                      <td className="px-5 py-2.5 font-medium text-[var(--anna-slate)]">
                        {j.name as string}
                      </td>
                      <td className="px-5 py-2.5 text-right font-data text-sm text-[var(--anna-slate)]">
                        {formatPrice(j.basePriceCents as number)}
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Blended value callout */}
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
            <AlertTriangle
              className="h-4 w-4 mt-0.5 shrink-0"
            />
            <div>
              <p className="font-semibold">
                Blended Job Value:{" "}
                <span className="font-data">$68.00</span>
              </p>
              <p className="mt-0.5 opacity-80">
                Revalidation needed — calibrated for original 4-category mix, now
                7 active categories.
              </p>
            </div>
          </div>
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
                disabled={configMutation.isPending}
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