import type { AnomalyInsightCase } from "./case-builder";
import type { ValidInsightRecommendation } from "./llm";

// ─────────────────────────────────────────────────────────────
// P11-F3 — NARRATION/EVIDENCE CONSISTENCY VALIDATOR (insights)
//
// Phase 11 finding F3 (live-reproduced on this baseline): an insight's
// narration asserted "a handyman task assigned to FixIt Handyman Co"
// while its own authoritative evidence snapshot carried
// vendor.name="SparkClean Pro" and a CLEANING/VERIFIED task — the
// seeded anomaly MESSAGE names a different vendor/category than the
// FK-resolved rows, and the model narrated the message's version as
// fact. validateInsightRecommendation gates policy shape only; NOTHING
// checked factual consistency between narration and evidence.
//
// This module is the smallest reliable reconciliation mechanism:
//   • PURE and deterministic (no I/O, no second LLM) — exported for
//     adversarial tests exactly like validateInsightRecommendation;
//   • checks a curated, high-precision set of factual claims:
//       1. money tokens — cent-exact against the evidence amounts;
//       2. unit-mapped counts (open/disputed tasks, completed jobs,
//          active bookings, prior anomalies, detected-hours-ago);
//       3. task-status tokens (closed enum; transition narration is
//          tolerated when the authoritative status is also present);
//       4. task-category tokens (same tolerate-when-authoritative-
//          present rule);
//       5. severity tokens adjacent to anomaly/severity/priority words;
//       6. vendor identity — any OTHER vendor name from the provided
//          universe appearing while the authoritative name is absent
//          (the exact Phase 11 defect signature).
//   • any contradiction → the caller MUST fail safe via
//     contradictionFallback() (monitor_only + deterministic disclosure
//     of the discrepancy and the authoritative values). The
//     contradictory narration is never persisted as fact.
//
// Deliberate non-goals: no general-purpose fact-checking, no NLP, no
// provider calls, no changes to the evidence's source of truth.
// ─────────────────────────────────────────────────────────────

export interface NarrationContradiction {
  /** Check family that fired, e.g. "money", "task-status", "vendor-identity". */
  check: string;
  /** What the narration asserted (token as written). */
  narration: string;
  /** The authoritative evidence value it contradicts. */
  evidence: string;
}

export interface NarrationConsistencyOptions {
  /**
   * Vendor names to treat as "other vendors" for the identity check
   * (the exact Phase 11 defect: the anomaly message names a vendor the
   * FK rows do not). Pure function — the caller supplies the universe
   * (the service passes the DB vendor list, sweep-cached). Defaults to
   * names extractable from the anomaly message/metadata so the pure
   * function still catches the observed defect class standalone.
   */
  vendorNameUniverse?: string[];
}

const TASK_STATUS_TOKENS = [
  "CREATED", "PREDICTED", "MATCHING", "ACCEPTED", "SCHEDULED",
  "IN_PROGRESS", "COMPLETED", "VERIFIED", "DISPUTED", "CANCELLED",
  "ESCROW_RELEASED",
];

const TASK_CATEGORY_TOKENS: Record<string, RegExp> = {
  // Prose forms differ from enum spellings; map each category to a
  // word-boundary matcher (case-insensitive).
  CLEANING: /\bcleaning\b/i,
  LAUNDRY: /\blaundry\b/i,
  AIRCON: /\bair\s*-?\s*con(ditioning)?\b/i,
  PLUMBING: /\bplumb(ing|er)\b/i,
  ELECTRICAL: /\belectrical\b/i,
  PAINTING: /\bpaint(ing|er|ers)\b/i,
  PEST_CONTROL: /\bpest\s*control\b/i,
  HANDYMAN: /\bhandyman\b/i,
  LOCKSMITH: /\blocksmith\b/i,
  APPLIANCE_REPAIR: /\bappliance\s*repair\b/i,
};

const SEVERITY_TOKENS = ["low", "medium", "high", "critical"];

/** Money tokens: "SGD $40.00", "$1,234.56", "$40". */
const MONEY_TOKEN_RE = /(?:SGD\s*)?\$\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/gi;

function centsFromToken(token: string): number {
  const numeric = Number(token.replace(/,/g, ""));
  return Math.round(numeric * 100);
}

