import { NextRequest, NextResponse } from "next/server";
import { ANNA_TOOLS, executeToolCall } from "@/lib/nlu-tools";
import ZAI from "z-ai-web-dev-sdk";

// ─────────────────────────────────────────────────────────────
// System Prompt — NLU Write-Capable
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Anna.I, the AI operating system for modern households in Singapore. You help households manage their services through natural conversation.

You have ACCESS TO TOOLS that let you both READ data and EXECUTE write actions (create tasks, cancel bookings). Use them proactively when the user's intent is clear.

GUIDELINES:
- Be concise and natural. No filler or hedging.
- Use SGD currency format (e.g., SGD $68.00).
- When creating tasks, extract the service category and any special instructions from the message.
- Calculate dates properly: "tomorrow", "next Friday", "this weekend" etc.
- If the user's request is ambiguous, ask a brief clarifying question.
- For write actions, the user will need to confirm — your tool call will generate a confirmation card.
- Speak like a knowledgeable assistant, not a robot.`;

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

    // ── Handle confirmation flow ──
    if (confirmAction) {
      const result = await executeToolCall(
        confirmAction.toolName,
        confirmAction.action,
        householdId,
        true // executeWrites = true
      );

      const zai = await ZAI.create();
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
    const zai = await ZAI.create();

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
    return NextResponse.json(
      { error: "Failed to process your request. Please try again." },
      { status: 500 }
    );
  }
}
