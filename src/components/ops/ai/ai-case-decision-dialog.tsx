"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Sparkles, ShieldAlert, GitBranch, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { formatSgd } from "@/lib/ops-format";

// ============================================================
// Anna.I — Ops AI Case Decision Dialog (Phase 2)
// ============================================================
// The HUMAN DECISION surface (§5): ACCEPT / REJECT / OVERRIDE.
// Every mode requires a reason. Refund-class accepts require the
// SAME explicit refundConfirmed maker-checker confirmation the
// manual escrow dialog demands (§6) — the AI route has no
// backdoor. Execution goes through the decision API which hands
// control to the ONE money path.
// ============================================================

export interface EligibleActionInfo {
  action: string;
  eligible: boolean;
  reason: string;
  bounds?: { minAmountCents: number; maxAmountCents: number };
}

export interface BriefDecisionInfo {
  briefId: string;
  recommendation: string;
  recommendedAmountCents: number | null;
  householdName: string;
  summary: string;
  eligibleActions: EligibleActionInfo[];
  policyFinancialImpact?: Record<string, Record<string, unknown>>;
}

export type DecisionMode = "accept" | "reject" | "override";

interface AiCaseDecisionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: DecisionMode;
  brief: BriefDecisionInfo | null;
  onDecided: () => void;
}

const ACTION_LABELS: Record<string, string> = {
  resolve_dismiss: "Dismiss dispute (escrow stays HELD)",
  resolve_refund: "Full refund → refund credit (escrow REFUNDED)",
  partial_refund: "Partial refund → refund credit",
  resolve_voucher: "Compensation voucher (vendor paid)",
  manual_review: "Manual review (resolve via standard controls)",
};

const REFUND_CLASS_ACTIONS = ["resolve_refund", "partial_refund", "resolve_voucher"];

interface DecisionResponse {
  decision?: string;
  executed?: boolean;
  execution?: Record<string, unknown> | null;
  error?: string;
  note?: string;
  decisionRecord?: Record<string, unknown>;
  briefId?: string;
  requiresConfirmation?: boolean;
}

