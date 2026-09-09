"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Lightbulb,
  Loader2,
  RefreshCw,
  ChevronDown,
  ShieldAlert,
  Bot,
  UserCheck,
  AlertTriangle,
  History,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/ops-format";

// ============================================================
// Anna.I — Ops AI Insights Feed (Phase 3 · §3.1)
// ============================================================
// Event-driven AI insights over detected anomalies:
//   anomaly detection → AI reasoning → persisted insight →
//   this feed → recommended action → HUMAN Prepare.
//
// The feed makes the control model explicit everywhere:
//   "AI is recommending. A human is deciding."
// Recommended actions come from a CLOSED catalogue — the AI
// cannot invent operational actions, and nothing here executes.
// ============================================================

interface InsightEvidenceCase {
  anomaly: { id: string; type: string; severity: string; status: string; message: string; detectedAt: string; ageHours: number };
  household: { id: string; name: string; openTaskCount: number; disputedTaskCount: number; priorResolvedAnomaliesOfSameType: number };
  task: { id: string; jobNo: string | null; category: string | null; status: string | null; amount: string | null; scheduledDate: string | null } | null;
  vendor: { id: string; name: string; vendorType: string | null; status: string | null; completedJobs: number; activeBookings: number } | null;
  escrow: { state: string | null; amount: string | null; disputedAt: string | null; disputeReason: string | null } | null;
  qualifiesForCaseBrief: boolean;
}

interface InsightPolicySnapshot {
  allowedChoices: string[];
  policyNotes: string[];
}

interface AiInsight {
  id: string;
  insightType: string;
  severity: string;
  entityType: string;
  entityId: string;
  status: string;
  title: string;
  body: string;
  evidence: { case?: InsightEvidenceCase; policy?: InsightPolicySnapshot } | null;
  aiChainId: string | null;
  generationStatus: string;
  generationAttempts: number;
  generationError: string | null;
  recommendedAction: string | null;
  fallbackFromInvalid: boolean;
  modelVersion: string | null;
  confidence: number | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  household?: { id: string; name: string } | null;
  vendor?: { id: string; name: string } | null;
  reviewedBy?: { id: string; name: string } | null;
}

interface InsightStats {
  total: number;
  newCount: number;
  acknowledgedCount: number;
  dismissedCount: number;
  generationFailed: number;
  fallbacks: number;
  dedupProtected: number;
}

interface ChainRow {
  id: string;
  userName: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

const ACTION_LABELS: Record<string, { label: string; kind: string }> = {
  review_anomaly: { label: "Review anomaly", kind: "navigate" },
  review_task: { label: "Review task", kind: "navigate" },
  review_vendor: { label: "Review vendor", kind: "navigate" },
  review_household: { label: "Review household", kind: "navigate" },
  review_escrow_disputes: { label: "Review escrow disputes", kind: "navigate" },
  prepare_case_brief: { label: "Prepare case brief", kind: "prepare" },
  monitor_only: { label: "Monitor only", kind: "none" },
};

const SEVERITY_STYLES: Record<string, string> = {
  LOW: "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]",
  MEDIUM: "bg-amber-50 text-amber-700",
  HIGH: "bg-orange-50 text-orange-700",
  CRITICAL: "bg-red-50 text-red-700",
};

const STATUS_FILTERS = ["NEW", "ACKNOWLEDGED", "DISMISSED", "ALL"] as const;

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge className={SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.MEDIUM}>{severity}</Badge>
  );
}

function ActionBadge({ action }: { action: string | null }) {
  if (!action) return <Badge variant="outline">no action</Badge>;
  const def = ACTION_LABELS[action];
  if (!def) return <Badge variant="outline">{action}</Badge>;
  return (
    <Badge
      className={cn(
        def.kind === "prepare"
          ? "bg-[var(--anna-sage)] text-white"
          : def.kind === "navigate"
            ? "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)]"
            : "bg-[var(--anna-bg)] text-[var(--anna-muted)]"
      )}
    >
      {def.label}
    </Badge>
  );
}