function centsFromEvidenceAmount(amount: string): number {
  // Evidence amounts are fmtSgd() strings: "SGD $40.00"
  const m = /\$\s*([\d,]+(?:\.\d{1,2})?)/.exec(amount);
  if (!m) return Number.NaN;
  return Math.round(Number(m[1].replace(/,/g, "")) * 100);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Check one narration (title + body) against its authoritative evidence.
 * Returns the list of contradictions (empty = consistent). PURE.
 */
export function checkNarrationConsistency(
  caseData: AnomalyInsightCase,
  title: string,
  body: string,
  options: NarrationConsistencyOptions = {}
): NarrationContradiction[] {
  const contradictions: NarrationContradiction[] = [];
  const text = `${title}\n${body}`;

  // ── 1. Money tokens: cent-exact against evidence amounts ──
  const evidenceAmountsCents: number[] = [];
  if (caseData.task?.amount) evidenceAmountsCents.push(centsFromEvidenceAmount(caseData.task.amount));
  if (caseData.escrow?.amount) evidenceAmountsCents.push(centsFromEvidenceAmount(caseData.escrow.amount));

  MONEY_TOKEN_RE.lastIndex = 0;
  let moneyMatch: RegExpExecArray | null;
  while ((moneyMatch = MONEY_TOKEN_RE.exec(text)) !== null) {
    const cents = centsFromToken(moneyMatch[1]);
    if (!evidenceAmountsCents.some((c) => Number.isFinite(c) && c === cents)) {
      contradictions.push({
        check: "money",
        narration: `$${moneyMatch[1]}`,
        evidence: evidenceAmountsCents.length
          ? evidenceAmountsCents.map((c) => `SGD $${(c / 100).toFixed(2)}`).join(" or ")
          : "no amount in the evidence snapshot",
      });
    }
  }

  // ── 2. Unit-mapped counts ──
  const hh = caseData.household;
  const countClaims: { re: RegExp; value: number | null; label: string }[] = [
    { re: /(\d+)\s+open\s+tasks?/i, value: hh.openTaskCount, label: "open tasks" },
    { re: /(\d+)\s+disputed\s+tasks?/i, value: hh.disputedTaskCount, label: "disputed tasks" },
    { re: /(\d+)\s+tasks?\s+in\s+dispute/i, value: hh.disputedTaskCount, label: "tasks in dispute" },
    {
      re: /(\d+)\s+(?:completed\s+)?jobs?/,
      value: caseData.vendor ? caseData.vendor.completedJobs : null,
      label: "completed jobs (vendor)",
    },
    {
      re: /(\d+)\s+active\s+bookings?/i,
      value: caseData.vendor ? caseData.vendor.activeBookings : null,
      label: "active bookings (vendor)",
    },
    {
      re: /(\d+)\s+(?:prior|previous|past)\s+(?:resolved\s+)?anomal/,
      value: hh.priorResolvedAnomaliesOfSameType,
      label: "prior resolved anomalies of this type",
    },
    { re: /detected\s+(\d+)\s+hours?\s+ago/i, value: caseData.anomaly.ageHours, label: "age (hours since detection)" },
  ];
  for (const claim of countClaims) {
    const m = new RegExp(claim.re.source, claim.re.flags).exec(text);
    if (m) {
      const claimed = Number(m[1]);
      if (claim.value === null || claimed !== claim.value) {
        contradictions.push({
          check: "count",
          narration: `${m[0]}`,
          evidence: claim.value === null ? "no such counter in the evidence snapshot" : `${claim.value} (${claim.label})`,
        });
      }
    }
  }

  // ── 3. Task status tokens (closed enum) ──
  const taskStatus = caseData.task?.status ?? null;
  if (taskStatus) {
    const mentioned = new Set<string>();
    for (const token of TASK_STATUS_TOKENS) {
      const re = new RegExp(`\\b${escapeRegExp(token.replace(/_/g, "[\\s-]+"))}\\b`, "i");
      if (re.test(text)) mentioned.add(token);
    }
    if (mentioned.size > 0 && !mentioned.has(taskStatus)) {
      contradictions.push({
        check: "task-status",
        narration: [...mentioned].join(", "),
        evidence: taskStatus,
      });
    }
  } else {
    // No task in the evidence — narrating task status details is invention.
    for (const token of TASK_STATUS_TOKENS) {
      const re = new RegExp(`\\b${escapeRegExp(token.replace(/_/g, "[\\s-]+"))}\\b`, "i");
      if (re.test(text)) {
        contradictions.push({
          check: "task-status",
          narration: token,
          evidence: "no linked task in the evidence snapshot",
        });
        break;
      }
    }
  }

  // ── 4. Task category tokens ──
  const taskCategory = caseData.task?.category ?? null;
  if (taskCategory && TASK_CATEGORY_TOKENS[taskCategory]) {
    let mentionedOther: string | null = null;
    for (const [cat, re] of Object.entries(TASK_CATEGORY_TOKENS)) {
      if (re.test(text)) {
        if (cat === taskCategory) {
          mentionedOther = null; // authoritative category present — tolerated
          break;
        }
        mentionedOther = mentionedOther ?? cat;
      }
    }
    if (mentionedOther) {
      contradictions.push({
        check: "task-category",
        narration: mentionedOther,
        evidence: taskCategory,
      });
    }
  } else if (!taskCategory) {
    for (const [cat, re] of Object.entries(TASK_CATEGORY_TOKENS)) {
      if (re.test(text)) {
        contradictions.push({
          check: "task-category",
          narration: cat,
          evidence: "no linked task in the evidence snapshot",
        });
        break;
      }
    }
  }

  // ── 5. Severity tokens (adjacent to anomaly/severity/priority/alert) ──
  const severity = caseData.anomaly.severity.toLowerCase();
  const severityRe =
    /\b(low|medium|high|critical)\b(?=[^.]{0,40}\b(?:severity|anomal|alert|priority)\b)|\b(?:severity|anomal|alert|priority)\b[^.]{0,40}\b(low|medium|high|critical)\b/gi;
  let sevMatch: RegExpExecArray | null;
  while ((sevMatch = severityRe.exec(text)) !== null) {
    const claimed = (sevMatch[1] ?? sevMatch[2] ?? "").toLowerCase();
    if (claimed && claimed !== severity) {
      contradictions.push({
        check: "severity",
        narration: claimed,
        evidence: severity,
      });
    }
  }

  // ── 6. Vendor identity ──
  const vendorName = caseData.vendor?.name ?? null;
  if (vendorName) {
    const universe =
      options.vendorNameUniverse ??
      defaultVendorUniverseFromCase(caseData);
    const authoritativePresent = text.includes(vendorName);
    if (!authoritativePresent) {
      for (const other of universe) {
        const name = other.trim();
        if (!name || name === vendorName) continue;
        if (name.length < 4) continue; // avoid noisy substrings
        if (text.includes(name)) {
          contradictions.push({
            check: "vendor-identity",
            narration: name,
            evidence: vendorName,
          });
          break; // one report is enough to fail safe
        }
      }
    }
  } else {
    // No linked vendor in the evidence — naming ANY real vendor is an
    // invented identity (P11-F3 regression case: incomplete evidence must
    // be narrated as a limitation, never resolved by fabrication).
    const universe =
      options.vendorNameUniverse ??
      defaultVendorUniverseFromCase(caseData);
    for (const other of universe) {
      const name = other.trim();
      if (!name || name.length < 4) continue;
      if (text.includes(name)) {
        contradictions.push({
          check: "vendor-identity",
          narration: name,
          evidence: "no linked vendor in the evidence snapshot",
        });
        break;
      }
    }
  }

  return contradictions;
}

/**
 * Names the pure check can see without a DB: the anomaly message and its
 * metadata (the Phase 11 defect injected the wrong vendor name exactly
 * there). The service passes the real DB vendor list on top of this.
 */
function defaultVendorUniverseFromCase(caseData: AnomalyInsightCase): string[] {
  const names: string[] = [];
  const message = caseData.anomaly.message ?? "";
  const meta = caseData.anomaly.metadata as Record<string, unknown> | null;
  const metaName = typeof meta?.vendorName === "string" ? meta.vendorName : null;
  // "(vendor: FixIt Handyman Co)" / "vendor: X" / "by X is/are ..."
  const m = /vendor:?\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*)*)/.exec(message);
  if (m) names.push(m[1].trim());
  if (metaName) names.push(metaName);
  return names;
}

