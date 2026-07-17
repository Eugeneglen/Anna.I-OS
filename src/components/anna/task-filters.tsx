"use client";

import { useState, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  SlidersHorizontal,
  X,
  CalendarIcon,
  ChevronDown,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  STATUS_LABELS,
  CATEGORY_DEFAULTS,
  type TaskStatus,
  type ServiceCategory,
  type Task,
} from "@/lib/types";
import { CategoryIcon } from "./category-icon";

// ─── Filter State ───────────────────────────────────────────

export interface TaskFilters {
  search: string;
  statuses: TaskStatus[];
  categories: ServiceCategory[];
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  sort: "newest" | "oldest" | "amount_high" | "amount_low";
}

export const DEFAULT_FILTERS: TaskFilters = {
  search: "",
  statuses: [],
  categories: [],
  dateFrom: undefined,
  dateTo: undefined,
  sort: "newest",
};

// ─── Filter Logic ───────────────────────────────────────────

export function applyTaskFilters(tasks: Task[], filters: TaskFilters): Task[] {
  let result = [...tasks];

  // Search: match instructions, category label, vendor name
  if (filters.search.trim()) {
    const q = filters.search.toLowerCase().trim();
    result = result.filter((t) => {
      const instructions = (t.instructions ?? "").toLowerCase();
      const category = CATEGORY_DEFAULTS[t.category]?.label.toLowerCase() ?? t.category.toLowerCase();
      const vendor = t.bookings?.[0]?.vendor?.name?.toLowerCase() ?? "";
      const jobType = t.jobType?.name?.toLowerCase() ?? "";
      return instructions.includes(q) || category.includes(q) || vendor.includes(q) || jobType.includes(q);
    });
  }

  // Status filter
  if (filters.statuses.length > 0) {
    result = result.filter((t) => filters.statuses.includes(t.status));
  }

  // Category filter
  if (filters.categories.length > 0) {
    result = result.filter((t) => filters.categories.includes(t.category));
  }

  // Date range filter — uses scheduledStart, fallback to createdAt
  if (filters.dateFrom) {
    const from = filters.dateFrom;
    from.setHours(0, 0, 0, 0);
    result = result.filter((t) => {
      const d = t.scheduledStart ?? t.createdAt;
      return new Date(d) >= from;
    });
  }
  if (filters.dateTo) {
    const to = filters.dateTo;
    to.setHours(23, 59, 59, 999);
    result = result.filter((t) => {
      const d = t.scheduledStart ?? t.createdAt;
      return new Date(d) <= to;
    });
  }

  // Sort
  switch (filters.sort) {
    case "newest":
      result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      break;
    case "oldest":
      result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      break;
    case "amount_high":
      result.sort((a, b) => b.amountCents - a.amountCents);
      break;
    case "amount_low":
      result.sort((a, b) => a.amountCents - b.amountCents);
      break;
  }

  return result;
}

// ─── Active filter count ────────────────────────────────────

export function countActiveFilters(filters: TaskFilters): number {
  let count = 0;
  if (filters.search.trim()) count++;
  if (filters.statuses.length > 0) count++;
  if (filters.categories.length > 0) count++;
  if (filters.dateFrom) count++;
  if (filters.dateTo) count++;
  if (filters.sort !== "newest") count++;
  return count;
}

// ─── Status filter options ──────────────────────────────────

// Group DISPATCHED + IN_PROGRESS under one "In Progress" label
const STATUS_OPTIONS: { value: TaskStatus[]; label: string; color: string }[] = [
  { value: ["CREATED"], label: STATUS_LABELS.CREATED, color: "bg-[var(--anna-warning)]" },
  { value: ["DISPATCHED", "IN_PROGRESS"], label: STATUS_LABELS.IN_PROGRESS, color: "bg-[var(--anna-sage)]" },
  { value: ["COMPLETED"], label: STATUS_LABELS.COMPLETED, color: "bg-[var(--anna-slate-light)]" },
  { value: ["VERIFIED"], label: STATUS_LABELS.VERIFIED, color: "bg-[var(--anna-success)]" },
  { value: ["ESCROW_RELEASED"], label: STATUS_LABELS.ESCROW_RELEASED, color: "bg-[var(--anna-muted)]" },
  { value: ["DISPUTED"], label: STATUS_LABELS.DISPUTED, color: "bg-[var(--anna-error)]" },
];

