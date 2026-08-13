"use client";

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

// ============================================================
// Anna.I — Ops Empty State
// ============================================================
// Reusable empty-state placeholder. Renders an icon in a soft
// coloured circle, a title, and a subtitle.
//
// The `icon` prop should be a Lucide icon element whose `size`
// matches the variant (24 for md, 18 for sm).
// ============================================================

interface OpsEmptyStateProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  /** Tailwind classes for the icon background circle, e.g. `bg-[var(--anna-sage-light)]`. */
  iconBg?: string;
  className?: string;
  size?: "sm" | "md";
}

export function OpsEmptyState({
  icon,
  title,
  subtitle,
  iconBg = "bg-[var(--anna-sage-light)]",
  className,
  size = "md",
}: OpsEmptyStateProps) {
  return (
    <div
      className={cn(
        "text-center",
        size === "sm" ? "py-8" : "py-16",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center mx-auto mb-3 text-[var(--anna-sage-dark)]",
          size === "sm" ? "w-10 h-10 rounded-xl" : "w-14 h-14 rounded-2xl",
          iconBg
        )}
      >
        {icon}
      </div>
      <p className="text-sm font-medium text-[var(--anna-slate)]">{title}</p>
      {subtitle && (
        <p className="text-xs text-[var(--anna-muted)] mt-1">{subtitle}</p>
      )}
    </div>
  );
}
