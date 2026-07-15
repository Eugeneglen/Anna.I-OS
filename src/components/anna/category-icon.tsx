"use client";

import { Sparkles, Shirt, Wind, Wrench } from "lucide-react";
import type { ServiceCategory } from "@/lib/types";

const iconMap: Record<ServiceCategory, React.ElementType> = {
  CLEANING: Sparkles,
  LAUNDRY: Shirt,
  AIRCON: Wind,
  HANDYMAN: Wrench,
};

const colorMap: Record<ServiceCategory, string> = {
  CLEANING: "text-[var(--anna-success)] bg-[var(--anna-success)]/10",
  LAUNDRY: "text-[var(--anna-warning)] bg-[var(--anna-warning)]/10",
  AIRCON: "text-[var(--anna-slate-light)] bg-[var(--anna-slate-light)]/10",
  HANDYMAN: "text-[var(--anna-sage-dark)] bg-[var(--anna-sage-dark)]/10",
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
  const label =
    category.charAt(0) + category.slice(1).toLowerCase();

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
    HANDYMAN: "Handyman",
  };
  return labels[category];
}