import { NextRequest, NextResponse } from "next/server";
import { ANNA_TOOLS, executeToolCall, type ToolCallResult } from "@/lib/nlu-tools";
import { getZAI } from "@/lib/zai";
import { getHouseholdSession } from "@/lib/household-auth";
import {
  checkRateLimit,
  rateLimitResponsePayload,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────
// System Prompt — Ask Anna (Household NLU)
// Per USER_AI_README.md: warm, calm, competent.
// Reduce coordination burden. Move household from Manager → Approver.
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
  return `${SYSTEM_PROMPT}\n\nCURRENT DATE & TIME: ${dateLine} (Asia/Singapore, UTC+8). Resolve every relative date ("today", "tomorrow", "next Friday", "this weekend") against THIS date. When calling create_task, pass scheduledDate as YYYY-MM-DD derived from this date — never from memory or guesses. Prices come from the Anna.I catalog; never state or invent a price yourself.`;
}

// ── AI Wave 2-A (A-8): AI actions are attributable. Every confirmed AI
// write gets an AuditLog row (actor = household member via Ask Anna) —
// previously AI writes left no audit trace at all.
async function auditAiAction(
  session: { memberName: string; memberEmail: string; householdId: string; householdName: string },
  action: string,
  entityType: string,
  entityId: string | null | undefined,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: null, // OpsUser FK — null for household actors
        userName: `${session.memberName} (household, via Ask Anna)`,
        action,
        entityType,
        entityId: entityId ?? null,
        metadata: {
          ...metadata,
          via: "ask-anna",
          actorHouseholdId: session.householdId,
          actorEmail: session.memberEmail,
        },
      },
    });
  } catch (err) {
    // Non-fatal — the action itself already succeeded; a failed audit row
    // must not turn a success into a user-facing error.
    console.error("[AskAnna NLU] audit log failed:", err);
  }
}

// ─────────────────────────────────────────────────────────────
// Request/Response Types
// ─────────────────────────────────────────────────────────────

interface AskAnnaRequest {
  message: string;
  householdId: string;
  conversationId?: string;
  // For confirming a write action
  confirmAction?: {
    toolName: string;
    action: Record<string, unknown>;
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
  try {
    // ── FIX-1a auth guard + IDOR fix ──
    // householdId is now DERIVED from the session cookie and any body
    // householdId is IGNORED — previously the route trusted the request
    // body, giving unauthenticated callers full read access to ANY
    // household's data through the NLU tools.
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const householdId = session.householdId;

    // ── Rate limit: 20 requests / minute per household (LLM cost cap) ──
    const rlKey = `ask-anna:hh:${householdId}`;
    if (
      !checkRateLimit(rlKey, RATE_LIMITS.askAnna.limit, RATE_LIMITS.askAnna.windowMs)
    ) {
      return NextResponse.json(rateLimitResponsePayload(rlKey), { status: 429 });
    }

    const body: AskAnnaRequest = await request.json();
    const { message, confirmAction } = body;

    if (!message || !householdId) {
      return NextResponse.json(
        { error: "Missing message or householdId" },
        { status: 400 }
      );
    }

    // ── Check if AI is available ──
    const zai = await getZAI();
    if (!zai) {
      return NextResponse.json({
        response: "I'm currently offline — my AI engine isn't configured on this server. Please ask your administrator to set up the AI environment variables (Z_AI_BASE_URL, Z_AI_API_KEY).",
        dataUsed: [],
        aiUnavailable: true,
      });
    }

    // ── Handle confirmation flow ──
    if (confirmAction) {
      // FIX-2B (POLICE-2 follow-up): the confirmed-write pass — the most
      // important path, real task creation/cancellation — was still
      // unwrapped, so a DB throw here 500'd the household chat with raw
      // Prisma internals. Catch it: log server-side, keep the A-8 audit
      // row (success:false, attempts matter), and let the LLM report the
      // failure cleanly. Note: create_task/cancel_task executors
      // themselves return {success:false} for business-rule refusals —
      // those never throw and are unaffected.
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

      // A-8: audit the confirmed write (success or failure — attempts matter).
      // cancel_task is audited inside the canonical cancel service already
      // (TASK_CANCELLED with via: "ask-anna"), so only create_task is
      // audited here to avoid double rows.
      if (confirmAction.toolName === "create_task") {
        await auditAiAction(
          session,
          "AI_TASK_CREATED",
          "task",
          (result.data?.taskId as string) ?? null,
          {
            tool: "create_task",
            success: result.success,
            category: confirmAction.action.category ?? null,
            jobTypeId: confirmAction.action.jobTypeId ?? null,
            amountCents: confirmAction.action.amountCents ?? null,
            scheduledStart: confirmAction.action.scheduledStart ?? null,
            recurrence: confirmAction.action.recurrence ?? null,
            instructions: confirmAction.action.instructions ?? null,
          }
        );
      }

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

      return NextResponse.json({
        response:
          completion.choices[0]?.message?.content ||
          "Action completed.",
        dataUsed: [confirmAction.toolName],
        actionResult: result,
      });
    }

    // ── Normal flow: LLM with tools ──
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(),
        },
        {
          role: "user",
          content: message,
        },
      ],
      tools: ANNA_TOOLS.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      thinking: { type: "disabled" },
    });

    const choice = completion.choices[0];
    const responseMessage = choice?.message;
    const toolCalls = responseMessage?.tool_calls as ToolCall[] | undefined;

    // ── No tool calls: respond directly ──
    if (!toolCalls || toolCalls.length === 0) {
      return NextResponse.json({
        response:
          responseMessage?.content ||
          "I'm not sure I understood that. Could you rephrase?",
        dataUsed: [],
      });
    }

    // ── Execute tool calls ──
    const results: string[] = [];
    let pendingConfirmation: {
      toolName: string;
      confirmationMessage: string;
      confirmationAction: Record<string, unknown>;
    } | null = null;

    for (const tc of toolCalls) {
      const toolName = tc.function.name;
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
    }

    // ── If there's a pending confirmation, don't call LLM again ──
    // Just return the tool results so the UI can show the confirmation card
    if (pendingConfirmation) {
      // Build a natural response based on the tool results, but also
      // include the confirmation so the UI can render it
      const naturalResponse = choice?.content || "";

      return NextResponse.json({
        response:
          naturalResponse ||
          `I'd like to ${pendingConfirmation.toolName.replace("_", " ")} for you. Please confirm below.`,
        dataUsed: [pendingConfirmation.toolName],
        pendingConfirmation,
      });
    }

    // ── Generate final response with tool results ──
    const toolResultMessage = toolCalls
      .map((tc, i) => ({
        role: "tool" as const,
        tool_call_id: tc.id,
        content: results[i] || "{}",
      }))
      .flat();

    const finalCompletion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: message },
        ...(responseMessage ? [responseMessage] : []),
        ...toolResultMessage,
      ],
      thinking: { type: "disabled" },
    });

    return NextResponse.json({
      response:
        finalCompletion.choices[0]?.message?.content ||
        "I processed your request but couldn't generate a summary.",
      dataUsed: toolCalls.map((tc) => tc.function.name),
    });
  } catch (error) {
    console.error("[AskAnna NLU] Error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to process your request: ${msg}` },
      { status: 500 }
    );
  }
}
