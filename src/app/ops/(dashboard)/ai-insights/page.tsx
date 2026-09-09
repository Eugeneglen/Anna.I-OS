"use client";

import { Lightbulb } from "lucide-react";
import { useOpsUser } from "@/app/ops/(dashboard)/layout";
import { AiInsightsFeed } from "@/components/ops/ai/ai-insights-feed";

// ============================================================
// Anna.I — Ops AI Insights page (Phase 3 · §3.1)
// Event-driven AI insights feed: anomaly detection → AI
// reasoning → persisted insight → recommended action (closed
// catalogue) → human Prepare. The nav entry is permission-gated
// (ai:prepare); the feed itself re-checks and self-hides.
// ============================================================

export default function AiInsightsPage() {
  const ctx = useOpsUser();
  const canPrepare = ctx?.can("ai", "prepare") ?? false;
  const canApprove = ctx?.can("ai", "approve") ?? false;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-[var(--anna-sage-dark)]" />
          <h1 className="text-xl font-semibold">AI Insights</h1>
        </div>
        <p className="mt-1 text-sm text-[var(--anna-muted)]">
          Event-driven insights over detected anomalies. The AI recommends from a closed action
          catalogue; operators review, prepare, and decide. Nothing executes autonomously.
        </p>
      </div>
      <AiInsightsFeed canPrepare={canPrepare} canApprove={canApprove} />
    </div>
  );
}
