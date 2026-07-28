"use client";

import { ChevronRight, MapPin } from "lucide-react";
import { parseCategoryList } from "@/lib/ops-format";

// ============================================================
// Anna.I — Ops Households Mobile Card List
// ============================================================
// The `md:hidden` card list shown on mobile. Receives the
// filtered household list and a selection handler. Visual
// output must stay pixel-identical to the original page.
// ============================================================

interface HouseholdMobileListProps {
  households: Record<string, unknown>[];
  onSelect: (id: string) => void;
}

export function HouseholdMobileList({ households, onSelect }: HouseholdMobileListProps) {
  return (
    <div className="md:hidden space-y-2">
      {households.map((h: Record<string, unknown>) => {
        const cats = parseCategoryList(h.activeCategories as string);
        return (
          <div
            key={h.id as string}
            onClick={() => onSelect(h.id as string)}
            className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 hover:shadow-sm transition-all cursor-pointer"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[var(--anna-slate)]">{h.name as string}</p>
                <p className="text-xs text-[var(--anna-muted)] mt-0.5">{h.email as string}</p>
              </div>
              <ChevronRight size={16} className="text-[var(--anna-muted)] shrink-0 mt-0.5" />
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--anna-muted)]">
              <MapPin size={10} />
              <span className="truncate">{h.address as string || "—"}</span>
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {cats.slice(0, 3).map((c) => (
                <span key={c} className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                  {c.replace(/_/g, " ")}
                </span>
              ))}
              {cats.length > 3 && (
                <span className="text-[10px] text-[var(--anna-muted)] font-data">+{cats.length - 3}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
