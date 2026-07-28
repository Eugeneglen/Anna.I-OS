"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { formatSgd } from "@/lib/ops-format";
import { ChevronDown, ChevronUp, Plus, Pencil } from "lucide-react";
import type { ServiceJobType } from "@/lib/types";

interface JobTypesTabProps {
  jobTypes: Record<string, unknown>[];
  effectiveCommission: number;
  isAdmin: boolean;
  onToggle: (id: string, isActive: boolean) => void;
  onEdit: (jobType: ServiceJobType) => void;
  onCreate: () => void;
  onUpdatePrice: (id: string, priceCents: number) => void;
}

export function JobTypesTab({
  jobTypes,
  effectiveCommission,
  isAdmin,
  onToggle,
  onEdit,
  onCreate,
  onUpdatePrice,
}: JobTypesTabProps) {
  const grouped = jobTypes.reduce<Record<string, Record<string, unknown>[]>>((acc, j) => {
    const cat = j.category as string;
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(j);
    return acc;
  }, {});

  const categoryOrder = Object.keys(grouped);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    categoryOrder.forEach((cat, i) => {
      initial[cat] = i === 0;
    });
    return initial;
  });

  const toggleSection = (category: string) => {
    setOpenSections((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  return (
    <div className="mt-4">
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--anna-border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
              Service Job Types
            </h3>
            <Badge
              variant="outline"
              className="text-[10px] font-data border-[var(--anna-border)] text-[var(--anna-slate-light)]"
            >
              Commission: {effectiveCommission}%
            </Badge>
          </div>
          {isAdmin && (
            <Button
              size="sm"
              className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl text-xs font-semibold h-7"
              onClick={onCreate}
            >
              <Plus className="h-3 w-3 mr-1" /> Create
            </Button>
          )}
        </div>
        <div className="max-h-[32rem] overflow-y-auto anna-scroll">
          {categoryOrder.map((category) => {
            const items = grouped[category];
            const isOpen = openSections[category] ?? false;
            const activeCount = items.filter((j) => j.isActive).length;

            return (
              <Collapsible
                key={category}
                open={isOpen}
                onOpenChange={() => toggleSection(category)}
              >
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between px-5 py-3 text-left border-b border-[var(--anna-border)] hover:bg-[var(--anna-sage-light)]/30 transition-colors">
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronUp size={14} className="text-[var(--anna-muted)]" /> : <ChevronDown size={14} className="text-[var(--anna-muted)]" />}
                      <span className="font-medium text-xs text-[var(--anna-slate)]">{category.replace(/_/g, " ")}</span>
                      <Badge variant="secondary" className="text-[8px] bg-[var(--anna-bg)] text-[var(--anna-muted)]">
                        {activeCount}/{items.length} active
                      </Badge>
                    </div>
                    <span className="font-data text-xs text-[var(--anna-muted)]">
                      {items.length} service{items.length !== 1 ? "s" : ""}
                    </span>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)]">
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
                          <th className="text-center px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                            Actions
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((j: Record<string, unknown>) => {
                        const jt = j as unknown as ServiceJobType;
                        return (
                          <tr
                            key={jt.id}
                            className={cn(
                              "border-b border-[var(--anna-border)] last:border-0 transition-colors",
                              jt.isActive ? "hover:bg-[var(--anna-sage-light)]/20" : "opacity-50"
                            )}
                          >
                            <td className="px-5 py-2.5 font-medium text-[var(--anna-slate)] text-xs">
                              {jt.name}
                            </td>
                            <td className="px-5 py-2.5 text-right">
                              {isAdmin ? (
                                <div className="flex items-center justify-end gap-1">
                                  <span className="text-xs text-[var(--anna-muted)]">SGD $</span>
                                  <Input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={Math.round(jt.basePriceCents / 100)}
                                    onChange={(e) =>
                                      onUpdatePrice(jt.id, Math.round((parseFloat(e.target.value) || 0) * 100))
                                    }
                                    className="w-20 h-7 text-right text-xs font-data rounded-lg border-[var(--anna-border)]"
                                  />
                                </div>
                              ) : (
                                <span className="font-data text-sm text-[var(--anna-slate)]">
                                  {formatSgd(jt.basePriceCents)}
                                </span>
                              )}
                            </td>
                            <td className="px-5 py-2.5 text-xs text-[var(--anna-muted)]">
                              {jt.unitLabel}
                            </td>
                            <td className="px-5 py-2.5 text-center">
                              {isAdmin ? (
                                <Switch
                                  checked={jt.isActive}
                                  onCheckedChange={(v) => onToggle(jt.id, v)}
                                  className="mx-auto"
                                />
                              ) : (
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    "text-[10px] font-medium",
                                    jt.isActive
                                      ? "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
                                      : "bg-[var(--anna-bg)] text-[var(--anna-muted)]"
                                  )}
                                >
                                  {jt.isActive ? "On" : "Off"}
                                </Badge>
                              )}
                            </td>
                            {isAdmin && (
                              <td className="px-5 py-2.5 text-center">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 w-7 p-0 text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
                                  onClick={() => onEdit(jt)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </div>
    </div>
  );
}
