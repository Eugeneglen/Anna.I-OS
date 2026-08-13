import { NextRequest, NextResponse } from "next/server";
import { ANNA_TOOLS, executeToolCall } from "@/lib/nlu-tools";
import { getZAI } from "@/lib/zai";

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
    const body: AskAnnaRequest = await request.json();
    const { message, householdId, confirmAction } = body;

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
      const result = await executeToolCall(
        confirmAction.toolName,
        confirmAction.action,
        householdId,
        true // executeWrites = true
      );

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
          content: SYSTEM_PROMPT,
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

      const result = await executeToolCall(toolName, args, householdId, false);

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
        { role: "system", content: SYSTEM_PROMPT },
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
