"use client";

import { useEffect, useRef, useState } from "react";
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
  /** Saves an inline price edit; resolves false when the server rejects it
   *  (the caller's mutation already surfaced the error toast) so this
   *  component can revert the displayed draft. */
  onUpdatePrice: (id: string, priceCents: number) => Promise<boolean> | boolean;
}

// ── P1 (AUDIT-3): debounced inline price editor ──
// The inline price input used to fire onUpdatePrice on EVERY keystroke,
// and the backing API action (update_job_type_price) didn't even exist —
// each keystroke 400'd with "Unknown action". The action is now wired
// server-side; this side debounces (700ms) so a typed "$85" sends ONE
// write, not "8", "80", "85". Local edits keep the input responsive;
// the debounced value must differ from the server value to fire.
const PRICE_DEBOUNCE_MS = 700;
// Mirrors the server-side P7 bounds ($1–$100k in cents).
const MIN_PRICE_CENTS = 100;
const MAX_PRICE_CENTS = 10_000_000;

export function JobTypesTab({
  jobTypes,
  effectiveCommission,
  isAdmin,
  onToggle,
  onEdit,
  onCreate,
  onUpdatePrice,
}: JobTypesTabProps) {
  // ── P1: local price-edit state + debounce timers ──
  const [priceEdits, setPriceEdits] = useState<Record<string, number>>({});
  const priceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const schedulePriceSave = (id: string, priceCents: number, serverValue: number) => {
    setPriceEdits((prev) => ({ ...prev, [id]: priceCents }));
    clearTimeout(priceTimers.current[id]);
    if (priceCents === serverValue) return; // no-op edit
    if (
      !Number.isFinite(priceCents) ||
      priceCents < MIN_PRICE_CENTS ||
      priceCents > MAX_PRICE_CENTS ||
      !Number.isInteger(priceCents)
    ) {
      return; // invalid draft — never sent; reverted on blur
    }
    priceTimers.current[id] = setTimeout(async () => {
      // POLICE-4 finding #5: revert the draft when the server rejects the
      // save (validation bounds, concurrent delete, …) — a failed save
      // must never keep displaying as if it persisted.
      let ok: boolean;
      try {
        ok = await onUpdatePrice(id, priceCents);
      } catch {
        ok = false;
      }
      if (!ok) revertPriceEdit(id);
      // On success, keep the local edit until the ops-config refetch
      // lands so the input never flickers back to the stale server value
      // mid-save.
    }, PRICE_DEBOUNCE_MS);
  };

  // Blur with an invalid (or empty) draft → revert the display to the
  // server value; nothing was ever sent for it.
  const revertPriceEdit = (id: string) => {
    clearTimeout(priceTimers.current[id]);
    setPriceEdits((prev) => {
      if (prev[id] === undefined) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  // Note on stale drafts: after a successful save the ops-config query
  // refetches and the server value equals the draft, so the display stays
  // correct; the no-op check in schedulePriceSave compares against the
  // FRESH server value from props, so re-editing works correctly too.

  // Clear any pending timers on unmount so navigations can't fire
  // orphaned writes after the component is gone.
  useEffect(() => {
    const timers = priceTimers.current;
    return () => {
      for (const t of Object.values(timers)) clearTimeout(t);
    };
  }, []);
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
                                    min={1}
                                    step={1}
                                    value={
                                      priceEdits[jt.id] !== undefined
                                        ? Math.round(priceEdits[jt.id] / 100)
                                        : Math.round(jt.basePriceCents / 100)
                                    }
                                    onChange={(e) =>
                                      schedulePriceSave(
                                        jt.id,
                                        Math.round((parseFloat(e.target.value) || 0) * 100),
                                        jt.basePriceCents
                                      )
                                    }
                                    onBlur={() => {
                                      const draft = priceEdits[jt.id];
                                      if (
                                        draft === undefined ||
                                        draft === jt.basePriceCents ||
                                        draft < MIN_PRICE_CENTS ||
                                        draft > MAX_PRICE_CENTS
                                      ) {
                                        revertPriceEdit(jt.id);
                                      }
                                    }}
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
