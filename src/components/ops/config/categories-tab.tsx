"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ============================================================
// Anna.I — Ops Config: Categories Tab
// ============================================================
// Read-only table of service categories with their active/inactive
// status badge. Categories are toggled at the data layer (not here) —
// inactive categories (Painting, Pest Control, Locksmith) remain
// config-only and are never surfaced to households.
// ============================================================

interface CategoriesTabProps {
  categories: Record<string, unknown>[];
}

export function CategoriesTab({ categories }: CategoriesTabProps) {
  return (
    <div className="mt-4">
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
    </div>
  );
}
