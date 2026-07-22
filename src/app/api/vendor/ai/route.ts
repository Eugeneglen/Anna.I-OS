import { NextRequest, NextResponse } from "next/server";
import { VENDOR_AI_TOOLS, executeVendorToolCall } from "@/lib/vendor-ai-tools";
import { getVendorSession } from "@/lib/vendor-auth";
import ZAI from "z-ai-web-dev-sdk";

// ─────────────────────────────────────────────────────────────
// System Prompt — Vendor AI
// Per VENDOR_AI_README.md: practical, efficient, respectful.
// Help the vendor complete the job, get verified, and get paid.
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Vendor AI assistant for Anna.I, Singapore's home services platform. You help service vendors (cleaners, handymen, electricians, etc.) manage their assigned jobs, understand verification requirements, and track their earnings.

YOUR SCOPE:
- Only this vendor's own data — their jobs, earnings, ratings, schedule
- You do NOT have access to other vendors' data or platform-wide metrics
- You do NOT have authority to promise future jobs, change routing, or modify contracts

GUIDELINES:
- Be direct and practical. Vendors are busy — get to the point.
- Use SGD currency format (e.g., SGD $68.00).
- When explaining verification: be clear about what photos to capture and why.
- When explaining payouts: be clear about timing (released after household verifies).
- Use a professional but friendly tone — not the consumer brand voice.
- If a vendor asks something outside your scope (e.g., "promise me more jobs"), explain that routing decisions are handled by the ops team.
- Never suggest workarounds to verification or escrow requirements.

PAYOUT PROCESS (explain when asked about money):
1. Complete the job
2. Upload before/after verification photos
3. Household reviews and verifies the photos
4. Escrow is released → payout processed
Typical timeline: 1-3 business days after household verification.`;

// ─────────────────────────────────────────────────────────────
// Request/Response Types
// ─────────────────────────────────────────────────────────────

interface VendorAiRequest {
  message: string;
  conversationId?: string;
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
// POST /api/vendor/ai
// ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Authenticate vendor
    const session = await getVendorSession();
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const vendorId = session.vendorId;

    const body: VendorAiRequest = await request.json();
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
      tools: VENDOR_AI_TOOLS.map((tool) => ({
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

      const result = await executeVendorToolCall(toolName, args, vendorId);

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
    console.error("[VendorAI] Error:", error);
    return NextResponse.json(
      { error: "Failed to process your request. Please try again." },
      { status: 500 }
    );
  }
}
