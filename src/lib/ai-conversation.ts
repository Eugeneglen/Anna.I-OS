import { db } from "@/lib/db";
import type { ConversationRole } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// AI Conversation persistence (L4 · Phase 1 · Step 1.1; §3.5 Phase 3)
//
// Records Ask Anna request/response turns for traceability, and
// (Phase 3) replays the RECENT turns back into the prompt as
// bounded session memory — same-authorised-context only. The
// turns remain the durable, household-scoped transcript for the
// audit chain (request → recommendation → decision → execution →
// result).
//
// Scope rule: a conversation can only be attached to the household of
// the authenticated session. A conversationId belonging to a different
// household is treated as foreign → a fresh conversation is started
// instead (fail-safe: no cross-household data is ever exposed).
// ─────────────────────────────────────────────────────────────

export interface ConversationRef {
  id: string;
  created: boolean;
}

export async function getOrCreateConversation(params: {
  conversationId?: string;
  householdId: string;
  memberId?: string;
  channel?: "ASK_ANNA" | "OPS_AI" | "VENDOR_AI";
}): Promise<ConversationRef> {
  const { conversationId, householdId, memberId } = params;
  const channel = params.channel ?? "ASK_ANNA";

  if (conversationId) {
    const existing = await db.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, householdId: true },
    });
    if (existing && existing.householdId === householdId) {
      return { id: existing.id, created: false };
    }
    // Not found or foreign household → fall through and start a new one.
  }

  const conversation = await db.conversation.create({
    data: {
      householdId,
      memberId: memberId ?? null,
      channel,
    },
    select: { id: true },
  });
  return { id: conversation.id, created: true };
}

export async function recordTurn(params: {
  conversationId: string;
  role: ConversationRole;
  content: string;
  toolName?: string;
}): Promise<void> {
  await db.conversationTurn.create({
    data: {
      conversationId: params.conversationId,
      role: params.role,
      // Turns are transcripts, not blobs — keep them bounded.
      content: params.content.slice(0, 4000),
      toolName: params.toolName ?? null,
    },
  });
  await db.conversation.update({
    where: { id: params.conversationId },
    data: { lastTurnAt: new Date() },
  });
}

// ─────────────────────────────────────────────────────────────
// Phase 3 · §3.5 — BOUNDED SESSION MEMORY REPLAY
//
// Returns the most recent USER/ASSISTANT turns (oldest→newest) so
// "what you just told me" / "the booking we discussed earlier"
// resolves correctly within the SAME authorised conversation.
//
// Boundaries (all deliberate):
//   • last N turns only — bounded context, no long-term memory;
//   • USER + ASSISTANT roles only (TOOL rows are internal traces);
//   • the conversation is always the session's OWN (foreign ids
//     can never reach here — getOrCreateConversation fail-safes);
//   • no embeddings, no semantic memory, no cross-household
//     learning — the replay is verbatim, scope-bound transcript.
// ─────────────────────────────────────────────────────────────

export const MEMORY_TURN_LIMIT = 10;
const MEMORY_TURN_MAX_CHARS = 1500;

export interface MemoryTurn {
  role: "user" | "assistant";
  content: string;
}

export async function getRecentTurns(
  conversationId: string,
  limit: number = MEMORY_TURN_LIMIT
): Promise<MemoryTurn[]> {
  const turns = await db.conversationTurn.findMany({
    where: { conversationId, role: { in: ["USER", "ASSISTANT"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { role: true, content: true },
  });
  // Reverse back to chronological order and bound each replayed turn.
  return turns
    .reverse()
    .map((t) => ({
      role: t.role === "USER" ? ("user" as const) : ("assistant" as const),
      content: t.content.slice(0, MEMORY_TURN_MAX_CHARS),
    }));
}
