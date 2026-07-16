"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatSgd, type ServiceCategory, type ServiceJobType } from "@/lib/types";
import { getCategoryLabel } from "./category-icon";
import { Check, Tag } from "lucide-react";

async function fetchJobTypes(category: ServiceCategory): Promise<ServiceJobType[]> {
  const res = await fetch(`/api/job-types?category=${category}`);
  if (!res.ok) throw new Error("Failed to fetch job types");
  const data = await res.json();
  return data.jobTypes;
}

interface JobTypeSelectorProps {
  category: ServiceCategory;
  selectedJobType: ServiceJobType | null;
  onSelect: (jobType: ServiceJobType) => void;
}

export function JobTypeSelector({
  category,
  selectedJobType,
  onSelect,
}: JobTypeSelectorProps) {
  const { data: jobTypes, isLoading } = useQuery({
    queryKey: ["job-types", category],
    queryFn: () => fetchJobTypes(category),
    enabled: !!category,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
          <Tag size={12} className="inline mr-1" />
          Service Type <span className="font-normal text-[var(--anna-muted)]">(optional)</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-24 rounded-2xl bg-[var(--anna-border)]"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
        <Tag size={12} className="inline mr-1" />
        Service Type <span className="font-normal text-[var(--anna-muted)]">(optional)</span>
      </h3>

      {!jobTypes || jobTypes.length === 0 ? (
        <p className="text-xs text-[var(--anna-muted)] bg-[var(--anna-sage-light)]/30 rounded-xl px-4 py-3 border border-[var(--anna-sage)]/15">
          No specific service types listed for {getCategoryLabel(category)} yet.
          You can fill in the details below to create a custom task.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {jobTypes.map((jt) => {
            const isSelected = selectedJobType?.id === jt.id;
            return (
              <button
                key={jt.id}
                onClick={() => onSelect(jt)}
                className={cn(
                  "relative text-left p-4 rounded-2xl border-2 transition-all",
                  isSelected
                    ? "border-[var(--anna-sage)] bg-[var(--anna-sage-light)]/50 shadow-sm"
                    : "border-[var(--anna-border)] bg-[var(--anna-white)] hover:border-[var(--anna-sage)]/40"
                )}
              >
                {/* Check badge */}
                {isSelected && (
                  <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-[var(--anna-sage)] flex items-center justify-center">
                    <Check size={12} className="text-white" />
                  </div>
                )}

                <div className="pr-6">
                  <h4 className="text-sm font-semibold text-[var(--anna-slate)]">
                    {jt.name}
                  </h4>
                  <p className="text-[11px] text-[var(--anna-muted)] mt-0.5 leading-snug">
                    {jt.description}
                  </p>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="font-data text-base font-bold text-[var(--anna-sage-dark)]">
                      {formatSgd(jt.basePriceCents)}
                    </span>
                    <span className="text-[10px] text-[var(--anna-muted)]">
                      {jt.unitLabel}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}