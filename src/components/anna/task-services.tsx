"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAnnaStore } from "@/lib/store";
import {
  CategoryIcon,
  getCategoryLabel,
} from "./category-icon";
import { BookingForm } from "./booking-form";
import {
  formatSgd,
  CATEGORY_DEFAULTS,
  type ServiceCategory,
  type ServiceJobType,
} from "@/lib/types";
import type { RebookData } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Search, ChevronRight, Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const CATEGORIES: ServiceCategory[] = [
  "CLEANING",
  "LAUNDRY",
  "AIRCON",
  "PLUMBING",
  "ELECTRICAL",
  "PAINTING",
  "PEST_CONTROL",
  "HANDYMAN",
  "LOCKSMITH",
  "APPLIANCE_REPAIR",
];

const CATEGORY_DESCRIPTIONS: Record<ServiceCategory, string> = {
  CLEANING: "Regular & deep cleaning for homes and offices",
  LAUNDRY: "Wash, dry, fold & ironing services",
  AIRCON: "Installation, servicing & chemical wash",
  PLUMBING: "Repairs, installations & emergency fixes",
  ELECTRICAL: "Wiring, fixtures & power troubleshooting",
  PAINTING: "Interior & exterior painting for any space",
  PEST_CONTROL: "Inspection, treatment & prevention",
  HANDYMAN: "General repairs, assembly & maintenance",
  LOCKSMITH: "Lock changes, key duplication & emergency access",
  APPLIANCE_REPAIR: "Diagnosis & repair for home appliances",
};

type ViewState =
  | { mode: "browse" }
  | { mode: "category"; category: ServiceCategory }
  | { mode: "booking"; category: ServiceCategory; jobType?: ServiceJobType | null };

async function fetchJobTypes(category: ServiceCategory): Promise<ServiceJobType[]> {
  const res = await fetch(`/api/job-types?category=${category}`);
  if (!res.ok) throw new Error("Failed to fetch job types");
  const data = await res.json();
  return data.jobTypes;
}

function CategoryCard({
  category,
  onClick,
}: {
  category: ServiceCategory;
  onClick: () => void;
}) {
  const defaults = CATEGORY_DEFAULTS[category];
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left w-full",
        "border-[var(--anna-border)] bg-[var(--anna-white)] hover:border-[var(--anna-sage)]/40 hover:shadow-sm"
      )}
    >
      <CategoryIcon category={category} size={22} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-[var(--anna-slate)]">
            {getCategoryLabel(category)}
          </span>
          <ChevronRight
            size={16}
            className="shrink-0 text-[var(--anna-muted)]"
          />
        </div>
        <p className="text-xs text-[var(--anna-muted)] mt-0.5 line-clamp-1">
          {CATEGORY_DESCRIPTIONS[category]}
        </p>
        <span className="font-data text-[10px] text-[var(--anna-sage-dark)] mt-1 inline-block">
          from {formatSgd(defaults.amount)}
        </span>
      </div>
    </button>
  );
}

function JobTypeCard({
  jobType,
  onBook,
}: {
  jobType: ServiceJobType;
  onBook: () => void;
}) {
  return (
    <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-[var(--anna-slate)]">
            {jobType.name}
          </h4>
          <p className="text-xs text-[var(--anna-muted)] mt-0.5 line-clamp-2">
            {jobType.description}
          </p>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 text-[10px] px-2 py-0.5 font-data font-medium border-[var(--anna-sage)]/30 text-[var(--anna-sage-dark)]"
        >
          {jobType.unitLabel}
        </Badge>
      </div>

      {/* Pricing */}
      <div className="flex items-center gap-2 mb-3">
        <span className="font-data text-base font-bold text-[var(--anna-slate)]">
          {formatSgd(jobType.basePriceCents)}
        </span>
        <span className="text-[10px] text-[var(--anna-muted)]">
          {jobType.pricingRules.type === "flat" ? "flat rate" : jobType.unitLabel}
        </span>
      </div>

      {/* Add-ons preview */}
      {jobType.addOns && jobType.addOns.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {jobType.addOns.slice(0, 3).map((addon) => (
            <span
              key={addon.key}
              className="text-[10px] bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)] px-2 py-0.5 rounded-md"
            >
              +{formatSgd(addon.priceCents)} {addon.label}
            </span>
          ))}
          {jobType.addOns.length > 3 && (
            <span className="text-[10px] text-[var(--anna-muted)]">
              +{jobType.addOns.length - 3} more
            </span>
          )}
        </div>
      )}

      {/* Quotation count */}
      {jobType._count && jobType._count.quotations > 0 && (
        <div className="flex items-center gap-1 mb-3">
          <Star size={10} className="text-[var(--anna-warning)]" />
          <span className="text-[10px] text-[var(--anna-muted)]">
            {jobType._count.quotations} booking{jobType._count.quotations > 1 ? "s" : ""} made
          </span>
        </div>
      )}

      {/* Book Now button */}
      <Button
        onClick={onBook}
        size="sm"
        className="w-full bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl h-9 text-xs font-semibold"
      >
        Book Now
        <ArrowRight size={14} className="ml-1.5" />
      </Button>
    </div>
  );
}

