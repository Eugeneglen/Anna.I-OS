"use client";

import { Badge } from "@/components/ui/badge";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseCategoryList } from "@/lib/ops-format";
import { SUBSCRIPTION_STYLES } from "./households-styles";

// ============================================================
// Anna.I — Ops Households Desktop Table
// ============================================================
// The `hidden md:block` table view shown on tablet/desktop.
// Receives the filtered household list and a selection handler.
// Visual output must stay pixel-identical to the original page.
// ============================================================

interface HouseholdTableProps {
  households: Record<string, unknown>[];
  onSelect: (id: string) => void;
}

export function HouseholdTable({ households, onSelect }: HouseholdTableProps) {
  return (
    <div className="hidden md:block bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--anna-border)] bg-[var(--anna-bg)]">
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Name</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Contact</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Location</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Categories</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Subscription</th>
            <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">Joined</th>
          </tr>
        </thead>
        <tbody>
          {households.map((h: Record<string, unknown>) => {
            const cats = parseCategoryList(h.activeCategories as string);
            const subs = (h.subscriptions as Record<string, unknown>[]) || [];
            const sub = subs[0];
            const subTier = (sub?.tier as string) || "HOME";
            const subStatus = (sub?.status as string) || "";
            return (
              <tr
                key={h.id as string}
                onClick={() => onSelect(h.id as string)}
                className="border-b border-[var(--anna-border)] last:border-0 hover:bg-[var(--anna-sage-light)]/30 cursor-pointer transition-colors group"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[var(--anna-slate)]">{h.name as string}</span>
                    <ChevronRight size={14} className="text-[var(--anna-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <p className="text-xs text-[var(--anna-slate-light)]">{h.email as string}</p>
                  <p className="text-[10px] text-[var(--anna-muted)]">{h.phone as string || "—"}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="text-xs text-[var(--anna-slate-light)] truncate max-w-48">{h.address as string || "—"}</p>
                  <p className="text-[10px] text-[var(--anna-muted)] font-data">{h.postalCode as string || ""} {h.unitNumber ? `#${h.unitNumber as string}` : ""}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {cats.slice(0, 2).map((c) => (
                      <span key={c} className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]">
                        {c.replace(/_/g, " ")}
                      </span>
                    ))}
                    {cats.length > 2 && (
                      <span className="text-[10px] text-[var(--anna-muted)] font-data">+{cats.length - 2}</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  {sub ? (
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className={cn("text-[10px] font-medium", SUBSCRIPTION_STYLES[subTier] || SUBSCRIPTION_STYLES["HOME"])}>
                        {subTier}
                      </Badge>
                      <Badge variant="secondary" className={cn("text-[10px] font-medium", subStatus === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600")}>
                        {subStatus}
                      </Badge>
                    </div>
                  ) : (
                    <span className="text-[10px] text-[var(--anna-muted)]">—</span>
                  )}
                </td>
                <td className="px-4 py-3 font-data text-xs text-[var(--anna-muted)]">
                  {new Date(h.createdAt as string).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