/**
 * P11-F3 safe fallback for narration/evidence contradictions — the ONLY
 * result a contradictory insight narration may persist as. Deterministic
 * disclosure of the discrepancy and the authoritative values; monitor
 * only; never an operational action; never the model's contradictory
 * text presented as fact.
 */
export function contradictionFallback(
  contradictions: NarrationContradiction[],
  caseData: AnomalyInsightCase
): ValidInsightRecommendation {
  const facts: string[] = [];
  if (caseData.vendor) facts.push(`linked vendor: ${caseData.vendor.name}`);
  if (caseData.task) {
    facts.push(`task ${caseData.task.jobNo ?? caseData.task.id} (${caseData.task.category}, status ${caseData.task.status})`);
  }
  if (caseData.escrow) facts.push(`escrow ${caseData.escrow.state} ${caseData.escrow.amount ?? ""}`.trim());
  const factLine = facts.length ? ` Authoritative case facts: ${facts.join("; ")}.` : "";

  const detail = contradictions
    .slice(0, 3)
    .map((c) => `narration said "${c.narration}" but the verified evidence says ${c.evidence}`)
    .join("; ");

  return {
    recommendedAction: "monitor_only",
    title: "Insight requires manual review",
    body:
      `The AI narration contradicted the verified case evidence (${detail}). ` +
      "Falling back to MONITOR ONLY: a human operator should review this anomaly directly in the anomalies console and treat the structured case record as authoritative. " +
      "No automated action was taken." +
      factLine,
    confidence: null,
    reasoning:
      "Safe fallback applied after the narration/evidence consistency check rejected the model output (P11-F3).",
  };
}
