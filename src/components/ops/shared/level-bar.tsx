"use client";

import { cn } from "@/lib/utils";
import { MAX_AUTONOMY_LEVEL } from "@/lib/constants";

interface LevelBarProps {
  level: number;
  max?: number;
  size?: "sm" | "md";
}

export function LevelBar({ level, max = MAX_AUTONOMY_LEVEL, size = "sm" }: LevelBarProps) {
  const height = size === "sm" ? "h-3" : "h-4";
  return (
    <div className={cn("flex gap-0.5", height)}>
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "rounded-full transition-all duration-500",
            height,
            i < level
              ? "bg-[var(--anna-sage-dark)]"
              : "bg-[var(--anna-border)]"
          )}
        />
      ))}
    </div>
  );
}