const ALL_STATUSES = Object.keys(STATUS_LABELS) as TaskStatus[];
const ALL_CATEGORIES = Object.keys(CATEGORY_DEFAULTS) as ServiceCategory[];

// ─── Component ──────────────────────────────────────────────

interface TaskFiltersBarProps {
  filters: TaskFilters;
  onChange: (filters: TaskFilters) => void;
  resultCount: number;
  totalCount: number;
}

export function TaskFiltersBar({ filters, onChange, resultCount, totalCount }: TaskFiltersBarProps) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const activeCount = countActiveFilters(filters);

  const update = useCallback(
    (patch: Partial<TaskFilters>) => onChange({ ...filters, ...patch }),
    [filters, onChange]
  );

  const toggleStatus = useCallback(
    (groupStatuses: TaskStatus[]) => {
      // If ALL in this group are selected, remove them. Otherwise add the missing ones.
      const allSelected = groupStatuses.every((s) => filters.statuses.includes(s));
      const next = allSelected
        ? filters.statuses.filter((s) => !groupStatuses.includes(s))
        : [...new Set([...filters.statuses, ...groupStatuses])];
      update({ statuses: next });
    },
    [filters.statuses, update]
  );

  const toggleCategory = useCallback(
    (cat: ServiceCategory) => {
      const next = filters.categories.includes(cat)
        ? filters.categories.filter((c) => c !== cat)
        : [...filters.categories, cat];
      update({ categories: next });
    },
    [filters.categories, update]
  );

  const clearAll = useCallback(() => onChange(DEFAULT_FILTERS), [onChange]);

  const isFiltered = activeCount > 0;

  // Status summary text
  const statusSummary = useMemo(() => {
    if (filters.statuses.length === 0) return "All statuses";
    if (filters.statuses.length === ALL_STATUSES.length) return "All statuses";
    // Map selected statuses to their display labels, deduplicating
    const labels = filters.statuses.map((s) => STATUS_LABELS[s]);
    const unique = [...new Set(labels)];
    if (unique.length <= 2) return unique.join(", ");
    return `${filters.statuses.length} statuses`;
  }, [filters.statuses]);

  // Category summary text
  const categorySummary = useMemo(() => {
    if (filters.categories.length === 0) return "All categories";
    if (filters.categories.length === ALL_CATEGORIES.length) return "All categories";
    if (filters.categories.length <= 2) {
      return filters.categories.map((c) => CATEGORY_DEFAULTS[c].label).join(", ");
    }
    return `${filters.categories.length} categories`;
  }, [filters.categories]);

  // Date summary text
  const dateSummary = useMemo(() => {
    if (!filters.dateFrom && !filters.dateTo) return "Any date";
    const from = filters.dateFrom?.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
    const to = filters.dateTo?.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
    if (from && to) return `${from} – ${to}`;
    if (from) return `From ${from}`;
    return `Until ${to}`;
  }, [filters.dateFrom, filters.dateTo]);

  return (
    <div className="px-4 lg:px-6 pt-4 lg:pt-6">
      {/* Search bar */}
      <div className="relative mb-3">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--anna-muted)] pointer-events-none"
        />
        <Input
          placeholder="Search tasks by description, category, or vendor..."
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
          className="h-10 pl-9 pr-9 rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm text-[var(--anna-slate)] placeholder:text-[var(--anna-muted)] focus-visible:ring-[var(--anna-sage)]/30 focus-visible:border-[var(--anna-sage)]"
        />
        {filters.search && (
          <button
            onClick={() => update({ search: "" })}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--anna-muted)] hover:text-[var(--anna-slate)] transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Status filter */}
        <Popover open={statusOpen} onOpenChange={setStatusOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-8 gap-1.5 rounded-lg text-xs font-medium border-[var(--anna-border)]",
                filters.statuses.length > 0 &&
                  "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/40 text-[var(--anna-sage-dark)]"
              )}
            >
              <SlidersHorizontal size={13} />
              {statusSummary}
              <ChevronDown size={12} className="opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3 rounded-xl border-[var(--anna-border)]" align="start">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[var(--anna-slate)]">Status</span>
              {filters.statuses.length > 0 && (
                <button
                  onClick={() => update({ statuses: [] })}
                  className="text-[10px] text-[var(--anna-sage-dark)] hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="space-y-1">
              {STATUS_OPTIONS.map((opt) => {
                const checked = opt.value.every((s) => filters.statuses.includes(s));
                const indeterminate = !checked && opt.value.some((s) => filters.statuses.includes(s));
                return (
                  <label
                    key={opt.label}
                    className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[var(--anna-sage-light)]/40 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleStatus(opt.value)}
                      className={cn(
                        "border-[var(--anna-border)]",
                        indeterminate && "opacity-60"
                      )}
                    />
                    <span className={cn("w-2 h-2 rounded-full shrink-0", opt.color)} />
                    <span className="text-xs text-[var(--anna-slate)]">{opt.label}</span>
                  </label>
                );
              })}
            </div>
            {/* Select all / None */}
            <Separator className="my-2 bg-[var(--anna-border)]" />
            <div className="flex gap-2">
              <button
                onClick={() => update({ statuses: [...ALL_STATUSES] })}
                className="flex-1 text-[10px] font-medium text-[var(--anna-muted)] hover:text-[var(--anna-slate)] py-1 rounded-md hover:bg-[var(--anna-sage-light)]/40 transition-colors"
              >
                Select all
              </button>
              <button
                onClick={() => update({ statuses: [] })}
                className="flex-1 text-[10px] font-medium text-[var(--anna-muted)] hover:text-[var(--anna-slate)] py-1 rounded-md hover:bg-[var(--anna-sage-light)]/40 transition-colors"
              >
                Clear all
              </button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Category filter */}
        <Popover open={categoryOpen} onOpenChange={setCategoryOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-8 gap-1.5 rounded-lg text-xs font-medium border-[var(--anna-border)]",
                filters.categories.length > 0 &&
                  "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/40 text-[var(--anna-sage-dark)]"
              )}
            >
              <SlidersHorizontal size={13} />
              {categorySummary}
              <ChevronDown size={12} className="opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3 rounded-xl border-[var(--anna-border)]" align="start">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[var(--anna-slate)]">Category</span>
              {filters.categories.length > 0 && (
                <button
                  onClick={() => update({ categories: [] })}
                  className="text-[10px] text-[var(--anna-sage-dark)] hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="space-y-0.5 max-h-64 overflow-y-auto anna-scroll">
              {ALL_CATEGORIES.map((cat) => (
                <label
                  key={cat}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[var(--anna-sage-light)]/40 cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={filters.categories.includes(cat)}
                    onCheckedChange={() => toggleCategory(cat)}
                    className="border-[var(--anna-border)]"
                  />
                  <CategoryIcon category={cat} size={14} />
                  <span className="text-xs text-[var(--anna-slate)]">{CATEGORY_DEFAULTS[cat].label}</span>
                </label>
              ))}
            </div>
            <Separator className="my-2 bg-[var(--anna-border)]" />
            <div className="flex gap-2">
              <button
                onClick={() => update({ categories: [...ALL_CATEGORIES] })}
                className="flex-1 text-[10px] font-medium text-[var(--anna-muted)] hover:text-[var(--anna-slate)] py-1 rounded-md hover:bg-[var(--anna-sage-light)]/40 transition-colors"
              >
                Select all
              </button>
              <button
                onClick={() => update({ categories: [] })}
                className="flex-1 text-[10px] font-medium text-[var(--anna-muted)] hover:text-[var(--anna-slate)] py-1 rounded-md hover:bg-[var(--anna-sage-light)]/40 transition-colors"
              >
                Clear all
              </button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Date range filter */}
        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-8 gap-1.5 rounded-lg text-xs font-medium border-[var(--anna-border)]",
                (filters.dateFrom || filters.dateTo) &&
                  "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/40 text-[var(--anna-sage-dark)]"
              )}
            >
              <CalendarIcon size={13} />
              {dateSummary}
              <ChevronDown size={12} className="opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3 rounded-xl border-[var(--anna-border)]" align="start">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-[var(--anna-slate)]">Date range</span>
              {(filters.dateFrom || filters.dateTo) && (
                <button
                  onClick={() => update({ dateFrom: undefined, dateTo: undefined })}
                  className="text-[10px] text-[var(--anna-sage-dark)] hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div>
                <span className="text-[10px] text-[var(--anna-muted)] mb-1 block">From</span>
                <Calendar
                  mode="single"
                  selected={filters.dateFrom}
                  onSelect={(d) => update({ dateFrom: d ?? undefined })}
                  className="rounded-lg border-0 p-0"
                  classNames={{
                    day_selected: "bg-[var(--anna-sage)] text-white hover:bg-[var(--anna-sage-dark)]",
                    day_today: "text-[var(--anna-sage-dark)] font-semibold",
                  }}
                />
              </div>
              {filters.dateFrom && (
                <>
                  <Separator className="bg-[var(--anna-border)]" />
                  <div>
                    <span className="text-[10px] text-[var(--anna-muted)] mb-1 block">To</span>
                    <Calendar
                      mode="single"
                      selected={filters.dateTo}
                      onSelect={(d) => update({ dateTo: d ?? undefined })}
                      disabled={{ before: filters.dateFrom }}
                      className="rounded-lg border-0 p-0"
                      classNames={{
                        day_selected: "bg-[var(--anna-sage)] text-white hover:bg-[var(--anna-sage-dark)]",
                        day_today: "text-[var(--anna-sage-dark)] font-semibold",
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          </PopoverContent>
        </Popover>

        {/* Sort */}
        <Select
          value={filters.sort}
          onValueChange={(v) => update({ sort: v as TaskFilters["sort"] })}
        >
          <SelectTrigger className="h-8 w-auto min-w-[120px] gap-1.5 rounded-lg text-xs font-medium border-[var(--anna-border)] bg-transparent">
            <span className="truncate">
              {filters.sort === "newest" && "Newest first"}
              {filters.sort === "oldest" && "Oldest first"}
              {filters.sort === "amount_high" && "Highest $"}
              {filters.sort === "amount_low" && "Lowest $"}
            </span>
          </SelectTrigger>
          <SelectContent className="rounded-xl border-[var(--anna-border)]">
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
            <SelectItem value="amount_high">Highest $</SelectItem>
            <SelectItem value="amount_low">Lowest $</SelectItem>
          </SelectContent>
        </Select>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Active filter count + clear */}
        {isFiltered && (
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className="h-6 gap-1 px-2 rounded-lg bg-[var(--anna-sage-light)]/60 text-[var(--anna-sage-dark)] text-[10px] font-semibold"
            >
              <Check size={10} />
              {resultCount} of {totalCount}
            </Badge>
            <button
              onClick={clearAll}
              className="h-6 px-2 rounded-lg text-[10px] font-medium text-[var(--anna-muted)] hover:text-[var(--anna-error)] hover:bg-[var(--anna-error)]/5 transition-colors"
            >
              Clear all
            </button>
          </div>
        )}
      </div>
    </div>
  );
}