function JobTypeSkeleton() {
  return (
    <div className="bg-[var(--anna-white)] rounded-2xl border border-[var(--anna-border)] p-4 space-y-3">
      <Skeleton className="h-4 w-3/4 rounded-lg bg-[var(--anna-border)]" />
      <Skeleton className="h-3 w-full rounded-lg bg-[var(--anna-border)]" />
      <Skeleton className="h-5 w-24 rounded-lg bg-[var(--anna-border)]" />
      <Skeleton className="h-9 w-full rounded-xl bg-[var(--anna-border)]" />
    </div>
  );
}

/* ── Rebook: renders when rebookData is present in store ── */
function RebookView({ data }: { data: RebookData }) {
  const { setActiveTab } = useAnnaStore();

  function goBack() {
    useAnnaStore.setState({ rebookData: null });
    setActiveTab("dashboard");
  }

  function onSuccess() {
    useAnnaStore.setState({ rebookData: null });
    setActiveTab("dashboard");
  }

  return (
    <div className="p-4 lg:p-6 pb-20 md:pb-0 anna-fade-in">
      <BookingForm
        category={data.category}
        initialInstructions={data.instructions}
        initialAmountCents={data.amountCents}
        onBack={goBack}
        onSuccess={onSuccess}
      />
    </div>
  );
}

/* ── Main: routes between rebook and normal browse flow ── */
export function TaskServices() {
  const rebookData = useAnnaStore((s) => s.rebookData);
  if (rebookData) {
    return <RebookView data={rebookData} />;
  }
  return <ServicesBrowse />;
}

