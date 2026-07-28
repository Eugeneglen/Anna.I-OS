"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save, Trash2, Plus } from "lucide-react";
import type { ServiceJobType, ServiceCategory } from "@/lib/types";
import PricingRulesEditor from "@/components/ops/pricing-rules-editor";
import { RequiredFieldEditor } from "@/components/ops/required-field-editor";
import { AddOnEditor } from "@/components/ops/add-on-editor";

interface JobTypeEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobType: ServiceJobType | null;
  categories: string[];
  isNew?: boolean;
  onSave: (data: Record<string, unknown>) => void;
  onDelete?: (id: string) => void;
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function JobTypeEditDialog({
  open,
  onOpenChange,
  jobType,
  categories,
  isNew = false,
  onSave,
  onDelete,
}: JobTypeEditDialogProps) {
  // ── Basics ──────────────────────────────────────────────
  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [basePriceDollars, setBasePriceDollars] = useState("");
  const [unitLabel, setUnitLabel] = useState("");
  const [sortOrder, setSortOrder] = useState("0");

  // ── Sub-editors ──────────────────────────────────────────
  const [pricingRules, setPricingRules] = useState<ServiceJobType["pricingRules"]>({
    type: "flat",
  });
  const [requiredFields, setRequiredFields] = useState<
    ServiceJobType["requiredFields"]
  >([]);
  const [addOns, setAddOns] = useState<ServiceJobType["addOns"]>([]);

  // ── Initialize form when dialog opens (key-based reset) ───
  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- intentional: reset form state when dialog reopens */
    if (isNew || !jobType) {
      setName("");
      setCategory(categories[0] ?? "");
      setSlug("");
      setDescription("");
      setBasePriceDollars("");
      setUnitLabel("");
      setSortOrder("0");
      setPricingRules({ type: "flat" });
      setRequiredFields([]);
      setAddOns([]);
    } else {
      setName(jobType.name);
      setCategory(jobType.category);
      setSlug(jobType.slug);
      setDescription(jobType.description);
      setBasePriceDollars((jobType.basePriceCents / 100).toFixed(2));
      setUnitLabel(jobType.unitLabel);
      setSortOrder(String(jobType.sortOrder));
      setPricingRules(structuredClone(jobType.pricingRules) ?? { type: "flat" });
      setRequiredFields(structuredClone(jobType.requiredFields) ?? []);
      setAddOns(structuredClone(jobType.addOns) ?? []);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, isNew, jobType]);

  // ── Auto-slug from name ──────────────────────────────────
  const handleNameChange = useCallback((value: string) => {
    setName(value);
    setSlug(generateSlug(value));
  }, []);

  // ── Save handler ─────────────────────────────────────────
  const handleSave = () => {
    const basePriceCents = Math.round(parseFloat(basePriceDollars || "0") * 100);

    onSave({
      id: isNew ? undefined : jobType?.id,
      name,
      category,
      slug,
      description,
      basePriceCents,
      unitLabel,
      sortOrder: parseInt(sortOrder, 10) || 0,
      pricingRules,
      requiredFields,
      addOns,
    });

    onOpenChange(false);
  };

  // ── Delete handler ───────────────────────────────────────
  const handleDelete = () => {
    if (!jobType || !onDelete) return;
    onDelete(jobType.id);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)]">
        {/* ── Header ─────────────────────────────────────── */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-[var(--anna-border)]">
          <DialogTitle className="text-base font-semibold text-[var(--anna-slate)]">
            {isNew ? "Create New Job Type" : "Edit Job Type"}
          </DialogTitle>
          <DialogDescription className="text-xs text-[var(--anna-muted)] mt-1">
            {isNew
              ? "Configure a new service for your customers."
              : "Update the details and pricing for this service."}
          </DialogDescription>
        </DialogHeader>

        {/* ── Scrollable body ────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* ── Basics Section ──────────────────────────── */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
              Basics
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Name */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--anna-slate)]">
                  Name
                </label>
                <Input
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. Deep Cleaning"
                  className="rounded-lg border-[var(--anna-border)] text-xs"
                />
              </div>

              {/* Category */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--anna-slate)]">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-9 rounded-lg border-[var(--anna-border)] bg-[var(--anna-white)] px-3 text-xs text-[var(--anna-slate)] focus:outline-none focus:ring-2 focus:ring-[var(--anna-sage-light)]"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>

              {/* Slug */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--anna-slate)]">
                  Slug
                </label>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="auto-generated-from-name"
                  className="rounded-lg border-[var(--anna-border)] text-xs font-mono"
                />
              </div>

              {/* Description */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--anna-slate)]">
                  Description
                </label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Short description for customers"
                  className="rounded-lg border-[var(--anna-border)] text-xs"
                />
              </div>

              {/* Base Price */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--anna-slate)]">
                  Base Price (SGD)
                </label>
                <Input
                  type="number"
                  step={1}
                  min="0"
                  value={basePriceDollars}
                  onChange={(e) => setBasePriceDollars(e.target.value)}
                  placeholder="0"
                  className="rounded-lg border-[var(--anna-border)] text-xs"
                />
              </div>

              {/* Unit Label */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--anna-slate)]">
                  Unit Label
                </label>
                <Input
                  value={unitLabel}
                  onChange={(e) => setUnitLabel(e.target.value)}
                  placeholder="e.g. room, item, session"
                  className="rounded-lg border-[var(--anna-border)] text-xs"
                />
              </div>

              {/* Sort Order */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[var(--anna-slate)]">
                  Sort Order
                </label>
                <Input
                  type="number"
                  min="0"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  placeholder="0"
                  className="rounded-lg border-[var(--anna-border)] text-xs"
                />
              </div>
            </div>
          </section>

          {/* Divider */}
          <div className="border-t border-[var(--anna-border)]" />

          {/* ── Pricing Rules Section ────────────────────── */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
              Pricing Rules
            </h3>
            <PricingRulesEditor
              rules={pricingRules}
              onChange={setPricingRules}
            />
          </section>

          {/* Divider */}
          <div className="border-t border-[var(--anna-border)]" />

          {/* ── Required Fields Section ──────────────────── */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
              Required Fields
            </h3>
            <RequiredFieldEditor
                  fields={requiredFields}
                  onChange={setRequiredFields}
                />
          </section>

          {/* Divider */}
          <div className="border-t border-[var(--anna-border)]" />

          {/* ── Add-ons Section ──────────────────────────── */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-3">
              Add-ons
            </h3>
            <AddOnEditor
              addOns={addOns}
              onChange={setAddOns}
            />
          </section>
        </div>

        {/* ── Footer ─────────────────────────────────────── */}
        <DialogFooter className="px-6 py-4 border-t border-[var(--anna-border)] flex flex-col-reverse sm:flex-row sm:justify-end gap-2 bg-[var(--anna-bg)]">
          {onDelete && !isNew && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleDelete}
              className="bg-red-500/10 text-red-600 hover:bg-red-500/20 text-xs mr-auto sm:mr-2"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-xs text-[var(--anna-muted)] hover:text-[var(--anna-slate)]"
          >
            Cancel
          </Button>

          <Button
            type="button"
            onClick={handleSave}
            className="bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white text-xs"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {isNew ? "Create" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