export function AiInsightsFeed({
  canPrepare,
  canApprove,
}: {
  canPrepare: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [insights, setInsights] = useState<AiInsight[]>([]);
  const [stats, setStats] = useState<InsightStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("NEW");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [chain, setChain] = useState<ChainRow[]>([]);
  const [chainLoading, setChainLoading] = useState(false);
  const [preparingId, setPreparingId] = useState<string | null>(null);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = filter === "ALL" ? "" : `?status=${filter}`;
      const res = await fetch(`/api/ops/ai/insights${qs}`);
      if (res.status === 403) {
        setForbidden(true);
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(`feed failed (${res.status})`);
      const data = await res.json();
      setInsights(data.insights ?? []);
      setStats(data.stats ?? null);
    } catch (e) {
      toast.error("Failed to load AI insights");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Poll while anything is still generating (failures are never hidden).
  const anyGenerating = insights.some((i) => i.generationStatus === "GENERATING" || i.generationStatus === "QUEUED");
  useEffect(() => {
    if (!anyGenerating) return;
    const t = setTimeout(() => void load(), 4000);
    return () => clearTimeout(t);
  }, [anyGenerating, load]);

  async function loadChain(id: string) {
    setChainLoading(true);
    setChain([]);
    try {
      const res = await fetch(`/api/ops/ai/insights/${id}`);
      if (res.ok) {
        const data = await res.json();
        setChain(data.chain ?? []);
      }
    } catch {
      toast.error("Failed to load audit chain");
    } finally {
      setChainLoading(false);
    }
  }

  function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    void loadChain(id);
  }

  async function onPrepare(insight: AiInsight) {
    if (!canPrepare) return;
    setPreparingId(insight.id);
    try {
      const res = await fetch(`/api/ops/ai/insights/${insight.id}/prepare`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Prepare failed");
        return;
      }
      if (data.redirect) {
        if (data.kind === "prepare") {
          toast.success(
            data.briefId
              ? `Case brief prepared (${data.briefStatus ?? "ready"}) — opening the escrow console for the human decision`
              : `Prepare result: ${data.briefStatus ?? "n/a"} — opening the escrow console`
          );
        }
        router.push(data.redirect as string);
      } else {
        toast.info("This insight is monitor-only — nothing to prepare");
      }
    } catch {
      toast.error("Prepare failed");
    } finally {
      setPreparingId(null);
    }
  }

  async function onReview(insight: AiInsight, status: "ACKNOWLEDGED" | "DISMISSED") {
    if (!canApprove) return;
    const note =
      status === "DISMISSED"
        ? window.prompt("Reason for dismissing this insight (recorded on the audit chain):") ?? ""
        : "";
    if (status === "DISMISSED" && note.trim() === "") {
      toast.info("A reason is required to dismiss an insight");
      return;
    }
    setReviewingId(insight.id);
    try {
      const res = await fetch(`/api/ops/ai/insights/${insight.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Review failed");
        return;
      }
      toast.success(`Insight ${status === "ACKNOWLEDGED" ? "acknowledged" : "dismissed"} — recorded on the audit chain`);
      void load();
    } catch {
      toast.error("Review failed");
    } finally {
      setReviewingId(null);
    }
  }

  async function onRegenerate(insight: AiInsight) {
    if (!canPrepare) return;
    setRegeneratingId(insight.id);
    try {
      const res = await fetch(`/api/ops/ai/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anomalyId: insight.entityId, force: true }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Regeneration failed");
        return;
      }
      toast.success(`Regeneration: ${data?.result?.status ?? "unknown"}`);
      void load();
    } catch {
      toast.error("Regeneration failed");
    } finally {
      setRegeneratingId(null);
    }
  }

  if (forbidden) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-[var(--anna-muted)]">
        <ShieldAlert className="mx-auto mb-2 h-5 w-5" />
        The AI insights feed requires the <code>ai:prepare</code> permission.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Control-model banner — identical contract to the Phase-2 brief panel */}
      <div className="flex items-center gap-2 rounded-lg border border-[var(--anna-sage)] bg-[var(--anna-sage-light)] px-4 py-2 text-sm text-[var(--anna-sage-dark)]">
        <Bot className="h-4 w-4 shrink-0" />
        <span className="font-medium">AI is recommending. A human is deciding.</span>
        <span className="text-[var(--anna-muted)]">
          — insights are advisory; actions come from a closed catalogue and only humans prepare/execute.
        </span>
      </div>

      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Total", value: stats.total },
            { label: "New", value: stats.newCount },
            { label: "Acknowledged", value: stats.acknowledgedCount },
            { label: "Dismissed", value: stats.dismissedCount },
            { label: "Generation failed", value: stats.generationFailed },
            { label: "Safe fallbacks", value: stats.fallbacks },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border bg-card p-3">
              <div className="text-xs text-[var(--anna-muted)]">{s.label}</div>
              <div className="text-lg font-semibold">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter + refresh */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "default" : "outline"}
            onClick={() => setFilter(f)}
          >
            {f === "NEW" && <Eye className="mr-1 h-3 w-3" />}
            {f === "ACKNOWLEDGED" && <CheckCircle2 className="mr-1 h-3 w-3" />}
            {f === "DISMISSED" && <EyeOff className="mr-1 h-3 w-3" />}
            {f === "ALL" && <History className="mr-1 h-3 w-3" />}
            {f}
          </Button>
        ))}
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </Button>
      </div>

      {/* Feed */}
      {loading && insights.length === 0 ? (
        <div className="flex items-center justify-center p-8 text-sm text-[var(--anna-muted)]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading AI insights…
        </div>
      ) : insights.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-[var(--anna-muted)]">
          <Lightbulb className="mx-auto mb-2 h-6 w-6" />
          No {filter === "ALL" ? "" : filter.toLowerCase()} insights. The sweep generates one insight per
          active anomaly (60s cadence) — raise platform activity or wait for the next sweep.
        </div>
      ) : (
        <div className="space-y-3">
          {insights.map((insight) => {
            const ev = insight.evidence?.case;
            const action = insight.recommendedAction;
            const actionDef = action ? ACTION_LABELS[action] : undefined;
            const isGenerating = insight.generationStatus === "GENERATING" || insight.generationStatus === "QUEUED";
            const isFailed = insight.generationStatus === "FAILED";
            return (
              <article key={insight.id} className="rounded-lg border bg-card p-4 shadow-sm">
                {/* Header */}
                <div className="flex flex-wrap items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-[var(--anna-sage-dark)]" />
                  <SeverityBadge severity={insight.severity} />
                  <Badge variant="outline">{insight.insightType}</Badge>
                  <ActionBadge action={action} />
                  {insight.fallbackFromInvalid && (
                    <Badge className="bg-amber-50 text-amber-700">
                      <ShieldAlert className="mr-1 h-3 w-3" /> safe fallback
                    </Badge>
                  )}
                  {insight.status !== "NEW" && (
                    <Badge variant="outline">
                      {insight.status === "ACKNOWLEDGED" ? "acknowledged" : "dismissed"}
                      {insight.reviewedBy ? ` · ${insight.reviewedBy.name}` : ""}
                    </Badge>
                  )}
                  <span className="ml-auto text-xs text-[var(--anna-muted)]">
                    {formatDateTime(insight.createdAt)}
                  </span>
                </div>

                {/* Title + body */}
                <h3 className="mt-2 font-semibold">{insight.title}</h3>
                <p className="mt-1 text-sm text-[var(--anna-muted)]">{insight.body}</p>

                {/* Scope chips */}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--anna-muted)]">
                  {insight.household && <span>Household: {insight.household.name}</span>}
                  {insight.vendor && <span>Vendor: {insight.vendor.name}</span>}
                  {ev?.task?.jobNo && <span>Task: {ev.task.jobNo}</span>}
                  {ev?.anomaly.type && <span>Anomaly: {ev.anomaly.type}</span>}
                  {insight.confidence != null && (
                    <span>Confidence: {(insight.confidence * 100).toFixed(0)}%</span>
                  )}
                  {insight.modelVersion && <span>Model: {insight.modelVersion}</span>}
                </div>

                {/* Generation failure — NEVER hidden */}
                {isFailed && (
                  <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                    <AlertTriangle className="mr-1 inline h-3 w-3" />
                    Generation failed (attempt {insight.generationAttempts}):{" "}
                    {insight.generationError ?? "unknown error"} — this row stays visible; retry below.
                  </div>
                )}
                {isGenerating && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-[var(--anna-muted)]">
                    <Loader2 className="h-3 w-3 animate-spin" /> Generation in progress…
                  </div>
                )}

                {/* Actions + expandable evidence/audit (one Collapsible tree) */}
                <Collapsible
                  open={expandedId === insight.id}
                  onOpenChange={(o) => o && toggleExpand(insight.id)}
                >
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {canPrepare && !isGenerating && actionDef && actionDef.kind !== "none" && (
                    <Button
                      size="sm"
                      onClick={() => void onPrepare(insight)}
                      disabled={preparingId === insight.id}
                    >
                      {preparingId === insight.id ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <ArrowRight className="mr-1 h-3 w-3" />
                      )}
                      Prepare
                    </Button>
                  )}
                  {canApprove && insight.status === "NEW" && insight.generationStatus === "GENERATED" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void onReview(insight, "ACKNOWLEDGED")}
                        disabled={reviewingId === insight.id}
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Acknowledge
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void onReview(insight, "DISMISSED")}
                        disabled={reviewingId === insight.id}
                      >
                        <XCircle className="mr-1 h-3 w-3" /> Dismiss
                      </Button>
                    </>
                  )}
                  {canPrepare && (isFailed || isGenerating) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void onRegenerate(insight)}
                      disabled={regeneratingId === insight.id || isGenerating}
                    >
                      {regeneratingId === insight.id ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1 h-3 w-3" />
                      )}
                      Regenerate
                    </Button>
                  )}
                  <CollapsibleTrigger asChild>
                    <Button size="sm" variant="ghost">
                      <ChevronDown className="mr-1 h-3 w-3" /> Evidence &amp; audit trail
                    </Button>
                  </CollapsibleTrigger>
                </div>

                {/* Evidence + audit chain */}
                <CollapsibleContent>
                  <div className="mt-3 space-y-3 rounded-md border bg-[var(--anna-bg)] p-3 text-xs">
                    <div>
                      <div className="mb-1 font-semibold">Deterministic evidence (server snapshot)</div>
                      {ev ? (
                        <ul className="list-inside list-disc space-y-0.5 text-[var(--anna-muted)]">
                          <li>
                            Anomaly: {ev.anomaly.type} · {ev.anomaly.severity} · detected {ev.anomaly.detectedAt} —{" "}
                            {ev.anomaly.message}
                          </li>
                          <li>
                            Household: {ev.household.name} — {ev.household.openTaskCount} open tasks,{" "}
                            {ev.household.disputedTaskCount} disputed,{" "}
                            {ev.household.priorResolvedAnomaliesOfSameType} prior {ev.anomaly.type} anomalies
                          </li>
                          {ev.task && (
                            <li>
                              Task {ev.task.jobNo} · {ev.task.category} · {ev.task.status} · {ev.task.amount}
                              {ev.task.scheduledDate ? ` · scheduled ${ev.task.scheduledDate}` : ""}
                            </li>
                          )}
                          {ev.vendor && (
                            <li>
                              Vendor: {ev.vendor.name} ({ev.vendor.vendorType ?? "?"}) — {ev.vendor.completedJobs}{" "}
                              bookings, {ev.vendor.activeBookings} active
                            </li>
                          )}
                          {ev.escrow && (
                            <li>
                              Escrow: {ev.escrow.state} · {ev.escrow.amount}
                              {ev.escrow.disputeReason ? ` · dispute: ${ev.escrow.disputeReason}` : ""}
                            </li>
                          )}
                          {insight.evidence?.policy && (
                            <li>
                              Allowed actions (code-first policy):{" "}
                              {insight.evidence.policy.allowedChoices.join(", ")}
                            </li>
                          )}
                        </ul>
                      ) : (
                        <div className="text-[var(--anna-muted)]">No evidence snapshot on this row.</div>
                      )}
                    </div>
                    <div>
                      <div className="mb-1 flex items-center gap-1 font-semibold">
                        <History className="h-3 w-3" /> Audit chain
                        {insight.aiChainId && (
                          <code className="ml-1 rounded bg-card px-1 py-0.5 text-[10px]">
                            {insight.aiChainId.slice(0, 8)}
                          </code>
                        )}
                      </div>
                      {chainLoading ? (
                        <div className="flex items-center gap-1 text-[var(--anna-muted)]">
                          <Loader2 className="h-3 w-3 animate-spin" /> loading chain…
                        </div>
                      ) : chain.length === 0 ? (
                        <div className="text-[var(--anna-muted)]">No audit rows for this chain.</div>
                      ) : (
                        <ol className="space-y-1">
                          {chain.map((row) => (
                            <li key={row.id} className="flex items-center gap-2">
                              <UserCheck className="h-3 w-3 text-[var(--anna-sage-dark)]" />
                              <span className="font-medium">{row.action}</span>
                              <span className="text-[var(--anna-muted)]">
                                {row.userName ?? "ANNA-AI"} · {formatDateTime(row.createdAt)}
                              </span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  </div>
                </CollapsibleContent>
                </Collapsible>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
