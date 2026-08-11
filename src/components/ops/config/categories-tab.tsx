"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/(^_|_$)/g, "")
    .toUpperCase();
}

interface CategoriesTabProps {
  categories: Record<string, unknown>[];
  isAdmin: boolean;
  onToggle: (category: string, isActive: boolean) => void;
  onCreate: (name: string, slug: string, isActive: boolean) => void;
}

export function CategoriesTab({ categories, isAdmin, onToggle, onCreate }: CategoriesTabProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newActive, setNewActive] = useState(true);

  const liveSlug = generateSlug(newName);

  const handleCreate = () => {
    if (!newName.trim()) return;
    onCreate(newName.trim(), liveSlug, newActive);
    setNewName("");
    setNewActive(true);
    setShowCreate(false);
  };

  const handleCancel = () => {
    setNewName("");
    setNewActive(true);
    setShowCreate(false);
  };

  return (
    <div className="mt-4">
      <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--anna-border)] flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
            Service Categories
          </h3>
          {isAdmin && !showCreate && (
            <Button
              size="sm"
              className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl text-xs font-semibold h-7"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="h-3 w-3 mr-1" /> Create
            </Button>
          )}
        </div>

        {/* Inline Create Form */}
        {isAdmin && showCreate && (
          <div className="px-5 py-4 border-b border-[var(--anna-border)] bg-[var(--anna-bg)] space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--anna-slate)]">Name</label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Painting"
                  className="rounded-lg border-[var(--anna-border)] text-xs h-8"
                  autoFocus
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--anna-slate)]">Slug</label>
                <div className="h-8 flex items-center px-3 rounded-lg border border-[var(--anna-border)] bg-[var(--anna-white)]">
                  <span className="text-xs font-mono text-[var(--anna-muted)]">
                    {liveSlug || "AUTO_GENERATED"}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch checked={newActive} onCheckedChange={setNewActive} />
                <span className="text-xs text-[var(--anna-slate)]">Active</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-xs text-[var(--anna-muted)]" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white rounded-xl text-xs font-semibold h-7"
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                >
                  Save
                </Button>
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
                <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                  Slug
                </th>
                <th className="text-center px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                  Status
                </th>
                {isAdmin && (
                  <th className="text-center px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Toggle
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {categories.map((c: Record<string, unknown>) => (
                <tr
                  key={c.name as string}
                  className={cn(
                    "border-b border-[var(--anna-border)] last:border-0 transition-colors",
                    c.isActive ? "hover:bg-[var(--anna-sage-light)]/30" : "opacity-50"
                  )}
                >
                  <td className="px-5 py-3 font-medium text-[var(--anna-slate)]">
                    {c.label as string}
                  </td>
                  <td className="px-5 py-3">
                    <span className="text-xs font-mono text-[var(--anna-muted)]">
                      {c.name as string}
                    </span>
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
                  {isAdmin && (
                    <td className="px-5 py-3 text-center">
                      <Switch
                        checked={c.isActive as boolean}
                        onCheckedChange={(v) => onToggle(c.name as string, v)}
                        className="mx-auto"
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-3 text-xs text-[var(--anna-muted)]">
        Active categories are available to households. Inactive categories
        are config-only and not shown to users.
      </p>
    </div>
  );
}
