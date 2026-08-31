"use client";

import { Check, AlertTriangle } from "lucide-react";
import type { TaskStatus } from "@/lib/types";
import { useIsMobile } from "@/hooks/use-mobile";

const STEPS: { key: TaskStatus; label: string }[] = [
  { key: "PREDICTED", label: "AI Suggested" },
  { key: "CREATED", label: "Created" },
  { key: "MATCHING", label: "Matching" },
  { key: "ACCEPTED", label: "Accepted" },
  { key: "SCHEDULED", label: "Scheduled" },
  { key: "IN_PROGRESS", label: "In Progress" },
  { key: "COMPLETED", label: "Completed" },
  { key: "VERIFIED", label: "Verified" },
  { key: "ESCROW_RELEASED", label: "Paid" },
];

function getStepIndex(status: TaskStatus): number {
  if (status === "DISPUTED") return 5; // between SCHEDULED and IN_PROGRESS — mid-flow
  return STEPS.findIndex((s) => s.key === status);
}

interface StatusTimelineProps {
  status: TaskStatus;
}

export function StatusTimeline({ status }: StatusTimelineProps) {
  const currentIndex = getStepIndex(status);
  const isDisputed = status === "DISPUTED";
  const isMobile = useIsMobile();

  // Mobile has room for ~2 labels under 9 nodes — show labels only for the
  // current step and the next one (the "you are here / what's next" story).
  // Everything else stays a dot. Desktop shows all labels.
  const showLabel = (i: number) =>
    !isMobile || i === currentIndex || i === currentIndex + 1 || (isDisputed && i === 5);

  return (
    <div className="relative">
      <div className="flex items-start justify-between">
        {STEPS.map((step, i) => {
          const isCompleted = i < currentIndex;
          const isCurrent = i === currentIndex && !isDisputed;
          const isDisputedStep = isDisputed && i === 5;

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
                  <AlertTriangle size={10} strokeWidth={3} />
                ) : (
                  <span className="text-[10px]">{i + 1}</span>
                )}
              </div>
              {/* Label — hidden on mobile except current/next steps so the 9
                  nodes fit the viewport (nodes stay aligned via items-start) */}
              <span
                className={`text-[10px] sm:text-[11px] text-center leading-tight max-w-[52px] sm:max-w-[64px] ${
                  isCompleted || isCurrent
                    ? "text-[var(--anna-slate)] font-medium"
                    : isDisputedStep
                    ? "text-[var(--anna-error)] font-medium"
                    : "text-[var(--anna-muted)]"
                } ${showLabel(i) ? "" : "hidden"}`}
              >
                {isDisputedStep ? "Disputed" : step.label}
              </span>
            </div>
          );
        })}
      </div>
      {/* Connector line — turns red when disputed */}
      <div className="absolute top-3 left-3 right-3 h-0.5 bg-[var(--anna-border)] -z-0">
        <div
          className={`h-full transition-all duration-500 ${
            isDisputed
              ? "bg-[var(--anna-error)]"
              : "bg-[var(--anna-sage)]"
          }`}
          style={{
            width: `${(currentIndex / (STEPS.length - 1)) * 100}%`,
          }}
        />
      </div>
    </div>
  );
}
