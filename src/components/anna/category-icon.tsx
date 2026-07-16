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
  CLEANING: "text-emerald-600 bg-emerald-50",
  LAUNDRY: "text-amber-600 bg-amber-50",
  AIRCON: "text-sky-600 bg-sky-50",
  PLUMBING: "text-blue-600 bg-blue-50",
  ELECTRICAL: "text-yellow-500 bg-yellow-50",
  PAINTING: "text-rose-500 bg-rose-50",
  PEST_CONTROL: "text-red-600 bg-red-50",
  HANDYMAN: "text-stone-600 bg-stone-100",
  LOCKSMITH: "text-violet-600 bg-violet-50",
  APPLIANCE_REPAIR: "text-orange-600 bg-orange-50",
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