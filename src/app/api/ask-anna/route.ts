import { NextRequest, NextResponse } from "next/server";
import { ANNA_TOOLS, executeToolCall, type ToolCallResult } from "@/lib/nlu-tools";
import { getZAI, isProviderError, PROVIDER_UNAVAILABLE_MESSAGE } from "@/lib/zai";
import { getHouseholdSession } from "@/lib/household-auth";
import {
  checkRateLimit,
  rateLimitResponsePayload,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { getOpsSession } from "@/lib/ops-auth";
import { buildHouseholdContext, renderContextForPrompt } from "@/lib/ai-context";
import { getOrCreateConversation, recordTurn, getRecentTurns, type MemoryTurn } from "@/lib/ai-conversation";
import { logAiEvent, newAiChainId } from "@/lib/ai-audit";
import {
  MULTIMODAL_SYSTEM_PROMPT_EXTENSION,
  composePhotoUserMessage,
  verifyPhotoToken,
  type PhotoAnalysis,
} from "@/lib/ask-anna-multimodal";

// ─────────────────────────────────────────────────────────────
// System Prompt — Ask Anna (Household NLU)
// Per USER_AI_README.md: warm, calm, competent.
// Reduce coordination burden. Move household from Manager → Approver.
//
// P0 SECURITY (L4 · Phase 1): this route is now AUTHENTICATED.
//   - household identity comes ONLY from the household_token session —
//     any client-supplied householdId is IGNORED (spoofing impossible);
//   - unauthenticated callers get 401, ops sessions get 403 (Ask Anna
//     serves households only);
//   - every tool call executes with the SESSION householdId.
//
// P1 CONTEXT INTEGRITY: a deterministic, server-side scoped context
// (buildHouseholdContext) is injected into every prompt, so narration is
// grounded in the household's real records — never guessed.
//
// MULTIMODAL MVP (Voice + Photo): these are INPUT CHANNELS ONLY. Voice
// arrives as an (editable) transcript; photos arrive as a server-side
// VLM triage analysis inside an HMAC token VERIFIED HERE against the
// SESSION household — a forged/foreign analysis can never reach the LLM.
// The chat flow itself (context, memory, tools, confirmation gates,
// audit chain) is UNCHANGED. No new AI execution architecture.
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are "Ask Anna" — the household's assistant for home services coordination. You are the conversational layer over that household's Household Graph. You are NOT a generic chatbot, NOT the Ops AI, NOT the Vendor AI.

ONE-LINE MANDATE: Reduce the household's coordination burden. Every response should move them from Manager toward Approver — never add a new thing for them to manage.

WHO YOU SERVE: One household at a time. Scoped entirely to the household you're speaking with.
- Never reference, imply, or compare against another household's data
- If asked something requiring cross-household or vendor-side info you don't have, say so plainly

DATA SCOPE:
- This household's profile: composition, service categories, preferences in the Household Graph
- Their Autonomy Level per category (1–5, per the AI Autonomy Ladder)
- Their service history: past/upcoming bookings, vendor assignments, completion status
- Escrow/verification status for their own bookings
- Subscription tier and billing status at summary level

AUTHORITATIVE SCOPED DATA: Every request includes a server-generated data block for THIS household. It is complete and authoritative. If a task, job number, vendor, or amount is not in that block, it is not this household's — say so plainly. Never narrate one entity's facts under another entity's identifier.

BOOKING LIFECYCLE — what happens after a task is created:
- CREATED → MATCHING (vendor being found) → ACCEPTED (vendor confirmed, escrow held) → IN_PROGRESS (vendor working) → COMPLETED → VERIFIED (household approves photos) → ESCROW RELEASED (payment to vendor)
- During matching, vendor identity is hidden until they accept
- 10% platform commission on each task

AUTONOMY AWARENESS:
- L1–2 (Manual): You're confirming and suggesting — household is still Manager. Present options, ask for confirmation.
- L3 (Auto-match): System finds vendor automatically. You report what was matched.
- L4 (Predictive): System creates recurring tasks. You report what's scheduled and ask if adjustments needed.
- L5 (Full auto-verify): System handles nearly everything. You report what's already handled.
Adjust language accordingly — don't ask L4/L5 households to decide things their autonomy should handle.

IMPORTANT: Photo verification and escrow release NEVER change regardless of autonomy level. Higher autonomy = less manual confirmation, NOT less financial protection.

DISPUTE PROCESS:
- Household can raise a dispute from ACCEPTED, SCHEDULED, IN_PROGRESS, COMPLETED, or VERIFIED states
- Dispute pauses autonomy promotion temporarily
- Three resolution paths: household resolves (back to normal), ops dismisses (back to normal), ops refunds (full refund)

WRITE ACTIONS: You have tools to create tasks and cancel bookings.
- Extract service category and instructions from natural language
- Calculate dates properly: "tomorrow", "next Friday", "this weekend"
- Always generate a confirmation card for the user to approve before executing
- If ambiguous, ask one brief clarifying question

ESCALATION — always to a human, no exceptions:
- Anything touching Care tier / eldercare welfare / health or safety
- Disputes or dissatisfaction about a vendor or the platform
- Payment/billing issues beyond simple status lookup
- Any request suggesting genuine distress
Tell the household plainly you're connecting them to a person.

TONE: Warm, calm, competent. Sound like the "invisible efficiency" Anna.I promises. Never oversell, never use hype language. If something hasn't happened yet, say so plainly.

HARD BOUNDARIES:
- No medical, legal, or financial advice — redirect to qualified professional
- No cross-household data, including anonymised comparisons
- Never override/suggest overriding escrow or verification steps
- Never claim a capability the build doesn't have
- Currency: SGD (e.g., SGD $68.00)`;

// ── AI Wave 2-A (A-3): date grounding. The LLM previously had NO idea of
// the current date, so "tomorrow"/"next Friday" resolved to hallucinated
// dates (a live audit test produced "11 Jan 2024" on a 2026 server). The
// current date/time (Asia/Singapore) is now injected per request so
// relative dates resolve to real ones.
function buildSystemPrompt(): string {
  const now = new Date();
  const dateLine = now
    .toLocaleString("en-SG", {
      timeZone: "Asia/Singapore",
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(",", " ·");
  return `${SYSTEM_PROMPT}

CURRENT DATE & TIME: ${dateLine} (Asia/Singapore, UTC+8). Resolve every relative date ("today", "tomorrow", "next Friday", "this weekend") against THIS date. When calling create_task, pass scheduledDate as YYYY-MM-DD derived from this date — never from memory or guesses.

SERVICE / PRICING / AVAILABILITY AUTHORITY (non-negotiable):
- CURRENT catalogue questions (what services Anna.I offers, what a service costs now, what is bookable): answer ONLY from the get_available_services / get_service_pricing tools — never from memory.
- The household's OWN jobs (status, escrow, what a booked/completed job cost): answer from your scoped context — that is their history. "How much did job AI-0000123 cost?" is a history question; answer it directly from the context amounts.
- Never quote a historical amount as the CURRENT price of a service. If asked what a service costs NOW, use the tools.
- If a catalogue lookup fails or errors, reply exactly: "I cannot confirm the current Anna.I information." — never guess.
- When the user asks to book or schedule something, call create_task IMMEDIATELY — the confirmation card IS the approval step; never just narrate a plan to book and ask permission in text. Resolve the SPECIFIC service: pass serviceSlug with the exact service the user named (the server matches it against the live catalogue — "gas top-up" resolves to the gas top-up service, never a generic category service), or primary:true when the user asked generically. Never invent a service, price, availability, add-on, or booking rule.`;
}

// ─────────────────────────────────────────────────────────────
// (Audit-AI-FIX8 port note) AI Wave 2-A A-8 auditAiAction is superseded
// here by the Phase 1 five-stage AI audit chain (logAiEvent writes the
// same AuditLog attribution — actor member, household scope — plus the
// aiChainId envelope covering request → decision → execution → result).
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Request/Response Types
// ─────────────────────────────────────────────────────────────

interface AskAnnaRequest {
  /** May be empty when a photoToken is attached (photo-only message).
   *  For voice input this is the (client-edited) transcript. */
  message: string;
  /** IGNORED since the P0 fix — household identity is derived from the
   *  authenticated session. Kept in the interface so existing clients
   *  keep working; it has no effect. */
  householdId?: string;
  conversationId?: string;
  /** Multimodal MVP: HMAC-signed photo analysis token from
   *  POST /api/ask-anna/photo. Verified server-side (signature,
   *  expiry, household binding) before the analysis is used. */
  photoToken?: string;
  /** Multimodal MVP audit metadata: how the text was entered.
   *  Metadata only — the transcript is treated exactly like typed text. */
  inputModality?: "text" | "voice";
  // For confirming a write action
  confirmAction?: {
    toolName: string;
    action: Record<string, unknown>;
    /** Correlates the confirm with the original AI chain (audit only —
     *  authorization never depends on it). */
    chainId?: string;
  };
}

interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

// ─────────────────────────────────────────────────────────────
// POST /api/ask-anna
// ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let session: Awaited<ReturnType<typeof getHouseholdSession>> = null;
  let chainId = newAiChainId();
  let conversationId: string | null = null;

  try {
    // ── P0 auth: household identity ONLY from the session ──
    session = await getHouseholdSession();
    if (!session) {
      // Distinguish "wrong constituent" (403) from "no session" (401).
      const ops = await getOpsSession();
      if (ops) {
        return NextResponse.json(
          { error: "Ask Anna is the household assistant — ops staff should use the Ops AI console." },
          { status: 403 }
        );
      }
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const householdId = session.householdId; // NEVER from the request body

    // ── Rate limit: 20 requests / minute per household (LLM cost cap,
    // AI Wave 2-A A-5 — preserved from this branch) ──
    const rlKey = `ask-anna:hh:${householdId}`;
    if (
      !checkRateLimit(rlKey, RATE_LIMITS.askAnna.limit, RATE_LIMITS.askAnna.windowMs)
    ) {
      return NextResponse.json(rateLimitResponsePayload(rlKey), { status: 429 });
    }

    const body: AskAnnaRequest = await request.json();
    const { message, confirmAction } = body;
    const suppliedConversationId = body.conversationId;

    // ── Multimodal: photo token verification (household-bound, signed) ──
    let photoAnalysis: PhotoAnalysis | null = null;
    let photoSha256: string | null = null;
    if (typeof body.photoToken === "string" && body.photoToken.length > 0) {
      const verification = verifyPhotoToken(body.photoToken, householdId);
      if (!verification.ok) {
        return NextResponse.json(
          { error: verification.error },
          { status: verification.status }
        );
      }
      photoAnalysis = verification.analysis;
      photoSha256 = verification.imageSha256;
    }

    const inputModality = body.inputModality === "voice" ? "voice" : "text";

    // Photo-only messages: empty text is acceptable — the analysis carries
    // the content. Synthesize a minimal transcript for the records.
    const effectiveMessage =
      message && message.trim().length > 0 ? message : "[Photo attached — no text]";

    if (!effectiveMessage) {
      return NextResponse.json(
        { error: "Missing message" },
        { status: 400 }
      );
    }

    // ── Conversation (household-scoped; foreign ids start fresh) ──
    const conversation = await getOrCreateConversation({
      conversationId: suppliedConversationId,
      householdId,
      memberId: session.memberId,
      channel: "ASK_ANNA",
    });
    conversationId = conversation.id;

    // ── §3.5 bounded session memory: replay the recent turns of THIS
    // conversation (server-side; foreign conversationIds can never reach
    // here — getOrCreateConversation fail-safed the scope above). The
    // current user turn is recorded AFTER the replay snapshot so the
    // messages array is [system, ...history, user(now)]. ──
    const memoryTurns: MemoryTurn[] = await getRecentTurns(conversationId);
    const memoryMessages = memoryTurns.map((t) => ({
      role: t.role,
      content: t.content,
    }));
    if (memoryMessages.length > 0) {
      // A leading assistant turn would break the chat format — the replay
      // always ends with the previous assistant answer (alternation holds
      // because turns are recorded user→assistant in pairs).
      while (memoryMessages.length > 0 && memoryMessages[0].role === "assistant") {
        memoryMessages.shift();
      }
    }

    await recordTurn({ conversationId, role: "USER", content: effectiveMessage });

    // ── Multimodal: durable audit trace of the photo analysis (a TOOL-role
    //    turn, exactly like tool-call results — persists the bounded
    //    analysis for the audit chain; excluded from memory replay).
    //    The original image is never persisted (see ask-anna-multimodal.ts). ──
    if (photoAnalysis) {
      await recordTurn({
        conversationId,
        role: "TOOL",
        content: JSON.stringify({
          tool: "photo_analysis",
          imageSha256: photoSha256,
          analysis: photoAnalysis,
        }).slice(0, 4000),
        toolName: "photo_analysis",
      });
    }

    // ── Check if AI is available ──
    const zai = await getZAI();
    if (!zai) {
      const offline =
        "I'm currently offline — my AI engine isn't configured on this server. Please ask your administrator to set up the AI environment variables (Z_AI_BASE_URL, Z_AI_API_KEY).";
      await recordTurn({ conversationId, role: "ASSISTANT", content: offline });
      await logAiEvent({
        stage: "ai_request",
        chainId,
        action: "ai.ask_anna.request",
        actor: { memberId: session.memberId, userName: session.memberName },
        scope: { householdId, surface: "ask-anna" },
        detail: {
          message: effectiveMessage,
          conversationId,
          inputModality,
          photoAttached: !!photoAnalysis,
          photoSha256,
        },
        entityType: "ai_conversation",
        entityId: conversationId,
      });
      await logAiEvent({
        stage: "ai_recommendation",
        chainId,
        action: "ai.ask_anna.unavailable",
        scope: { householdId, surface: "ask-anna" },
        detail: { reason: "zai_not_configured" },
        entityType: "ai_conversation",
        entityId: conversationId,
      });
      return NextResponse.json({
        response: offline,
        dataUsed: [],
        aiUnavailable: true,
        conversationId,
      });
    }

    // ── Deterministic scoped context (P1 integrity fix) + multimodal rules ──
    const scopedContext = await buildHouseholdContext(householdId);
    const contextBlock = renderContextForPrompt(scopedContext);
    // The multimodal extension is appended ONLY when a photo or voice input
    // is active — the pure-text prompt stays byte-identical to before (no
    // behavior change for the existing regression suites). Base prompt here
    // is the remote branch's buildSystemPrompt() (Wave 2-A date grounding),
    // so the extension composes on top of the FULL certified base.
    const multimodalActive = !!photoAnalysis || inputModality === "voice";
    const systemMessage = multimodalActive
      ? `${buildSystemPrompt()}${MULTIMODAL_SYSTEM_PROMPT_EXTENSION}\n\n${contextBlock}`
      : `${buildSystemPrompt()}\n\n${contextBlock}`;

    // LLM-visible user turn: the customer's words + the server-VERIFIED
    // analysis block when a photo is attached (composed server-side — the
    // client cannot inject its own "analysis" text).
    const llmUserContent = photoAnalysis
      ? composePhotoUserMessage(effectiveMessage, photoAnalysis)
      : effectiveMessage;

    // ── Audit: AI request ──
    await logAiEvent({
      stage: "ai_request",
      chainId,
      action: "ai.ask_anna.request",
      actor: { memberId: session.memberId, userName: session.memberName },
      scope: { householdId, surface: "ask-anna" },
      detail: {
        message: effectiveMessage,
        conversationId,
        inputModality,
        photoAttached: !!photoAnalysis,
        photoSha256,
      },
      entityType: "ai_conversation",
      entityId: conversationId,
    });

    // ── Handle confirmation flow (human decision → execution → result) ──
    if (confirmAction) {
      if (typeof confirmAction.chainId === "string" && confirmAction.chainId.length <= 64) {
        chainId = confirmAction.chainId; // correlation only — auth is session-based
      }

      await logAiEvent({
        stage: "human_decision",
        chainId,
        action: "ai.ask_anna.confirmed",
        actor: { memberId: session.memberId, userName: session.memberName },
        scope: { householdId, surface: "ask-anna" },
        detail: { toolName: confirmAction.toolName, args: confirmAction.action },
        entityType: "ai_conversation",
        entityId: conversationId,
      });

      await logAiEvent({
        stage: "execution",
        chainId,
        action: "ai.ask_anna.execute",
        scope: { householdId, surface: "ask-anna" },
        detail: { toolName: confirmAction.toolName },
        entityType: "ai_conversation",
        entityId: conversationId,
      });

      // householdId comes from the SESSION — the tool layer additionally
      // validates per-task ownership (cancel_task checks task.householdId).
      // FIX-2B (POLICE-2 follow-up, preserved from this branch): the
      // confirmed-write pass — real task creation/cancellation — must not
      // 500 the household chat with raw Prisma internals on a DB throw.
      // Catch it: log server-side and let the LLM report the failure
      // cleanly. Note: create_task/cancel_task executors themselves return
      // {success:false} for business-rule refusals — those never throw and
      // are unaffected. (Attribution is covered by the execution/result
      // audit stages above — success AND failure are recorded.)
      let result: ToolCallResult;
      try {
        result = await executeToolCall(
          confirmAction.toolName,
          confirmAction.action,
          householdId,
          true // executeWrites = true
        );
      } catch (error) {
        console.error(
          `[AskAnna] Confirm-pass tool ${confirmAction.toolName} threw:`,
          error
        );
        const msg = error instanceof Error ? error.message : "Unknown error";
        result = {
          success: false,
          toolName: confirmAction.toolName,
          error: `Tool ${confirmAction.toolName} failed: ${msg.slice(0, 200)}`,
        };
      }

      await recordTurn({
        conversationId,
        role: "TOOL",
        content: JSON.stringify(result.data ?? result.error ?? {}),
        toolName: confirmAction.toolName,
      });
      await logAiEvent({
        stage: "result",
        chainId,
        action: "ai.ask_anna.result",
        scope: { householdId, surface: "ask-anna" },
        detail: { toolName: confirmAction.toolName, success: result.success, data: result.data ?? result.error },
        entityType: "ai_conversation",
        entityId: conversationId,
      });

      // AUTH-4 (provider-failure contract): the action has ALREADY
      // executed at this point — a provider outage during narration must
      // never misreport it. Fall back to a deterministic summary of the
      // REAL result; never guess, never claim failure of a completed
      // action (and never claim success of a failed one).
      let responseText: string;
      try {
        const completion = await zai.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `You are Anna.I. The user confirmed an action. Report the result concisely. If it succeeded, confirm the action with relevant details. If it failed, explain what went wrong.`,
            },
            {
              role: "user",
              content: `I confirmed this action. Result: ${JSON.stringify(result)}`,
            },
          ],
          thinking: { type: "disabled" },
        });

        responseText =
          completion.choices[0]?.message?.content || "Action completed.";
      } catch (narrationError) {
        console.error("[AskAnna] Confirm-pass narration failed:", narrationError);
        responseText = result.success
          ? "The action completed successfully."
          : "The action could not be completed.";
        if (isProviderError(narrationError)) {
          responseText = `${PROVIDER_UNAVAILABLE_MESSAGE} ${responseText}`;
        }
      }
      await recordTurn({ conversationId, role: "ASSISTANT", content: responseText });
      await logAiEvent({
        stage: "ai_recommendation",
        chainId,
        action: "ai.ask_anna.response",
        scope: { householdId, surface: "ask-anna" },
        detail: { response: responseText, dataUsed: [confirmAction.toolName] },
        entityType: "ai_conversation",
        entityId: conversationId,
      });

      return NextResponse.json({
        response: responseText,
        dataUsed: [confirmAction.toolName],
        actionResult: result,
        conversationId,
        chainId,
      });
    }

    // ── Normal flow: LLM with tools + injected scoped context + bounded
    // session memory (recent turns of THIS conversation, server-replayed) ──
    //
    // Service/Pricing/Availability Authority: bounded MULTI-ROUND tool
    // loop (max 2 tool rounds). The LLM may need to look up the live
    // catalogue (get_available_services / get_service_pricing) BEFORE
    // calling create_task; feeding tool results back for one more round
    // lets it chain read → write without guessing. Write tools ALWAYS
    // return a confirmation card (executeWrites=false) — the loop can
    // never execute a booking; the card remains the only approval gate.
    const annaToolSpecs = ANNA_TOOLS.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    const baseMessages = [
      {
        role: "system",
        content: systemMessage,
      },
      ...memoryMessages,
      {
        role: "user",
        content: llmUserContent,
      },
    ];

    const MAX_TOOL_ROUNDS = 2;
    let pendingConfirmation: {
      toolName: string;
      confirmationMessage: string;
      confirmationAction: Record<string, unknown>;
    } | null = null;
    const allToolNames: string[] = [];
    // Messages for the next round / final narration (assistant turns with
    // tool_calls + tool result turns — the same loose shapes the SDK's
    // `Promise<any>` completion returns).
    const toolTraceMessages: any[] = [];
    let lastAssistantContent = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const completion = await zai.chat.completions.create({
        messages:
          round === 0
            ? baseMessages
            : [...baseMessages, ...toolTraceMessages],
        tools: annaToolSpecs,
        thinking: { type: "disabled" },
      });

      const choice = completion.choices[0];
      const responseMessage = choice?.message;
      const toolCalls = responseMessage?.tool_calls as ToolCall[] | undefined;

      // ── No tool calls: this round's content is the final response ──
      if (!toolCalls || toolCalls.length === 0) {
        const responseText =
          responseMessage?.content ||
          "I'm not sure I understood that. Could you rephrase?";
        await recordTurn({ conversationId, role: "ASSISTANT", content: responseText });
        await logAiEvent({
          stage: "ai_recommendation",
          chainId,
          action: "ai.ask_anna.response",
          // No actor → ANNA-AI: the recommendation is system-generated text,
          // exactly like the tool-flow branches (the member is the actor of
          // the REQUEST and any DECISION, never of the recommendation).
          scope: { householdId, surface: "ask-anna" },
          detail: { response: responseText, dataUsed: allToolNames },
          entityType: "ai_conversation",
          entityId: conversationId,
        });
        return NextResponse.json({
          response: responseText,
          dataUsed: allToolNames,
          conversationId,
          chainId,
        });
      }

      // Keep the assistant turn (with tool_calls) for the next round /
      // final narration.
      toolTraceMessages.push(responseMessage);
      if (responseMessage?.content) lastAssistantContent = responseMessage.content;

      // ── Execute tool calls (always with the SESSION householdId) ──
      const results: string[] = [];

      for (const tc of toolCalls) {
        const toolName = tc.function.name;
        allToolNames.push(toolName);
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          args = {};
        }

        // FIX-2B: a single broken tool must NOT 500 the whole chat turn
      // with raw Prisma internals dumped into the household's chat. Catch,
      // log server-side, and hand the LLM a clean tool-level error. A
      // thrown error can never be a requiresConfirmation result, so the
      // confirmation-card flow is unaffected.
        let result: ToolCallResult;
        try {
          result = await executeToolCall(toolName, args, householdId, false);
        } catch (error) {
          console.error(`[AskAnna] Tool ${toolName} threw:`, error);
          const msg = error instanceof Error ? error.message : "Unknown error";
          result = {
            success: false,
            toolName,
            error: `Tool ${toolName} failed: ${msg.slice(0, 200)}`,
          };
        }

        await recordTurn({
          conversationId,
          role: "TOOL",
          content: JSON.stringify(result.data ?? result.error ?? {}),
          toolName,
        });

        if (result.requiresConfirmation && result.confirmationMessage) {
          pendingConfirmation = {
            toolName,
            confirmationMessage: result.confirmationMessage,
            confirmationAction: result.confirmationAction!,
          };
          results.push(
            JSON.stringify({
              status: "pending_confirmation",
              message: result.confirmationMessage,
            })
          );
        } else if (result.success && result.data) {
          results.push(JSON.stringify(result.data));
        } else {
          results.push(
            JSON.stringify({ error: result.error || "Tool execution failed" })
          );
        }

        // Feed this tool's result back for the next round / final narration.
        toolTraceMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: results[results.length - 1] || "{}",
        });
      }

      // ── If there's a pending confirmation, don't call LLM again ──
      // Just return the tool results so the UI can show the confirmation card
      if (pendingConfirmation) {
        // Build a natural response based on the tool results, but also
        // include the confirmation so the UI can render it
        const naturalResponse = lastAssistantContent || "";

        const responseText =
          naturalResponse ||
          `I'd like to ${pendingConfirmation.toolName.replace("_", " ")} for you. Please confirm below.`;
        await recordTurn({ conversationId, role: "ASSISTANT", content: responseText });
        await logAiEvent({
          stage: "ai_recommendation",
          chainId,
          action: "ai.ask_anna.recommendation_pending",
          scope: { householdId, surface: "ask-anna" },
          detail: {
            response: responseText,
            dataUsed: [pendingConfirmation.toolName],
            pendingConfirmation: pendingConfirmation.confirmationAction,
          },
          entityType: "ai_conversation",
          entityId: conversationId,
        });

        return NextResponse.json({
          response: responseText,
          dataUsed: [pendingConfirmation.toolName],
          pendingConfirmation: {
            ...pendingConfirmation,
            chainId, // returned so the confirm call can correlate the audit chain
          },
          conversationId,
          chainId,
        });
      }

      // No card in this round — loop for one more tool round (if the cap
      // allows) so the LLM can chain read-tools into create_task.
    }

    // ── Round cap reached without a card: generate the final response with
    // the accumulated tool results (tools OFF — no further tool use) ──
    const finalCompletion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: systemMessage },
        ...memoryMessages,
        { role: "user", content: llmUserContent },
        ...toolTraceMessages,
      ],
      thinking: { type: "disabled" },
    });

    const finalResponse =
      finalCompletion.choices[0]?.message?.content ||
      "I processed your request but couldn't generate a summary.";
    await recordTurn({ conversationId, role: "ASSISTANT", content: finalResponse });
    await logAiEvent({
      stage: "ai_recommendation",
      chainId,
      action: "ai.ask_anna.response",
      scope: { householdId, surface: "ask-anna" },
      detail: {
        response: finalResponse,
        dataUsed: allToolNames,
      },
      entityType: "ai_conversation",
      entityId: conversationId,
    });

    return NextResponse.json({
      response: finalResponse,
      dataUsed: allToolNames,
      conversationId,
      chainId,
    });
  } catch (error) {
    console.error("[AskAnna NLU] Error:", error);
    // Fail-loud audit: record the failure so the chain has no silent gaps.
    try {
      await logAiEvent({
        stage: "result",
        chainId,
        action: "ai.ask_anna.error",
        scope: {
          householdId: session?.householdId,
          surface: "ask-anna",
          entityId: conversationId ?? undefined,
          entityType: conversationId ? "ai_conversation" : "ai",
        },
        detail: { error: error instanceof Error ? error.message : "Unknown error" },
      });
    } catch {
      // The original error matters more than the audit write.
    }
    const msg = error instanceof Error ? error.message : "Unknown error";

    // AUTH-4 (provider-failure contract): a provider outage (429 / 5xx /
    // timeout / network) is NOT a product failure. Anna degrades
    // gracefully — the exact fallback sentence, never a guess, and never
    // an unsafe action: every write tool was card-gated upstream, so an
    // outage mid-turn cannot have executed anything that was not already
    // user-confirmed. Application errors (DB etc.) still fail loud.
    if (isProviderError(error)) {
      try {
        if (conversationId) {
          await recordTurn({
            conversationId,
            role: "ASSISTANT",
            content: PROVIDER_UNAVAILABLE_MESSAGE,
          });
        }
        await logAiEvent({
          stage: "ai_recommendation",
          chainId,
          action: "ai.ask_anna.response",
          scope: { householdId: session?.householdId, surface: "ask-anna" },
          detail: {
            response: PROVIDER_UNAVAILABLE_MESSAGE,
            degraded: true,
            providerError: msg.slice(0, 200),
          },
          entityType: conversationId ? "ai_conversation" : "ai",
          entityId: conversationId ?? undefined,
        });
      } catch {
        // best-effort audit — the graceful response matters more
      }
      return NextResponse.json({
        response: PROVIDER_UNAVAILABLE_MESSAGE,
        degraded: true,
        providerUnavailable: true,
        conversationId,
        chainId,
      });
    }

    return NextResponse.json(
      { error: `Failed to process your request: ${msg}` },
      { status: 500 }
    );
  }
}
