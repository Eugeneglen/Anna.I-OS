"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  ChevronDown,
  ShieldAlert,
  Bot,
  UserCheck,
  CircleDollarSign,
  Scale,
  FileSearch,
  Clock,
  AlertTriangle,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatSgd, formatDateTime } from "@/lib/ops-format";
import {
  AiCaseDecisionDialog,
  type BriefDecisionInfo,
  type DecisionMode,
  type EligibleActionInfo,
} from "./ai-case-decision-dialog";

// ============================================================
// Anna.I — Ops AI Case Brief Panel (Phase 2 · §4)
// ============================================================
// The AI case brief shown to Ops for each disputed task.
// Sections: Case Summary / Evidence / Policy / Recommendation /
// Financial Impact / Confidence / Reasoning / Alternatives.
//
// The panel makes the control model explicit everywhere:
//   "AI is recommending. A human is deciding."
// The recommendation is NEVER presented as the final decision.
// ============================================================

interface CaseBrief {
  id: string;
  status: string;
  generationStatus: string;
  generationAttempts: number;
  generationError: string | null;
  summary: string;
  recommendation: string;
  recommendedAmountCents: number | null;
  fallbackFromInvalid: boolean;
  rationale: string;
  confidence: number | null;
  eligibleActions: PolicySnapshot | null;
  financialImpact: Record<string, Record<string, unknown>> | null;
  contextSnapshot: { case?: CaseSnapshot; alternativesConsidered?: string[] } | null;
  escrowId: string | null;
  household?: { name: string } | null;
  vendor?: { name: string } | null;
  decisionKind: string | null;
  decisionAction: string | null;
  decisionNote: string | null;
  decisionLatencyMs: number | null;
  executionResult: Record<string, unknown> | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PolicySnapshot {
  eligibleActions: EligibleActionInfo[];
  allowedChoices: string[];
  policyNotes: string[];
  computedAt: string;
}

interface CaseSnapshot {
  taskId: string;
  jobNo: string | null;
  householdName: string;
  vendorName: string | null;
  task: {
    category: string;
    status: string;
    instructions: string | null;
    timeline: Record<string, string | null>;
    photoVerification: {
      totalPhotos: number;
      verifiedPhotos: number;
      rejectedWithReason: number;
      latestUploadedAt: string | null;
    };
  };
  escrow: {
    entries: {
      id: string;
      state: string;
      amountCents: number;
      originalAmountCents: number | null;
      discountCents: number | null;
      refundCents: number | null;
      subsidyReversedCents: number | null;
      commissionCents: number | null;
      vendorPayoutCents: number | null;
      disputeReason: string | null;
    }[];
    totals: {
      orderTotalCashCents: number;
      totalRefundedCents: number;
      totalSubsidyReversedCents: number;
      remainingCashCents: number;
    };
  };
  refundHistory: {
    refundId: string;
    amountCents: number;
    platformDiscountCents: number | null;
    reason: string;
    issuedByName: string | null;
    createdAt: string;
  }[];
  vendorHistory: {
    name: string;
    totalJobs: number;
    disputedJobs: number;
    disputeRate: number;
  } | null;
  householdHistory: {
    name: string;
    totalTasks: number;
    disputedTasks: number;
    disputeRate: number;
    marketingConsent: boolean;
  };
}

const ACTION_LABELS: Record<string, string> = {
  resolve_dismiss: "Dismiss dispute",
  resolve_refund: "Full refund (as credit)",
  partial_refund: "Partial refund (as credit)",
  resolve_voucher: "Compensation voucher",
  manual_review: "Manual review",
};

const TIMELINE_LABELS: Record<string, string> = {
  createdAt: "Created",
  dispatchedAt: "Dispatched",
  acceptedAt: "Vendor accepted",
  scheduledAt: "Scheduled",
  inProgressAt: "In progress",
  completedAt: "Completed",
  verifiedAt: "Verified",
  disputedAt: "Disputed",
};

function SectionLabel({ icon: Icon, children }: { icon: React.ElementType; children: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <Icon size={12} className="text-[var(--anna-sage-dark)]" />
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
        {children}
      </p>
    </div>
  );
}

interface AiCaseBriefPanelProps {
  taskId: string;
  /** Refresh key from the parent (bumps after escrow actions). */
  refreshKey?: number;
  onDecided?: () => void;
}

export function AiCaseBriefPanel({ taskId, refreshKey, onDecided }: AiCaseBriefPanelProps) {
  const [briefs, setBriefs] = useState<CaseBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [decisionMode, setDecisionMode] = useState<DecisionMode>("accept");

  const fetchBriefs = useCallback(async () => {
    try {
      const res = await fetch(`/api/ops/ai/cases?taskId=${encodeURIComponent(taskId)}`);
      if (res.status === 403) {
        setError("Your role cannot view AI case briefs (requires ai:prepare).");
        return;
      }
      if (!res.ok) {
        setError("Failed to load AI case brief.");
        return;
      }
      const data = await res.json();
      setBriefs(data.briefs ?? []);
      setError(null);
    } catch {
      setError("Failed to load AI case brief.");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    setLoading(true);
    void fetchBriefs();
  }, [fetchBriefs, refreshKey]);

  // The ACTIVE brief: newest PENDING_REVIEW; fall back to the newest
  // decided/expired one for history display.
  const activeBrief = useMemo(() => {
    const pending = briefs.find((b) => b.status === "PENDING_REVIEW");
    return pending ?? briefs[0] ?? null;
  }, [briefs]);

  const caseData = activeBrief?.contextSnapshot?.case ?? null;
  const policy: PolicySnapshot | null = activeBrief?.eligibleActions ?? null;
  const alternatives: string[] = activeBrief?.contextSnapshot?.alternativesConsidered ?? [];

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const res = await fetch("/api/ops/ai/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, force: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Regeneration failed");
        return;
      }
      toast.success("AI case brief regenerated");
      await fetchBriefs();
    } finally {
      setRegenerating(false);
    }
  };

  const openDecision = (mode: DecisionMode) => {
    setDecisionMode(mode);
    setDecisionOpen(true);
  };

  const decisionInfo: BriefDecisionInfo | null = activeBrief
    ? {
        briefId: activeBrief.id,
        recommendation: activeBrief.recommendation,
        recommendedAmountCents: activeBrief.recommendedAmountCents,
        householdName: activeBrief.household?.name ?? "",
        summary: activeBrief.summary,
        eligibleActions: policy?.eligibleActions ?? [],
        policyFinancialImpact: activeBrief.financialImpact ?? undefined,
      }
    : null;

  if (loading) {
    return (
      <div className="mt-2 rounded-xl border border-[var(--anna-sage)]/25 bg-[var(--anna-sage-light)]/25 p-3 flex items-center gap-2">
        <Loader2 size={14} className="animate-spin text-[var(--anna-sage-dark)]" />
        <span className="text-xs text-[var(--anna-muted)]">Loading AI case brief…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-2 rounded-xl border border-[var(--anna-border)] bg-[var(--anna-bg)] p-3 flex items-center gap-2">
        <AlertTriangle size={14} className="text-amber-600" />
        <span className="text-xs text-[var(--anna-muted)]">{error}</span>
      </div>
    );
  }

  if (!activeBrief) {
    return (
      <div className="mt-2 rounded-xl border border-dashed border-[var(--anna-sage)]/40 bg-[var(--anna-sage-light)]/20 p-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-[var(--anna-sage-dark)]" />
          <span className="text-xs text-[var(--anna-muted)]">
            No AI case brief yet — the 60s coverage sweep will generate one.
          </span>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={regenerate}
          disabled={regenerating}
          className="rounded-lg border-[var(--anna-sage)]/40 text-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage-light)]/40 text-xs h-7"
        >
          {regenerating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          Generate now
        </Button>
      </div>
    );
  }

  const isPending = activeBrief.status === "PENDING_REVIEW";
  const isFailedGen = activeBrief.generationStatus === "FAILED";
  const isFallback = activeBrief.fallbackFromInvalid;

  return (
    <div className="mt-2 rounded-2xl border border-[var(--anna-sage)]/30 bg-[var(--anna-white)] overflow-hidden">
      {/* Header */}
      <div className="bg-[var(--anna-sage-light)]/50 border-b border-[var(--anna-sage)]/20 px-4 py-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[var(--anna-sage)]/15 flex items-center justify-center">
              <Bot size={15} className="text-[var(--anna-sage-dark)]" />
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--anna-slate)]">
                Anna.I Case Brief
                <span className="ml-2 font-normal text-[var(--anna-muted)]">
                  {caseData?.jobNo ? `#${caseData.jobNo}` : ""}
                </span>
              </p>
              <p className="text-[10px] text-[var(--anna-muted)]">
                Generated {formatDateTime(activeBrief.updatedAt)} · chain{" "}
                <span className="font-mono">{activeBrief.id.slice(-8)}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {isFailedGen && (
              <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px] gap-1">
                <AlertTriangle size={10} /> generation failed
              </Badge>
            )}
            {isFallback && (
              <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px] gap-1">
                <ShieldAlert size={10} /> fallback: manual review
              </Badge>
            )}
            <Badge
              className={cn(
                "text-[10px]",
                isPending
                  ? "bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)] border-[var(--anna-sage)]/40"
                  : "bg-slate-100 text-slate-600 border-slate-200"
              )}
            >
              {activeBrief.status === "PENDING_REVIEW"
                ? "awaiting human decision"
                : activeBrief.status.toLowerCase()}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={regenerate}
              disabled={regenerating || !isPending}
              title="Regenerate the brief from fresh case data"
              className="h-7 w-7 p-0 text-[var(--anna-muted)] hover:text-[var(--anna-sage-dark)]"
            >
              {regenerating ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="px-4 py-3 space-y-4">
        {/* The control model, explicit */}
        <div className="rounded-xl bg-[var(--anna-bg)] border border-[var(--anna-sage)]/25 px-3 py-2 flex items-center gap-2">
          <Scale size={13} className="text-[var(--anna-sage-dark)] shrink-0" />
          <p className="text-[11px] font-medium text-[var(--anna-slate)]">
            AI is recommending. <span className="text-[var(--anna-sage-dark)]">A human is deciding.</span>
          </p>
        </div>

        {/* Generation failure — never hidden (§8) */}
        {isFailedGen && activeBrief.generationError && (
          <div className="rounded-xl border border-red-200 bg-red-50/70 px-3 py-2.5 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-red-600">
              AI generation failed — manual review required
            </p>
            <p className="text-[11px] text-red-700 font-mono break-all">
              {activeBrief.generationError}
            </p>
            <p className="text-[10px] text-red-600">
              Attempts: {activeBrief.generationAttempts}. The 60s sweep retries automatically; the
              case stays in the manual queue meanwhile.
            </p>
          </div>
        )}

        {/* 1. Case Summary */}
        <div>
          <SectionLabel icon={FileSearch}>Case Summary</SectionLabel>
          <p className="text-xs text-[var(--anna-slate)] leading-relaxed">
            {activeBrief.summary}
          </p>
        </div>

        {/* 2. Evidence */}
        {caseData && (
          <Collapsible>
            <CollapsibleTrigger className="w-full group">
              <div className="flex items-center justify-between">
                <SectionLabel icon={FileSearch}>Evidence — what Anna.I used</SectionLabel>
                <ChevronDown
                  size={14}
                  className="text-[var(--anna-muted)] group-data-[state=open]:rotate-180 transition-transform"
                />
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-3 pt-1">
                {/* Task timeline */}
                <div className="rounded-xl border border-[var(--anna-border)] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-1.5">
                    Task timeline
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {Object.entries(caseData.task.timeline)
                      .filter(([, v]) => v !== null)
                      .map(([k, v]) => (
                        <div key={k} className="flex items-center justify-between text-[10px]">
                          <span className="text-[var(--anna-muted)]">
                            {TIMELINE_LABELS[k] ?? k}
                          </span>
                          <span className="text-[var(--anna-slate)] font-data">
                            {formatDateTime(v as string)}
                          </span>
                        </div>
                      ))}
                  </div>
                  {caseData.task.photoVerification.totalPhotos > 0 && (
                    <p className="text-[10px] text-[var(--anna-muted)] mt-1.5">
                      Photos: {caseData.task.photoVerification.totalPhotos} total ·{" "}
                      {caseData.task.photoVerification.verifiedPhotos} household-verified
                    </p>
                  )}
                </div>

                {/* Escrow ledger */}
                <div className="rounded-xl border border-[var(--anna-border)] p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-1.5">
                    Escrow ledger ({caseData.escrow.entries.length}{" "}
                    {caseData.escrow.entries.length === 1 ? "entry" : "entries"})
                  </p>
                  <div className="space-y-1.5">
                    {caseData.escrow.entries.map((e) => (
                      <div key={e.id} className="text-[10px] space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[var(--anna-muted)]">
                            {e.id.slice(-6)} · {e.state}
                          </span>
                          <span className="font-data text-[var(--anna-slate)]">
                            {formatSgd(e.amountCents)}
                            {e.originalAmountCents && e.originalAmountCents !== e.amountCents
                              ? ` (base ${formatSgd(e.originalAmountCents)})`
                              : ""}
                          </span>
                        </div>
                        {(e.refundCents || 0) > 0 && (
                          <p className="text-[var(--anna-muted)] font-data pl-2">
                            refunded {formatSgd(e.refundCents || 0)} · promo reversed{" "}
                            {formatSgd(e.subsidyReversedCents || 0)}
                          </p>
                        )}
                        {e.disputeReason && (
                          <p className="text-red-600 pl-2">reason: {e.disputeReason}</p>
                        )}
                      </div>
                    ))}
                    <div className="flex items-center justify-between text-[10px] pt-1 border-t border-[var(--anna-border)]">
                      <span className="text-[var(--anna-muted)] font-semibold">
                        Totals — cash held / refunded / remaining
                      </span>
                      <span className="font-data text-[var(--anna-slate)]">
                        {formatSgd(caseData.escrow.totals.orderTotalCashCents)} /{" "}
                        {formatSgd(caseData.escrow.totals.totalRefundedCents)} /{" "}
                        {formatSgd(caseData.escrow.totals.remainingCashCents)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Refund history (two-way split legs) */}
                {caseData.refundHistory.length > 0 && (
                  <div className="rounded-xl border border-[var(--anna-border)] p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-1.5">
                      Refund history (cash leg / promo leg)
                    </p>
                    <div className="space-y-1">
                      {caseData.refundHistory.map((r) => (
                        <div key={r.refundId} className="text-[10px] flex justify-between gap-2">
                          <span className="text-[var(--anna-muted)] truncate">
                            {formatDateTime(r.createdAt)} · {r.reason.slice(0, 40)}
                          </span>
                          <span className="font-data text-[var(--anna-slate)] shrink-0">
                            {formatSgd(r.amountCents)}
                            {r.platformDiscountCents
                              ? ` + ${formatSgd(r.platformDiscountCents)} promo`
                              : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Vendor + household history */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {caseData.vendorHistory && (
                    <div className="rounded-xl border border-[var(--anna-border)] p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-1">
                        Vendor — {caseData.vendorHistory.name}
                      </p>
                      <p className="text-[10px] text-[var(--anna-slate)]">
                        {caseData.vendorHistory.totalJobs} jobs ·{" "}
                        {caseData.vendorHistory.disputedJobs} disputed · rate{" "}
                        <span className="font-data">
                          {(caseData.vendorHistory.disputeRate * 100).toFixed(1)}%
                        </span>
                      </p>
                    </div>
                  )}
                  <div className="rounded-xl border border-[var(--anna-border)] p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)] mb-1">
                      Household — {caseData.householdHistory.name}
                    </p>
                    <p className="text-[10px] text-[var(--anna-slate)]">
                      {caseData.householdHistory.totalTasks} tasks ·{" "}
                      {caseData.householdHistory.disputedTasks} disputed · rate{" "}
                      <span className="font-data">
                        {(caseData.householdHistory.disputeRate * 100).toFixed(1)}%
                      </span>
                      {" · consent "}
                      {caseData.householdHistory.marketingConsent ? "ON" : "OFF"}
                    </p>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* 3. Policy — the code-first eligible set */}
        {policy && (
          <div>
            <SectionLabel icon={Scale}>Policy — eligible actions (code-computed)</SectionLabel>
            <div className="rounded-xl border border-[var(--anna-border)] divide-y divide-[var(--anna-border)]">
              {policy.eligibleActions.map((a) => (
                <div
                  key={a.action}
                  className={cn(
                    "px-3 py-2 flex items-start justify-between gap-2",
                    a.action === activeBrief.recommendation && isPending && "bg-[var(--anna-sage-light)]/30"
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p
                        className={cn(
                          "text-[11px] font-medium",
                          a.eligible ? "text-[var(--anna-slate)]" : "text-[var(--anna-muted)] line-through"
                        )}
                      >
                        {ACTION_LABELS[a.action] ?? a.action}
                      </p>
                      {!a.eligible && (
                        <span className="text-[9px] text-[var(--anna-muted)]">ineligible</span>
                      )}
                      {a.action === activeBrief.recommendation && isPending && (
                        <span className="text-[9px] font-semibold text-[var(--anna-sage-dark)]">
                          ← AI choice
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-[var(--anna-muted)] leading-relaxed mt-0.5">
                      {a.reason}
                    </p>
                  </div>
                  {a.bounds && (
                    <span className="text-[10px] font-data text-[var(--anna-slate)] shrink-0 pt-0.5">
                      ≤ {formatSgd(a.bounds.maxAmountCents)}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-[var(--anna-muted)] mt-1">
              The AI may only choose from this set — deterministic policy computed before the LLM
              was called.
            </p>
          </div>
        )}

        {/* 4+5. Recommendation + Financial Impact */}
        <div>
          <SectionLabel icon={Sparkles}>Recommendation (advisory)</SectionLabel>
          <div
            className={cn(
              "rounded-xl border p-3",
              isFallback || isFailedGen
                ? "border-amber-200 bg-amber-50/60"
                : "border-[var(--anna-sage)]/30 bg-[var(--anna-sage-light)]/25"
            )}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs font-semibold text-[var(--anna-slate)]">
                {ACTION_LABELS[activeBrief.recommendation] ?? activeBrief.recommendation}
              </p>
              {activeBrief.recommendedAmountCents != null && (
                <span className="text-xs font-data font-bold text-[var(--anna-slate)]">
                  {formatSgd(activeBrief.recommendedAmountCents)}
                  <span className="text-[9px] font-normal text-[var(--anna-muted)] ml-1">
                    suggested (server recomputes)
                  </span>
                </span>
              )}
            </div>
            <p className="text-[10px] text-[var(--anna-muted)] mt-1">
              Not a decision — a recommendation awaiting human review.
            </p>
          </div>

          {/* Financial impact (server-computed) */}
          {activeBrief.financialImpact &&
            activeBrief.financialImpact[activeBrief.recommendation] && (
              <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <CircleDollarSign size={12} className="text-amber-700" />
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                    Financial impact — calculated by escrow code
                  </p>
                </div>
                {(() => {
                  const fi = activeBrief.financialImpact[activeBrief.recommendation];
                  return (
                    <div className="text-[10px] text-amber-800 space-y-0.5 font-data">
                      {String(fi.label ?? "")}
                      {fi.refundAmountCents != null && (
                        <p>Household cash leg: {formatSgd(Number(fi.refundAmountCents))}</p>
                      )}
                      {fi.platformPromoLegCents != null && Number(fi.platformPromoLegCents) > 0 && (
                        <p>Platform promo leg: {formatSgd(Number(fi.platformPromoLegCents))}</p>
                      )}
                      {fi.newVendorPayoutCents != null && (
                        <p>Vendor payout after: {formatSgd(Number(fi.newVendorPayoutCents))}</p>
                      )}
                      {fi.voucherAmountCents != null && (
                        <p>Voucher up to: {formatSgd(Number(fi.voucherAmountCents))}</p>
                      )}
                    </div>
                  );
                })()}
                <p className="text-[10px] text-amber-700 mt-1">
                  Source of truth: the escrow/refund calculation, recomputed at execution. The LLM
                  never computes money.
                </p>
              </div>
            )}
        </div>

        {/* 6. Confidence */}
        <div className="flex items-center gap-3">
          <SectionLabel icon={Scale}>Confidence</SectionLabel>
          {activeBrief.confidence != null ? (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-24 rounded-full bg-[var(--anna-border)] overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full",
                    activeBrief.confidence >= 0.7
                      ? "bg-emerald-500"
                      : activeBrief.confidence >= 0.4
                        ? "bg-amber-500"
                        : "bg-red-400"
                  )}
                  style={{ width: `${Math.round(activeBrief.confidence * 100)}%` }}
                />
              </div>
              <span className="text-[10px] font-data text-[var(--anna-slate)]">
                {(activeBrief.confidence * 100).toFixed(0)}%
              </span>
            </div>
          ) : (
            <span className="text-[10px] text-[var(--anna-muted)]">
              not reported by the model
            </span>
          )}
        </div>

        {/* 7. Reasoning — model-generated, display-only */}
        <div>
          <SectionLabel icon={Bot}>Reasoning — model-generated</SectionLabel>
          <p className="text-[11px] text-[var(--anna-slate)] leading-relaxed rounded-xl bg-[var(--anna-bg)] border border-[var(--anna-border)] p-3 whitespace-pre-wrap">
            {activeBrief.rationale}
          </p>
          <p className="text-[9px] text-[var(--anna-muted)] mt-1">
            Generated by the model from the evidence above. Numbers are advisory; policy bounds are
            authoritative.
          </p>
        </div>

        {/* 8. Alternatives */}
        <div>
          <SectionLabel icon={History}>Alternatives considered</SectionLabel>
          {alternatives.length > 0 ? (
            <ul className="space-y-1">
              {alternatives.map((a, i) => (
                <li
                  key={i}
                  className="text-[10px] text-[var(--anna-muted)] leading-relaxed flex gap-1.5"
                >
                  <span className="text-[var(--anna-sage-dark)]">·</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[10px] text-[var(--anna-muted)]">
              All other eligible actions are listed in the Policy section with the deterministic
              rule that governs each.
            </p>
          )}
        </div>

        {/* Decided state */}
        {!isPending && activeBrief.decisionKind && (
          <div className="rounded-xl border border-[var(--anna-sage)]/30 bg-[var(--anna-sage-light)]/25 p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <UserCheck size={13} className="text-[var(--anna-sage-dark)]" />
              <p className="text-[11px] font-semibold text-[var(--anna-slate)]">
                Human decision: {activeBrief.decisionKind}
                {activeBrief.decisionAction
                  ? ` → ${ACTION_LABELS[activeBrief.decisionAction] ?? activeBrief.decisionAction}`
                  : ""}
              </p>
            </div>
            {activeBrief.decisionNote && (
              <p className="text-[10px] text-[var(--anna-slate)]">
                “{activeBrief.decisionNote}”
              </p>
            )}
            <div className="flex items-center gap-3 text-[10px] text-[var(--anna-muted)] font-data">
              {activeBrief.reviewedAt && (
                <span className="flex items-center gap-1">
                  <Clock size={10} /> {formatDateTime(activeBrief.reviewedAt)}
                </span>
              )}
              {activeBrief.decisionLatencyMs != null && (
                <span>latency {(activeBrief.decisionLatencyMs / 1000).toFixed(1)}s</span>
              )}
              {activeBrief.confidence != null && (
                <span>AI confidence {(activeBrief.confidence * 100).toFixed(0)}%</span>
              )}
            </div>
            {activeBrief.executionResult &&
              typeof activeBrief.executionResult === "object" &&
              "kind" in activeBrief.executionResult &&
              activeBrief.executionResult.kind === "expired" && (
                <p className="text-[10px] text-amber-700">
                  Expired: {String(activeBrief.executionResult.reason ?? "")}
                </p>
              )}
            {activeBrief.executionResult &&
              typeof activeBrief.executionResult === "object" &&
              "ok" in activeBrief.executionResult && (
                <p
                  className={cn(
                    "text-[10px] font-medium",
                    activeBrief.executionResult.ok ? "text-emerald-700" : "text-red-600"
                  )}
                >
                  Execution {activeBrief.executionResult.ok ? "succeeded" : "failed"} through the
                  escrow money path
                  {activeBrief.executionResult.escrowState
                    ? ` — escrow ${String(activeBrief.executionResult.escrowState)}`
                    : ""}
                  {activeBrief.executionResult.error
                    ? ` — ${String(activeBrief.executionResult.error)}`
                    : ""}
                </p>
              )}
          </div>
        )}

        {/* Decision actions — only while pending */}
        {isPending && (
          <div className="flex gap-2 flex-wrap pt-1">
            <Button
              size="sm"
              onClick={() => openDecision("accept")}
              className="rounded-xl bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white text-xs h-8 gap-1.5"
            >
              <UserCheck size={13} />
              Accept
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => openDecision("reject")}
              className="rounded-xl border-red-200 text-red-700 hover:bg-red-50 text-xs h-8 gap-1.5"
            >
              Reject
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => openDecision("override")}
              className="rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50 text-xs h-8 gap-1.5"
            >
              Override
            </Button>
          </div>
        )}
      </div>

      {/* Decision dialog */}
      <AiCaseDecisionDialog
        open={decisionOpen}
        onOpenChange={setDecisionOpen}
        mode={decisionMode}
        brief={decisionInfo}
        onDecided={() => {
          void fetchBriefs();
          onDecided?.();
        }}
      />
    </div>
  );
}
