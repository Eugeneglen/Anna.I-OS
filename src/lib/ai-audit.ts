import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────
// AI Audit Chain (L4 foundation · Phase 1 · Step 1.1)
//
// ONE reusable mechanism that makes every AI action traceable through:
//
//   AI request → AI recommendation → human decision → execution → result
//
// It writes to the EXISTING AuditLog table — there is no second audit
// system. The chain is correlated by `aiChainId` in metadata, so a full
// decision episode can be reconstructed with:
//
//   SELECT * FROM AuditLog
//   WHERE json_extract(metadata,'$.ai') = 1
//     AND json_extract(metadata,'$.aiChainId') = '<chain>'
//   ORDER BY createdAt;
//
// System-generated rows are always identifiable: userName = ANNA-AI
// (AuditLog.userId is nullable by design for system actors, and userId is
// an OpsUser FK — household-member actors are identified inside
// metadata.aiScope.memberId).
// ─────────────────────────────────────────────────────────────

export const AI_SYSTEM_ACTOR = "ANNA-AI";

export type AiAuditStage =
  | "ai_request" // an AI call is being made: input + scope + model
  | "ai_recommendation" // AI output produced: response, tools used, confidence
  | "human_decision" // a human accepted/rejected/confirmed
  | "execution" // the confirmed action executed through the existing service
  | "result"; // execution outcome (success/failure + effect)

export interface AiAuditActor {
  /** Ops user acting (human decision / execution stages). */
  userId?: string;
  userName?: string;
  /** Vendor actor (vendor-side AI surfaces). */
  vendorId?: string;
  /** Household member actor (Ask Anna) — AuditLog.userId is an OpsUser FK,
   *  so the member identity travels inside metadata.aiScope. */
  memberId?: string;
}

export interface AiAuditScope {
  householdId?: string;
  vendorId?: string;
  entityType?: string;
  entityId?: string;
  /** The LLM call site, e.g. "ask-anna", "ops-ai", "photo-qa". */
  surface?: string;
}

export interface AiAuditEvent {
  stage: AiAuditStage;
  chainId: string;
  action: string;
  actor?: AiAuditActor;
  scope: AiAuditScope;
  /** Model / latency / tools / request id — everything needed to replay
   *  the decision episode. Keep values JSON-safe and bounded. */
  detail?: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
}

function bounded(value: unknown, max = 600): unknown {
  if (typeof value === "string" && value.length > max) {
    return value.slice(0, max) + "…";
  }
  return value;
}

/**
 * Write one link of an AI audit chain. Errors propagate — a governance
 * event must never be silently dropped (fail-loud, same semantics as the
 * existing auditLog helper in permissions.ts).
 */
export async function logAiEvent(event: AiAuditEvent): Promise<void> {
  // House precedent (permissions.ts auditLog): Prisma's Json input typing
  // rejects nested nulls, so the envelope is cast on write. Runtime values
  // are JSON-safe by construction.
  const metadata = {
    ai: true,
    aiStage: event.stage,
    aiChainId: event.chainId,
    aiScope: {
      householdId: event.scope.householdId ?? null,
      vendorId: event.scope.vendorId ?? null,
      memberId: event.actor?.memberId ?? null,
      surface: event.scope.surface ?? null,
    },
    aiDetail: Object.fromEntries(
      Object.entries(event.detail ?? {}).map(([k, v]) => [k, bounded(v)])
    ),
  } as any;

  await db.auditLog.create({
    data: {
      userId: event.actor?.userId ?? null,
      userName: event.actor?.userName ?? AI_SYSTEM_ACTOR,
      vendorId: event.actor?.vendorId ?? null,
      action: event.action,
      entityType: event.entityType ?? event.scope.entityType ?? "ai",
      entityId: event.entityId ?? event.scope.entityId ?? null,
      metadata,
    },
  });
}

/** Start a new AI decision-episode chain. */
export function newAiChainId(): string {
  return crypto.randomUUID();
}
