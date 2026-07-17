"use client";

import {
  Sparkles,
  Shirt,
  Wind,
  Droplets,
  Zap,
  Paintbrush,
  Bug,
  Wrench,
  KeyRound,
  Refrigerator,
} from "lucide-react";
import type { ServiceCategory } from "@/lib/types";

const iconMap: Record<ServiceCategory, React.ElementType> = {
  CLEANING: Sparkles,
  LAUNDRY: Shirt,
  AIRCON: Wind,
  PLUMBING: Droplets,
  ELECTRICAL: Zap,
  PAINTING: Paintbrush,
  PEST_CONTROL: Bug,
  HANDYMAN: Wrench,
  LOCKSMITH: KeyRound,
  APPLIANCE_REPAIR: Refrigerator,
};

const colorMap: Record<ServiceCategory, string> = {
  CLEANING: "text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-900/20",
  LAUNDRY: "text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-900/20",
  AIRCON: "text-sky-600 bg-sky-50 dark:text-sky-400 dark:bg-sky-900/20",
  PLUMBING: "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-900/20",
  ELECTRICAL: "text-yellow-500 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-900/20",
  PAINTING: "text-rose-500 bg-rose-50 dark:text-rose-400 dark:bg-rose-900/20",
  PEST_CONTROL: "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-900/20",
  HANDYMAN: "text-stone-600 bg-stone-100 dark:text-stone-400 dark:bg-stone-900/20",
  LOCKSMITH: "text-violet-600 bg-violet-50 dark:text-violet-400 dark:bg-violet-900/20",
  APPLIANCE_REPAIR: "text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-900/20",
};

interface CategoryIconProps {
  category: ServiceCategory;
  size?: number;
  className?: string;
  showLabel?: boolean;
}

export function CategoryIcon({
  category,
  size = 18,
  className = "",
  showLabel = false,
}: CategoryIconProps) {
  const Icon = iconMap[category];
  const colors = colorMap[category];
  const label = getCategoryLabel(category);

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span
        className={`inline-flex items-center justify-center rounded-lg p-2 ${colors}`}
      >
        <Icon size={size} />
      </span>
      {showLabel && (
        <span className="text-sm font-medium text-[var(--anna-slate)]">
          {label}
        </span>
      )}
    </span>
  );
}

export function getCategoryLabel(category: ServiceCategory): string {
  const labels: Record<ServiceCategory, string> = {
    CLEANING: "Cleaning",
    LAUNDRY: "Laundry",
    AIRCON: "Aircon",
    PLUMBING: "Plumbing",
    ELECTRICAL: "Electrical",
    PAINTING: "Painting",
    PEST_CONTROL: "Pest Control",
    HANDYMAN: "Handyman",
    LOCKSMITH: "Locksmith",
    APPLIANCE_REPAIR: "Appliance Repair",
  };
  return labels[category];
}