export function AiCaseDecisionDialog({
  open,
  onOpenChange,
  mode,
  brief,
  onDecided,
}: AiCaseDecisionDialogProps) {
  const [reason, setReason] = useState("");
  const [refundConfirmed, setRefundConfirmed] = useState(false);
  const [overrideAction, setOverrideAction] = useState<string>("");
  const [amountStr, setAmountStr] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<DecisionResponse | null>(null);

  const eligibleForOverride = useMemo(
    () => (brief?.eligibleActions ?? []).filter((a) => a.eligible),
    [brief]
  );

  // The action this dialog will submit for.
  const targetAction =
    mode === "accept"
      ? brief?.recommendation ?? ""
      : mode === "override"
        ? overrideAction
        : "";

  const amountBounds = useMemo(() => {
    if (!targetAction) return null;
    const entry = eligibleForOverride.find((a) => a.action === targetAction);
    return entry?.bounds ?? null;
  }, [targetAction, eligibleForOverride]);

  const needsAmount =
    targetAction === "partial_refund" || targetAction === "resolve_voucher";
  const amountCents = useMemo(() => {
    if (!needsAmount) return undefined;
    const dollars = parseFloat(amountStr);
    if (isNaN(dollars) || dollars <= 0) return undefined;
    return Math.round(dollars * 100);
  }, [amountStr, needsAmount]);

  const isRefundClass = REFUND_CLASS_ACTIONS.includes(targetAction);

  const amountValid = !needsAmount
    ? true
    : amountCents !== undefined &&
      amountBounds !== null &&
      amountCents >= amountBounds.minAmountCents &&
      amountCents <= amountBounds.maxAmountCents;

  const reasonValid = reason.trim().length > 0;
  const confirmValid = !isRefundClass || refundConfirmed;

  const isValid =
    reasonValid && confirmValid && amountValid && (mode !== "override" || targetAction !== "");

  const prefillAmount = () => {
    if (!needsAmount) return;
    const suggested = brief?.recommendedAmountCents;
    const cents = suggested ?? (amountBounds ? amountBounds.maxAmountCents : null);
    if (cents && cents > 0) setAmountStr((cents / 100).toFixed(2));
  };

  const reset = () => {
    setReason("");
    setRefundConfirmed(false);
    setOverrideAction("");
    setAmountStr("");
    setResult(null);
  };

  // Prefill the amount when the target action needs one (accept uses the
  // validated AI suggestion; override prefills the same and stays editable).
  useEffect(() => {
    if (open && needsAmount) {
      const suggested =
        mode === "accept" ? brief?.recommendedAmountCents : brief?.recommendedAmountCents;
      const cents = suggested ?? (amountBounds ? amountBounds.maxAmountCents : null);
      if (cents && cents > 0) setAmountStr((cents / 100).toFixed(2));
    }
    if (!open) {
      setAmountStr("");
    }
  }, [open, needsAmount, mode, brief, amountBounds]);

  const handleSubmit = async () => {
    if (!brief || !isValid) return;
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        decision: mode,
        reason: reason.trim(),
        ...(isRefundClass ? { refundConfirmed: true } : {}),
        ...(mode === "override" ? { overrideAction: targetAction } : {}),
        ...(targetAction === "partial_refund" && amountCents
          ? { refundAmountCents: amountCents }
          : {}),
        ...(targetAction === "resolve_voucher" && amountCents
          ? { voucherAmountCents: amountCents }
          : {}),
      };
      const res = await fetch(`/api/ops/ai/cases/${brief.briefId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: DecisionResponse = await res.json().catch(() => ({ error: "Request failed" }));
      setResult(data);
      if (!res.ok) {
        toast.error(data.error || `Decision failed (HTTP ${res.status})`);
        if (data.requiresConfirmation) {
          // Maker-checker 409 — keep dialog open so the operator can confirm.
          setRefundConfirmed(false);
        }
        return;
      }
      toast.success(
        data.executed
          ? "Decision recorded — executed through the escrow money path"
          : "Decision recorded (no automated execution)"
      );
      onDecided();
      // Keep the dialog open showing the result; operator closes it.
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Decision request failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (!brief) return null;

  const modeConfig = {
    accept: {
      title: "Accept AI Recommendation",
      description:
        "You are accepting the AI's recommendation. Execution flows through the existing escrow money path with its maker-checker.",
      icon: Sparkles,
      header: "from-[#41675a] to-[#2f4d43]",
    },
    reject: {
      title: "Reject AI Recommendation",
      description:
        "You are rejecting the recommendation. A reason is required. Resolve the dispute via the standard escrow controls.",
      icon: XCircle,
      header: "from-red-600 to-red-700",
    },
    override: {
      title: "Override — Choose Different Action",
      description:
        "You are overriding the AI's recommendation with another eligible action. A reason is required.",
      icon: GitBranch,
      header: "from-amber-600 to-amber-700",
    },
  }[mode];
  const Icon = modeConfig.icon;

  const financialNote =
    brief.policyFinancialImpact?.[targetAction] as Record<string, unknown> | undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-[480px] p-0 gap-0 overflow-hidden rounded-2xl border-[var(--anna-border)] max-h-[90vh] overflow-y-auto">
        <div className={cn("bg-gradient-to-r px-5 py-4", modeConfig.header)}>
          <DialogHeader className="text-left space-y-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/20">
                <Icon size={20} className="text-white" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold text-white">
                  {modeConfig.title}
                </DialogTitle>
                <DialogDescription className="text-xs text-white/80 mt-0.5">
                  {modeConfig.description}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="px-5 py-4 space-y-4">
          {result ? (
            /* ── Result view ── */
            <div className="space-y-3">
              {result.executed ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-600" />
                    <p className="text-sm font-semibold text-emerald-700">
                      Decision recorded & executed through the escrow money path
                    </p>
                  </div>
                  {result.execution && typeof result.execution === "object" && (
                    <div className="text-xs text-emerald-800 space-y-1 font-data">
                      {(() => {
                        const ex = result.execution as Record<string, unknown>;
                        const refund = ex.refund as Record<string, unknown> | undefined;
                        if (refund) {
                          return (
                            <>
                              <p>
                                Refunded (cash leg): {formatSgd(Number(refund.refundedCents ?? 0))}
                              </p>
                              <p>
                                Cumulative refunded:{" "}
                                {formatSgd(Number(refund.cumulativeRefundCents ?? 0))}
                              </p>
                              <p>
                                New vendor payout:{" "}
                                {formatSgd(Number(refund.newVendorPayoutCents ?? 0))}
                              </p>
                              {ex.creditCode ? (
                                <p>Refund credit code: {String(ex.creditCode)}</p>
                              ) : null}
                            </>
                          );
                        }
                        if (ex.code) {
                          return <p>Voucher code issued: {String(ex.code)}</p>;
                        }
                        return <p>Escrow state updated.</p>;
                      })()}
                    </div>
                  )}
                  <p className="text-[10px] text-emerald-700">
                    Full details are in the audit chain (aiChainId) and the brief record.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-[var(--anna-sage)]/30 bg-[var(--anna-sage-light)]/40 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-[var(--anna-sage-dark)]" />
                    <p className="text-sm font-semibold text-[var(--anna-sage-dark)]">
                      Decision recorded
                    </p>
                  </div>
                  <p className="text-xs text-[var(--anna-slate)]">{result.note}</p>
                </div>
              )}
              <Button
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
                className="w-full rounded-xl bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)] text-white text-sm font-medium"
              >
                Done
              </Button>
            </div>
          ) : (
            <>
              {/* Case + AI recommendation recap */}
              <div className="p-3 rounded-xl bg-[var(--anna-bg)] border border-[var(--anna-border)] space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                  Case
                </p>
                <p className="text-xs text-[var(--anna-slate)] leading-relaxed">{brief.summary}</p>
                <div className="flex items-center gap-2 pt-1 flex-wrap">
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-[var(--anna-sage-light)] text-[var(--anna-sage-dark)] border border-[var(--anna-sage)]/30">
                    AI recommends: {ACTION_LABELS[brief.recommendation] ?? brief.recommendation}
                  </span>
                </div>
                {brief.recommendedAmountCents != null && (
                  <p className="text-[10px] text-[var(--anna-muted)]">
                    AI suggested amount (display only — the server recomputes):{" "}
                    <span className="font-data">{formatSgd(brief.recommendedAmountCents)}</span>
                  </p>
                )}
              </div>

              {/* Override action picker */}
              {mode === "override" && (
                <div className="space-y-2">
                  <Label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    Choose action <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={overrideAction}
                    onValueChange={(v) => {
                      setOverrideAction(v);
                      setAmountStr("");
                      setTimeout(prefillAmount, 0);
                    }}
                  >
                    <SelectTrigger className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm">
                      <SelectValue placeholder="Select an eligible action…" />
                    </SelectTrigger>
                    <SelectContent>
                      {eligibleForOverride.map((a) => (
                        <SelectItem key={a.action} value={a.action} className="text-sm">
                          {ACTION_LABELS[a.action] ?? a.action}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {targetAction && (
                    <p className="text-[10px] text-[var(--anna-muted)] leading-relaxed">
                      {eligibleForOverride.find((a) => a.action === targetAction)?.reason}
                    </p>
                  )}
                </div>
              )}

              {/* Amount input (accept + override for partial/voucher) */}
              {needsAmount && amountBounds && (
                <div className="space-y-2">
                  <Label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                    {targetAction === "partial_refund" ? "Refund Amount (SGD)" : "Voucher Amount (SGD)"}{" "}
                    <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    min={(amountBounds.minAmountCents / 100).toFixed(2)}
                    max={(amountBounds.maxAmountCents / 100).toFixed(2)}
                    value={amountStr}
                    onChange={(e) => setAmountStr(e.target.value)}
                    placeholder={`Between ${formatSgd(amountBounds.minAmountCents)} and ${formatSgd(amountBounds.maxAmountCents)}`}
                    className="rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm text-[var(--anna-slate)] focus-visible:ring-[var(--anna-sage)]/30"
                  />
                  <div className="flex justify-between text-[10px] text-[var(--anna-muted)]">
                    <span>
                      Bounds: {formatSgd(amountBounds.minAmountCents)} –{" "}
                      {formatSgd(amountBounds.maxAmountCents)}
                    </span>
                    {amountCents !== undefined && (
                      <span className={cn(!amountValid ? "text-red-500" : "text-emerald-600")}>
                        {amountValid ? "Within policy bounds" : "Outside policy bounds"}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Server-computed financial impact of the target action */}
              {financialNote && (mode === "accept" || (mode === "override" && targetAction)) && (
                <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-100 space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                    Server-computed financial impact
                  </p>
                  <p className="text-xs text-amber-800">{String(financialNote.label ?? "")}</p>
                  <div className="text-[10px] text-amber-800 font-data space-y-0.5">
                    {financialNote.refundAmountCents != null && (
                      <p>
                        Refund (household cash leg):{" "}
                        {formatSgd(Number(financialNote.refundAmountCents))}
                      </p>
                    )}
                    {financialNote.newVendorPayoutCents != null && (
                      <p>Vendor payout after: {formatSgd(Number(financialNote.newVendorPayoutCents))}</p>
                    )}
                    {financialNote.voucherAmountCents != null && (
                      <p>Voucher up to: {formatSgd(Number(financialNote.voucherAmountCents))}</p>
                    )}
                  </div>
                  <p className="text-[10px] text-amber-700">
                    Figures are computed by the escrow/refund calculation code — the AI amount is
                    advisory only and never authoritative.
                  </p>
                </div>
              )}

              {/* Maker-checker confirmation for refund-class actions */}
              {isRefundClass && (
                <div className="p-3 rounded-xl border border-red-200 bg-red-50/70 space-y-2">
                  <div className="flex items-start gap-2">
                    <ShieldAlert size={16} className="text-red-600 mt-0.5" />
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-red-700">
                        Maker-checker confirmation required
                      </p>
                      <p className="text-[10px] text-red-600 leading-relaxed">
                        This is a money-moving action. Confirming submits it through the same
                        guarded escrow execution path as the manual refund dialog — with the same
                        refundConfirmed protection.
                      </p>
                      <div className="flex items-center space-x-2 pt-1">
                        <Checkbox
                          id="refund-confirm"
                          checked={refundConfirmed}
                          onCheckedChange={(c) => setRefundConfirmed(c === true)}
                        />
                        <label htmlFor="refund-confirm" className="text-xs text-red-700 font-medium">
                          I confirm this refund-class action and its amount
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Reason (required for all modes) */}
              <div className="space-y-2">
                <Label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--anna-muted)]">
                  Reason for this decision <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={
                    mode === "reject"
                      ? "Why is the AI recommendation wrong? (e.g., photos show work completed…)"
                      : mode === "override"
                        ? "Why are you choosing a different action than the AI?…"
                        : "Why do you accept this recommendation? (recorded in the audit chain)…"
                  }
                  className="min-h-[80px] resize-none rounded-xl border-[var(--anna-border)] bg-[var(--anna-bg)] text-sm text-[var(--anna-slate)] placeholder:text-[var(--anna-muted)] focus-visible:ring-[var(--anna-sage)]/30"
                  maxLength={500}
                />
                <div className="flex justify-end">
                  <span
                    className={cn(
                      "text-[10px] font-data",
                      reason.length > 450 ? "text-red-500" : "text-[var(--anna-muted)]"
                    )}
                  >
                    {reason.length}/500
                  </span>
                </div>
              </div>

              {/* Submit */}
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    reset();
                    onOpenChange(false);
                  }}
                  disabled={submitting}
                  className="flex-1 rounded-xl border-[var(--anna-border)] text-sm font-medium text-[var(--anna-slate)] hover:bg-[var(--anna-bg)]"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || !isValid}
                  className={cn(
                    "flex-1 rounded-xl text-sm font-medium gap-1.5 text-white",
                    mode === "reject"
                      ? "bg-red-600 hover:bg-red-700"
                      : mode === "override"
                        ? "bg-amber-600 hover:bg-amber-700"
                        : "bg-[var(--anna-sage-dark)] hover:bg-[var(--anna-sage)]"
                  )}
                >
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
                  {submitting
                    ? "Processing…"
                    : mode === "accept"
                      ? "Accept & Execute"
                      : mode === "reject"
                        ? "Reject Recommendation"
                        : "Override & Execute"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
