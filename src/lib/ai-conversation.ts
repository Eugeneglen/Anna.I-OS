import { db } from "@/lib/db";
import type { ConversationRole } from "@prisma/client";

// ─────────────────────────────────────────────────────────────
// AI Conversation persistence (L4 · Phase 1 · Step 1.1)
//
// Records Ask Anna request/response turns for traceability. This is NOT
// session memory: nothing recorded here is ever fed back into a prompt
// (multi-turn memory is out of Phase-1 scope by design). The turns exist
// so the audit chain (request → recommendation → decision → execution →
// result) has a durable, household-scoped transcript.
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
