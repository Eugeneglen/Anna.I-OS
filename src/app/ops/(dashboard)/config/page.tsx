"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Save, Info, AlertTriangle } from "lucide-react";
import { useOpsUser } from "@/app/ops/(dashboard)/layout";
import { AUTONOMY_LEVEL_NAMES, MAX_AUTONOMY_LEVEL, PLATFORM_COMMISSION_RATE } from "@/lib/constants";

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

  // Threshold editing state — derive from query data
  const thresholdEdits = (() => {
    const edits: Record<string, number> = {};
    for (const t of thresholds) {
      edits[`${t.category}-${t.level}`] = t.cyclesRequired;
    }
    return edits;
  })();

  const [localEdits, setLocalEdits] = useState<Record<string, number> | null>(null);
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
    configMutation.mutate({ action: "save_thresholds", thresholds: arr });
  }

  function toggleJobType(id: string, isActive: boolean) {
    configMutation.mutate({ action: "toggle_job_type", id, isActive });
  }

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-10 w-48" /><Skeleton className="h-96 w-full" /></div>;
  }

  const uniqueCats = [...new Set(jobTypes.map((j: Record<string, unknown>) => j.category as string))];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Configuration</h2>
        <p className="text-sm text-muted-foreground">Manage categories, pricing, and autonomy thresholds</p>
      </div>

      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="thresholds">Autonomy</TabsTrigger>
        </TabsList>

        {/* ===== CATEGORIES TAB ===== */}
        <TabsContent value="categories" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Service Categories</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium">Category</th>
                      <th className="text-left px-4 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((c: Record<string, unknown>) => (
                      <tr key={c.name as string} className="border-b last:border-0">
                        <td className="px-4 py-3 font-medium">{c.label as string}</td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary" className={c.isActive ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}>
                            {c.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Active categories are available to households. Inactive categories (Painting, Pest Control, Locksmith) are config-only and not shown to users.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== PRICING TAB ===== */}
        <TabsContent value="pricing" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Service Job Types</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    Commission: {PLATFORM_COMMISSION_RATE}%
                  </Badge>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">
                      Anna.I sets all prices. Vendor payout = price minus {PLATFORM_COMMISSION_RATE}% commission.
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden">
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-medium">Category</th>
                        <th className="text-left px-4 py-2.5 font-medium">Service</th>
                        <th className="text-right px-4 py-2.5 font-medium">Price</th>
                        <th className="text-left px-4 py-2.5 font-medium">Unit</th>
                        <th className="text-center px-4 py-2.5 font-medium">Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobTypes.map((j: Record<string, unknown>) => (
                        <tr key={j.id as string} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            {(j.category as string).replace(/_/g, " ")}
                          </td>
                          <td className="px-4 py-2.5 font-medium">{j.name as string}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-sm">
                            {formatPrice(j.basePriceCents as number)}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            {j.unitLabel as string}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {isAdmin ? (
                              <Switch
                                checked={j.isActive as boolean}
                                onCheckedChange={(v) => toggleJobType(j.id as string, v)}
                                className="mx-auto"
                              />
                            ) : (
                              <Badge variant="secondary" className={j.isActive ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-500"}>
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
            </CardContent>
          </Card>

          {/* Blended value callout */}
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Blended Job Value: $68.00</p>
              <p className="mt-0.5">Revalidation needed — calibrated for original 4-category mix, now 7 active categories.</p>
            </div>
          </div>
        </TabsContent>

        {/* ===== AUTONOMY THRESHOLDS TAB ===== */}
        <TabsContent value="thresholds" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Autonomy Thresholds</CardTitle>
                <Button
                  onClick={saveThresholds}
                  disabled={configMutation.isPending}
                  size="sm"
                  style={{ backgroundColor: "#10b981" }}
                  className="text-white"
                >
                  <Save className="h-3.5 w-3.5 mr-1" />
                  {configMutation.isPending ? "Saving..." : "Save All"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden">
                <div className="max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-medium">Category</th>
                        {Array.from({ length: MAX_AUTONOMY_LEVEL }, (_, i) => (
                          <th key={i} className="text-center px-3 py-2.5 font-medium text-xs">
                            L{i + 1}
                            <br />
                            <span className="font-normal text-muted-foreground">
                              {AUTONOMY_LEVEL_NAMES[i]}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {uniqueCats.map((cat: string) => (
                        <tr key={cat} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="px-4 py-2.5 font-medium text-xs">
                            {cat.replace(/_/g, " ")}
                          </td>
                          {Array.from({ length: MAX_AUTONOMY_LEVEL }, (_, i) => {
                            const key = `${cat}-${i + 1}`;
                            return (
                              <td key={key} className="px-1 py-2.5 text-center">
                                <Input
                                  type="number"
                                  min={0}
                                  value={edits[key] ?? 0}
                                  onChange={(e) =>
                                    setThreshold(cat, i + 1, parseInt(e.target.value) || 0)
                                  }
                                  className="w-16 h-8 text-center text-xs mx-auto"
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Number of verified booking cycles required before a household can be promoted to each autonomy level.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}