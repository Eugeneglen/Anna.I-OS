"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save, Zap, Settings2, Plug } from "lucide-react";
import {
  AUTONOMY_LEVEL_NAMES,
  MAX_AUTONOMY_LEVEL,
} from "@/lib/constants";
import { EditableReadme } from "./editable-readme";

// ============================================================
// Anna.I — Ops Config: Thresholds (Autonomy) Tab
// ============================================================
// Editor grid of `cyclesRequired` values per category × autonomy level.
// Below the grid, shows 3 editable README sections that Ops admins
// can update to keep documentation current.
// ============================================================

interface ReadmeData {
  key: string;
  title: string;
  icon: React.ReactNode;
  content: string;
  defaultCollapsed: boolean;
}

const README_DEFS: Omit<ReadmeData, "content">[] = [
  {
    key: "readme_autonomy_levels",
    title: "Autonomy Levels",
    icon: <Zap className="h-3.5 w-3.5" />,
    defaultCollapsed: false,
  },
  {
    key: "readme_threshold_guide",
    title: "Threshold Configuration",
    icon: <Settings2 className="h-3.5 w-3.5" />,
    defaultCollapsed: true,
  },
  {
    key: "readme_api_automation",
    title: "API & Automation",
    icon: <Plug className="h-3.5 w-3.5" />,
    defaultCollapsed: true,
  },
];

interface ThresholdsTabProps {
  thresholds: Record<string, unknown>[];
  edits: Record<string, number>;
  onThresholdChange: (category: string, level: number, value: number) => void;
  onSave: () => void;
  hasChanges: boolean;
  isPending: boolean;
  isAdmin?: boolean;
  readmes?: Record<string, string>;
  onSaveReadme?: (key: string, content: string) => void;
  isSavingReadme?: boolean;
}

export function ThresholdsTab({
  thresholds,
  edits,
  onThresholdChange,
  onSave,
  hasChanges,
  isPending,
  isAdmin = true,
  readmes = {},
  onSaveReadme,
  isSavingReadme = false,
}: ThresholdsTabProps) {
  const uniqueCats = [
    ...new Set(
      thresholds.map((t: Record<string, unknown>) => t.category as string)
    ),
  ];

  return (
    <div className="mt-4 space-y-4">
      {/* Threshold Grid */}
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--anna-border)] flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
            Autonomy Thresholds
          </h3>
          <Button
            onClick={onSave}
            disabled={isPending || !hasChanges}
            size="sm"
            className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl text-xs font-semibold"
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            {isPending ? "Saving..." : "Save All"}
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
                              onThresholdChange(
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
      <p className="text-xs text-[var(--anna-muted)]">
        Number of verified booking cycles required before a household can be
        promoted to each autonomy level.
      </p>

      {/* Editable README Sections */}
      <div className="space-y-3 pt-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] px-1">
          Documentation & Guides
        </h3>
        {README_DEFS.map((def) => (
          <EditableReadme
            key={def.key}
            readmeKey={def.key}
            title={def.title}
            icon={def.icon}
            content={readmes[def.key] || ""}
            isAdmin={isAdmin}
            isSaving={isSavingReadme}
            onSave={onSaveReadme || (() => {})}
            defaultCollapsed={def.defaultCollapsed}
          />
        ))}
      </div>
    </div>
  );
}
