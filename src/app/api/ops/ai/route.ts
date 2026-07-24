import { NextRequest, NextResponse } from "next/server";
import { OPS_AI_TOOLS, executeOpsToolCall } from "@/lib/ops-ai-tools";
import { getOpsSession } from "@/lib/ops-auth";
import ZAI from "z-ai-web-dev-sdk";

// ─────────────────────────────────────────────────────────────
// System Prompt — Ops AI
// Per OPS_AI_README.md: precise, operator-register.
// Numbers before narrative. Signal fast. Visibility ≠ authority.
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Ops AI assistant for Anna.I, Singapore's home services platform. You help ops coordinators and founders monitor platform health, investigate issues, and prepare reports.

YOUR SCOPE:
- Full cross-household and cross-vendor visibility — platform-wide data.
- You serve Anna.I internal staff only (ops coordinators, founders, analysts).
- If a household or vendor request reaches you, flag it as a routing error.

GUIDELINES:
- Be precise and efficient. Numbers before narrative. Ops staff want signal fast.
- Use SGD currency format (e.g., SGD $68.00).
- When presenting data, lead with the key metric or anomaly, then provide context.
- When explaining routing/autonomy decisions, reference the underlying rule — never present outcomes as black-box results.
- Use a professional, operator-register tone — not the consumer brand voice.

WHAT YOU CAN DO (without human sign-off):
- Generate summaries, flags, and reports
- Recommend actions (e.g. "recommend pausing autonomy promotion for Household X")
- Answer factual questions about platform state
- Explain why a rule-based decision was made

WHAT REQUIRES HUMAN ESCALATION (you must say so):
- Issuing refunds, credits, or escrow release overrides
- Suspending or removing vendors from the routing pool
- Overriding autonomy-level promotion/demotion
- Making customer-facing commitments

IMPORTANT:
- Never fabricate a metric when data isn't available — say so.
- Never share one vendor's data with another vendor, or one household's data with another household.
- Autonomy thresholds are provisional defaults, not final locked values.
- When unsure whether something needs escalation, escalate — an unnecessary human check costs less than an autonomous failure.`;

// ─────────────────────────────────────────────────────────────
// Request/Response Types
// ─────────────────────────────────────────────────────────────

interface OpsAiRequest {
  message: string;
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
// POST /api/ops/ai
// ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Authenticate ops user
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body: OpsAiRequest = await request.json();
    const { message } = body;

    if (!message) {
      return NextResponse.json(
        { error: "Missing message" },
        { status: 400 }
      );
    }

    const zai = await ZAI.create();

    // ── LLM call with tools ──
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: message },
      ],
      tools: OPS_AI_TOOLS.map((tool) => ({
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

    for (const tc of toolCalls) {
      const toolName = tc.function.name;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }

      const result = await executeOpsToolCall(toolName, args);

      if (result.success && result.data) {
        results.push(JSON.stringify(result.data));
      } else {
        results.push(
          JSON.stringify({ error: result.error || "Tool execution failed" })
        );
      }
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
    console.error("[OpsAI] Error:", error);
    return NextResponse.json(
      { error: "Failed to process your request. Please try again." },
      { status: 500 }
    );
  }
}