/* ── Normal browse → category → booking flow ── */
function ServicesBrowse() {
  const [view, setView] = useState<ViewState>({ mode: "browse" });
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch job types when viewing a category
  const activeCategory = view.mode === "category" ? view.category
    : view.mode === "booking" ? view.category
    : null;

  const { data: jobTypes, isLoading: isLoadingJobs } = useQuery({
    queryKey: ["job-types", activeCategory],
    queryFn: () => fetchJobTypes(activeCategory!),
    enabled: !!activeCategory,
  });

  // Filter categories by search
  const filteredCategories = searchQuery.trim()
    ? CATEGORIES.filter((cat) => {
        const label = getCategoryLabel(cat).toLowerCase();
        const desc = CATEGORY_DESCRIPTIONS[cat].toLowerCase();
        return label.includes(searchQuery.toLowerCase()) || desc.includes(searchQuery.toLowerCase());
      })
    : CATEGORIES;

  // Filter job types by search
  const filteredJobTypes = searchQuery.trim() && jobTypes
    ? jobTypes.filter((jt) => {
        const name = jt.name.toLowerCase();
        const desc = jt.description.toLowerCase();
        return name.includes(searchQuery.toLowerCase()) || desc.includes(searchQuery.toLowerCase());
      })
    : jobTypes;

  // --- RENDER: Booking Form ---
  if (view.mode === "booking") {
    return (
      <div className="p-4 lg:p-6 pb-20 md:pb-0">
        <BookingForm
          category={view.category}
          initialJobType={view.jobType ?? null}
          onBack={() => setView({ mode: "category", category: view.category })}
          onSuccess={() => setView({ mode: "browse" })}
        />
      </div>
    );
  }

  // --- RENDER: Category Browse / Category Detail ---
  return (
    <div className="p-4 lg:p-6 pb-20 md:pb-0 anna-fade-in">
      {view.mode === "browse" ? (
        <>
          <h1 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)] mb-1">
            Services
          </h1>
          <p className="text-sm text-[var(--anna-muted)] mb-6">
            Browse and book home services
          </p>
        </>
      ) : (
        <>
          <h1 className="text-xl lg:text-2xl font-bold text-[var(--anna-slate)] mb-1">
            Services
          </h1>
        </>
      )}

      {/* Search */}
      <div className="relative mb-6">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--anna-muted)]"
        />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search services..."
          className="pl-10 rounded-xl border-[var(--anna-border)] bg-[var(--anna-white)] text-sm focus-visible:ring-[var(--anna-sage)]/30"
        />
      </div>

      {view.mode === "browse" ? (
        /* ── Category Grid ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredCategories.map((cat) => (
            <CategoryCard
              key={cat}
              category={cat}
              onClick={() => {
                setSearchQuery("");
                setView({ mode: "category", category: cat });
              }}
            />
          ))}
        </div>
      ) : (
        /* ── Job Types for Selected Category ── */
        <div>
          {/* Back button */}
          <button
            onClick={() => {
              setView({ mode: "browse" });
              setSearchQuery("");
            }}
            className="flex items-center gap-1.5 text-sm text-[var(--anna-muted)] hover:text-[var(--anna-slate)] transition-colors mb-4"
          >
            <ChevronRight size={14} className="rotate-180" />
            All Services
          </button>

          {/* Category Header */}
          <div className="flex items-center gap-3 mb-4">
            <CategoryIcon category={view.category} size={24} />
            <div>
              <h2 className="text-lg font-bold text-[var(--anna-slate)]">
                {getCategoryLabel(view.category)}
              </h2>
              <p className="text-xs text-[var(--anna-muted)]">
                {CATEGORY_DESCRIPTIONS[view.category]}
              </p>
            </div>
          </div>

          {/* Job Types Grid */}
          {isLoadingJobs ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => (
                <JobTypeSkeleton key={i} />
              ))}
            </div>
          ) : filteredJobTypes && filteredJobTypes.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredJobTypes.map((jt) => (
                <JobTypeCard
                  key={jt.id}
                  jobType={jt}
                  onBook={() => setView({ mode: "booking", category: view.category, jobType: jt })}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--anna-muted)]">
              <p className="text-sm">No specific services listed yet</p>
              <p className="text-xs mt-1 mb-4">
                {searchQuery ? "Try a different search term" : "You can still create a custom booking for this category"}
              </p>
              <Button
                onClick={() => setView({ mode: "booking", category: view.category })}
                size="sm"
                className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl h-9 text-xs font-semibold"
              >
                Book Custom Service
                <ArrowRight size={14} className="ml-1.5" />
              </Button>
            </div>
          )}

          {/* Custom booking CTA when job types exist */}
          {filteredJobTypes && filteredJobTypes.length > 0 && (
            <div className="mt-6 p-4 rounded-2xl bg-[var(--anna-sage-light)]/50 border border-[var(--anna-sage)]/20">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[var(--anna-slate)]">
                    Need a custom {getCategoryLabel(view.category).toLowerCase()} service?
                  </p>
                  <p className="text-xs text-[var(--anna-muted)] mt-0.5">
                    Create a booking with your own instructions
                  </p>
                </div>
                <Button
                  onClick={() => setView({ mode: "booking", category: view.category })}
                  size="sm"
                  className="bg-[var(--anna-sage)] hover:bg-[var(--anna-sage-dark)] text-white rounded-xl h-9 text-xs font-semibold shrink-0"
                >
                  Custom
                  <ArrowRight size={14} className="ml-1.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}