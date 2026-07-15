"use client";

import { Check } from "lucide-react";
import type { TaskStatus } from "@/lib/types";

const STEPS: { key: TaskStatus; label: string }[] = [
  { key: "CREATED", label: "Created" },
  { key: "DISPATCHED", label: "Dispatched" },
  { key: "IN_PROGRESS", label: "In Progress" },
  { key: "COMPLETED", label: "Completed" },
  { key: "VERIFIED", label: "Verified" },
  { key: "ESCROW_RELEASED", label: "Escrow Released" },
];

function getStepIndex(status: TaskStatus): number {
  if (status === "DISPUTED") return 3; // disputed happens around completed
  return STEPS.findIndex((s) => s.key === status);
}

interface StatusTimelineProps {
  status: TaskStatus;
}

export function StatusTimeline({ status }: StatusTimelineProps) {
  const currentIndex = getStepIndex(status);
  const isDisputed = status === "DISPUTED";

  return (
    <div className="relative">
      <div className="flex items-center justify-between">
        {STEPS.map((step, i) => {
          const isCompleted = i < currentIndex;
          const isCurrent = i === currentIndex && !isDisputed;
          const isDisputedStep = isDisputed && i === 3;

          return (
            <div
              key={step.key}
              className="flex flex-col items-center gap-1.5 relative z-10"
            >
              {/* Node */}
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all ${
                  isCompleted
                    ? "bg-[var(--anna-sage)] text-[var(--anna-white)]"
                    : isCurrent
                    ? "bg-[var(--anna-sage-dark)] text-[var(--anna-white)] ring-4 ring-[var(--anna-sage)]/20"
                    : isDisputedStep
                    ? "bg-[var(--anna-error)] text-[var(--anna-white)] ring-4 ring-[var(--anna-error)]/20"
                    : "bg-[var(--anna-border)] text-[var(--anna-muted)]"
                }`}
              >
                {isCompleted || isCurrent ? (
                  <Check size={12} strokeWidth={3} />
                ) : isDisputedStep ? (
                  <span className="text-[10px]">!</span>
                ) : (
                  <span className="text-[10px]">{i + 1}</span>
                )}
              </div>
              {/* Label */}
              <span
                className={`text-[10px] text-center leading-tight max-w-[56px] ${
                  isCompleted || isCurrent
                    ? "text-[var(--anna-slate)] font-medium"
                    : isDisputedStep
                    ? "text-[var(--anna-error)] font-medium"
                    : "text-[var(--anna-muted)]"
                }`}
              >
                {isDisputedStep ? "Disputed" : step.label}
              </span>
            </div>
          );
        })}
      </div>
      {/* Connector line */}
      <div className="absolute top-3 left-3 right-3 h-0.5 bg-[var(--anna-border)] -z-0">
        <div
          className="h-full bg-[var(--anna-sage)] transition-all duration-500"
          style={{
            width: `${(currentIndex / (STEPS.length - 1)) * 100}%`,
          }}
        />
      </div>
    </div>
  );
}