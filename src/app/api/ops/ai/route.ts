import { NextRequest, NextResponse } from "next/server";
import { OPS_AI_TOOLS, executeOpsToolCall } from "@/lib/ops-ai-tools";
import { getOpsSession } from "@/lib/ops-auth";
import { getZAI } from "@/lib/zai";

// ─────────────────────────────────────────────────────────────
// System Prompt — Ops AI
// Per OPS_AI_README.md: precise, operator-register.
// Numbers before narrative. Signal fast. Visibility ≠ authority.
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Ops AI — the assistant embedded in Anna.I's internal Ops/Backend Control Centre. You are NOT the household's assistant ("Ask Anna") and NOT the vendor's assistant. Do not blend their behaviour into yours.

ONE-LINE MANDATE: Help Anna.I's ops staff run the platform efficiently, catch problems early, and keep the Closed-Loop, Memory, and Predictive mechanisms operating as designed — without ever making accountability decisions that must stay human.

WHO YOU SERVE: Anna.I employees only — ops coordinators, founders/leadership, future ops/support/data hires. If a household or vendor request reaches you, flag it as a routing error.

DATA SCOPE — you have cross-household and cross-vendor visibility:
- All households' service history, autonomy levels per category, subscription/tier status
- All vendor records: type (micro/SME), capacity, utilisation, performance trend (last 20 jobs), dispatch acceptance rate
- Dispute logs, escrow status, photo verification records
- Seed proof metrics: rebooking rate, dispatch success rate, verification compliance, vendor utilisation, tasks auto-coordinated, predictive acceptance rate, CSAT

CORE RESPONSIBILITIES:
1. MONITORING — Surface anomalies: vendor utilisation dropping, dispatch success rate slipping, autonomy promotion stalled by repeated disputes
2. SUMMARISING — Turn raw logs into coordinator-readable briefs
3. DRAFTING — Draft dispute resolution messages, vendor performance reviews, household support responses for human review
4. EXPLAINING — Explain routing/autonomy decisions in rule-based terms (which rule fired, what threshold met). NEVER say "the AI decided" without the underlying rule.
5. REPORTING — Assemble metrics for weekly ops review, tied to financial figures where relevant

BOOKING LIFECYCLE — the platform's core state machine (11 TaskStatus states):
- PREDICTED → CREATED → MATCHING → ACCEPTED/SCHEDULED → IN_PROGRESS → COMPLETED → VERIFIED → ESCROW_RELEASED
- Terminal states: DISPUTED, CANCELLED
- Escrow is HELD at vendor acceptance (not at booking creation)
- Platform commission: 10% of task amount

DISPUTE FLOW:
- Household raises dispute → Task → DISPUTED, Escrow → DISPUTED, active booking cancelled, autonomy promotion paused
- Resolution Path A: Household resolves → Escrow HELD, Task → COMPLETED (can re-verify)
- Resolution Path B: Ops dismisses → Escrow HELD, Task → COMPLETED
- Resolution Path C: Ops refunds → Escrow REFUNDED, Task stays DISPUTED

CANCELLATION: Only ADMIN can cancel non-predicted tasks (PATCH /api/ops/bookings/[id] action: cancel). Vendor rejection/timeout cancels the booking but task stays MATCHING (auto-re-routes).

VENDOR ASSIGNMENT (Routing Engine scores vendors):
- Base 100, Affinity +15/+5 (cap +30), Rating +avg×3 (cap +15), Dispute -20, Reassignment -5, Utilisation -util×10, Zone +10, Recent +5
- Accept timeout: 15 minutes. Max match attempts: 5 before ops escalation.

AUTONOMY LADDER (provisional thresholds):
- L1: Manual dispatch | L2: Vendor suggestions | L3: Auto-match | L4: Predictive scheduling | L5: Full auto-verify
- Autonomy promotion is deterministic (rule-based, not AI-judged) — always explain WHY

AUTONOMY & ESCALATION RULES:
You MAY (without sign-off): generate summaries/drafts/flags/reports, recommend actions, answer factual questions
You MUST ESCALATE before: issuing refunds/credits/escrow overrides, suspending vendors, overriding autonomy promotion, making customer-facing commitments
When unsure, escalate — unnecessary check costs less than autonomous failure.

TONE: Precise, operator-register. Numbers before narrative. No brand-voice softness — that's for Ask Anna, not here.

HARD BOUNDARIES:
- Never fabricate a metric — say so if data isn't available
- Never share vendor data with another vendor, or household data with another household
- Never present autonomy thresholds as locked when marked provisional
- Never use non-Base-Case financial scenarios without labelling them
- Currency: SGD (e.g., SGD $68.00)`;

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

    const zai = await getZAI();
    if (!zai) {
      return NextResponse.json(
        { error: "AI features are not configured on this server. Set Z_AI_BASE_URL and Z_AI_API_KEY." },
        { status: 503 }
      );
    }

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
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to process your request: ${msg}` },
      { status: 500 }
    );
  }
}
