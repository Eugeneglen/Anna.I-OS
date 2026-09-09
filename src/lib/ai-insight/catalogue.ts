// ─────────────────────────────────────────────────────────────
// Phase 3 · §3.1 — CLOSED ACTION CATALOGUE for AI insights
//
// The LLM is ADVISORY. It may ONLY select an action from this
// catalogue, and ONLY from the subset code computes as eligible
// for the specific anomaly (policy below). Validation rejects
// anything outside — including execution-shaped inventions like
// "execute_refund" or "release_escrow", which do not exist here.
//
// Catalogue actions are REVIEW / NAVIGATION / PREPARATION acts:
//   • "navigate"  → deep-link the ops human to the right console page
//   • "prepare"   → stage a Phase-2 AI case brief for HUMAN decision
//   • "none"      → monitor-only, no ops surface
// None of them executes an operational action. The only money-
// adjacent entry ("prepare_case_brief") goes through the Phase-2
// maker-checker decision dialog — a human still confirms.
// ─────────────────────────────────────────────────────────────

export const INSIGHT_ACTIONS = [
  "review_anomaly",
  "review_task",
  "review_vendor",
  "review_household",
  "review_escrow_disputes",
  "prepare_case_brief",
  "monitor_only",
] as const;

export type InsightAction = (typeof INSIGHT_ACTIONS)[number];

export interface InsightActionDef {
  action: InsightAction;
  /** Human-readable label rendered in the ops feed. */
  label: string;
  /** What the Prepare button does. */
  kind: "navigate" | "prepare" | "none";
  description: string;
}

/** The immutable catalogue — the ONLY actions an insight may recommend. */
export const INSIGHT_ACTION_CATALOGUE: Record<InsightAction, InsightActionDef> = {
  review_anomaly: {
    action: "review_anomaly",
    label: "Review anomaly",
    kind: "navigate",
    description: "Open the ops anomalies console focused on this anomaly.",
  },
  review_task: {
    action: "review_task",
    label: "Review task",
    kind: "navigate",
    description: "Open the ops booking detail for the task involved.",
  },
  review_vendor: {
    action: "review_vendor",
    label: "Review vendor",
    kind: "navigate",
    description: "Open the vendor profile involved in the anomaly.",
  },
  review_household: {
    action: "review_household",
    label: "Review household",
    kind: "navigate",
    description: "Open the household profile involved in the anomaly.",
  },
  review_escrow_disputes: {
    action: "review_escrow_disputes",
    label: "Review escrow disputes",
    kind: "navigate",
    description: "Open the escrow console's disputed queue.",
  },
  prepare_case_brief: {
    action: "prepare_case_brief",
    label: "Prepare case brief",
    kind: "prepare",
    description:
      "Generate the Phase-2 AI case brief for this disputed task so a human can decide with full context (maker-checker still applies).",
  },
  monitor_only: {
    action: "monitor_only",
    label: "Monitor only",
    kind: "none",
    description: "Informational insight — no operational surface to open.",
  },
};

/** Actions that are deliberately IMPOSSIBLE for an insight to recommend —
 *  anything execution-shaped. Asserted by adversarial tests. */
export const FORBIDDEN_ACTION_EXAMPLES = [
  "execute_refund",
  "release_escrow",
  "suspend_vendor",
  "cancel_task",
  "auto_refund",
  "resolve_dismiss",
  "partial_refund",
  "resolve_voucher",
] as const;

// ─────────────────────────────────────────────────────────────
// Code-first eligibility (computed BEFORE the LLM ever runs)
// ─────────────────────────────────────────────────────────────

export interface InsightPolicyInput {
  anomalyType: string;
  hasTaskId: boolean;
  hasVendorId: boolean;
  /** True only when the linked task is currently a qualifying dispute
   *  (task DISPUTED with a DISPUTED escrow entry) — verified server-side
   *  by the case builder, never from client hints. */
  qualifiesForCaseBrief: boolean;
}

export interface InsightPolicy {
  /** The ONLY actions the LLM may choose from for this anomaly. */
  allowedChoices: InsightAction[];
  policyNotes: string[];
}

/** Pure — deterministic eligibility from case facts. */
export function computeInsightPolicy(input: InsightPolicyInput): InsightPolicy {
  const allowed = new Set<InsightAction>();
  const notes: string[] = [];

  // Navigation actions gated by entity availability (server-verified facts).
  allowed.add("review_anomaly");
  if (input.hasTaskId) allowed.add("review_task");
  if (input.hasVendorId) allowed.add("review_vendor");
  allowed.add("review_household"); // an anomaly is always household-scoped

  if (input.anomalyType === "ESCROW_DISPUTED") {
    allowed.add("review_escrow_disputes");
    notes.push("ESCROW_DISPUTED anomaly — escrow dispute queue is relevant.");
  }

  // The preparation act is available only for a genuinely qualifying dispute
  // (the Phase-2 gate: task DISPUTED + escrow DISPUTED). Code decides, LLM
  // cannot widen it.
  if (input.qualifiesForCaseBrief) {
    allowed.add("prepare_case_brief");
    notes.push(
      "Task is a qualifying dispute — a Phase-2 case brief can be prepared for human decision (maker-checker intact)."
    );
  } else if (input.anomalyType === "ESCROW_DISPUTED") {
    notes.push("Dispute no longer qualifying — prepare_case_brief withheld by policy.");
  }

  // The safe floor: ALWAYS selectable, and the fallback target.
  allowed.add("monitor_only");
  notes.push("monitor_only is always eligible (safe default; no operational surface).");

  // Fixed order for deterministic snapshots.
  const ordered = INSIGHT_ACTIONS.filter((a) => allowed.has(a));
  return { allowedChoices: ordered, policyNotes: notes };
}

/** Pure membership check used at decision/prepare time as well. */
export function isInsightActionAllowed(policy: InsightPolicy, action: string): action is InsightAction {
  return policy.allowedChoices.includes(action as InsightAction);
}

/** Server-owned navigation targets (catalogue-defined — the LLM NEVER
 *  supplies URLs; ids come from the persisted evidence snapshot). */
export function prepareTargetFor(
  action: InsightAction,
  evidence: {
    anomalyId?: string;
    taskId?: string;
    vendorId?: string;
    householdId?: string;
  }
): string | null {
  switch (action) {
    case "review_anomaly":
      return `/ops/anomalies`;
    case "review_task":
      return evidence.taskId ? `/ops/bookings` : null;
    case "review_vendor":
      return evidence.vendorId ? `/ops/vendors/${evidence.vendorId}` : null;
    case "review_household":
      return evidence.householdId ? `/ops/households/${evidence.householdId}` : null;
    case "review_escrow_disputes":
      return `/ops/escrow`;
    case "prepare_case_brief":
      return `/ops/escrow`;
    case "monitor_only":
      return null;
  }
}
