import { NextRequest, NextResponse } from "next/server";
import {
  OPS_AI_TOOLS,
  executeOpsToolCall,
  type OpsToolCallResult,
} from "@/lib/ops-ai-tools";
import { getOpsSession, hasMinRole } from "@/lib/ops-auth";
import { getUserPermissions } from "@/lib/permissions";
import { getZAI, isProviderError, PROVIDER_UNAVAILABLE_MESSAGE } from "@/lib/zai";
import {
  checkRateLimit,
  rateLimitResponsePayload,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { requireAiPermission, aiGuardErrorResponse } from "@/lib/ai-guards";
import { buildOpsContext, renderContextForPrompt } from "@/lib/ai-context";
import { logAiEvent, newAiChainId } from "@/lib/ai-audit";

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
// A-6: RBAC resolution — which tools may this session use?
// ─────────────────────────────────────────────────────────────

async function resolveAllowedOpsTools(
  session: { roleId?: string; role?: string }
): Promise<Set<string>> {
  // New RBAC path: permission list decides.
  if (session.roleId) {
    const perms = await getUserPermissions(session.roleId);
    const permSet = new Set(perms);
    return new Set(
      OPS_AI_TOOLS.filter((t) => permSet.has(t.permission)).map((t) => t.name)
    );
  }

  // Legacy path (no roleId): coarse ADMIN-only, same fallback semantics
  // as lib/permissions.ts hasPermission.
  if (session.role !== undefined && hasMinRole(session.role, "ADMIN")) {
    return new Set(OPS_AI_TOOLS.map((t) => t.name));
  }
  return new Set<string>();
}

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
  // AUTH-4: hoisted so the provider-failure catch can correlate the
  // audit chain even when the outage happens mid-turn.
  let chainId: string | null = null;
  try {
    // ── L4 AI governance (Phase 1): requires ai:recommend ──
    // The Ops AI generates advisory output — exactly the ai:recommend
    // permission's meaning. Previously any ops session could call it;
    // now the seeded RBAC matrix decides (super_admin / operations /
    // coordinator: allowed · data_analyst & unauthenticated: denied).
    // DELIBERATE BEHAVIOUR CHANGE, documented in the Phase-1 report.
    const guard = await requireAiPermission("recommend");
    if (!guard.ok) {
      return aiGuardErrorResponse(guard);
    }
    // The guard resolved and verified the ops session (401/403 above) —
    // reuse it for the cost cap + RBAC tool resolution below.
    const session = guard.session;

    // ── AI Wave 2-A (A-5): LLM cost cap — this endpoint was unmetered. ──
    const rlKey = `ops-ai:ops:${session.userId}`;
    if (
      !checkRateLimit(rlKey, RATE_LIMITS.opsAi.limit, RATE_LIMITS.opsAi.windowMs)
    ) {
      return NextResponse.json(rateLimitResponsePayload(rlKey), { status: 429 });
    }

    // ── AI Wave 2-A (A-6): RBAC alignment. Previously the route checked
    // ONLY that an ops session existed — any limited role could read all
    // households/vendors/escrow through the AI tools, bypassing the RBAC
    // enforced on every other ops module. Now only the tools whose
    // permission the session holds are exposed to the LLM — and the same
    // allow-list is enforced at execution time (defense in depth: a
    // hallucinated tool name can't escape it either).
    const allowedTools = await resolveAllowedOpsTools(session);
    if (allowedTools.size === 0) {
      return NextResponse.json(
        {
          error:
            "Your role has no AI assistant permissions. Ask an admin to grant analytics:view, households:view, vendors:view, bookings:view or escrow:view.",
        },
        { status: 403 }
      );
    }
    const exposedTools = OPS_AI_TOOLS.filter((t) => allowedTools.has(t.name));

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

    // ── Phase 3 · §3.2 context injection: deterministic ops context —
    // cross-household AGGREGATES ONLY (counts/sums). No household names,
    // no member PII: the ops AI narrates platform state, not individual
    // dossiers, so every ai:recommend holder sees exactly what the role
    // is permitted to see. ──
    const scopedContext = await buildOpsContext();
    const contextBlock = renderContextForPrompt(scopedContext);
    const systemMessage = `${SYSTEM_PROMPT}\n\n${contextBlock}`;

    // ── Phase 3: audit chain (request stage; actor = the ops user) ──
    chainId = newAiChainId();
    await logAiEvent({
      stage: "ai_request",
      chainId,
      action: "ai.ops_ai.request",
      actor: { userId: guard.session.userId, userName: guard.session.name },
      scope: { surface: "ops-ai" },
      detail: { message: message.slice(0, 600) },
    }).catch((e) => console.error("[OpsAI] audit request stage failed:", e));

    // ── LLM call with tools (only the permitted subset) + scoped ops context ──
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: message },
      ],
      tools: exposedTools.map((tool) => ({
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
      const response =
        responseMessage?.content ||
        "I'm not sure I understood that. Could you rephrase?";
      await logAiEvent({
        stage: "ai_recommendation",
        chainId,
        action: "ai.ops_ai.response",
        scope: { surface: "ops-ai" },
        detail: { response: response.slice(0, 600), dataUsed: [] },
      }).catch((e) => console.error("[OpsAI] audit recommendation stage failed:", e));
      return NextResponse.json({
        response,
        dataUsed: [],
      });
    }

    // ── Execute tool calls (permission-enforced) ──
    const results: string[] = [];

    for (const tc of toolCalls) {
      const toolName = tc.function.name;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }

      // A-6: execution-time guard — even a hallucinated tool name outside
      // the permitted subset is refused, not executed.
      if (!allowedTools.has(toolName)) {
        results.push(
          JSON.stringify({ error: `Permission denied: ${toolName} is not available to your role.` })
        );
        continue;
      }

      // FIX-2B: a single broken tool must NOT 500 the whole chat turn
      // with raw Prisma internals dumped into the operator's chat. Catch,
      // log server-side, and hand the LLM a clean tool-level error so it
      // can report what failed and still answer the rest of the question.
      let result: OpsToolCallResult;
      try {
        result = await executeOpsToolCall(toolName, args);
      } catch (error) {
        console.error(`[OpsAI] Tool ${toolName} threw:`, error);
        const msg = error instanceof Error ? error.message : "Unknown error";
        result = {
          success: false,
          toolName,
          error: `Tool ${toolName} failed: ${msg.slice(0, 200)}`,
        };
      }

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
        { role: "system", content: systemMessage },
        { role: "user", content: message },
        ...(responseMessage ? [responseMessage] : []),
        ...toolResultMessage,
      ],
      thinking: { type: "disabled" },
    });

    const finalResponse =
      finalCompletion.choices[0]?.message?.content ||
      "I processed your request but couldn't generate a summary.";
    await logAiEvent({
      stage: "ai_recommendation",
      chainId,
      action: "ai.ops_ai.response",
      scope: { surface: "ops-ai" },
      detail: {
        response: finalResponse.slice(0, 600),
        dataUsed: toolCalls.map((tc) => tc.function.name),
      },
    }).catch((e) => console.error("[OpsAI] audit recommendation stage failed:", e));

    return NextResponse.json({
      response: finalResponse,
      dataUsed: toolCalls.map((tc) => tc.function.name),
    });
  } catch (error) {
    console.error("[OpsAI] Error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";

    // AUTH-4 (provider-failure contract): a provider outage is not an
    // application failure — degrade gracefully with the exact fallback
    // sentence instead of a raw 500. Ops AI tools are read-only, so an
    // outage mid-turn cannot have executed anything.
    if (isProviderError(error)) {
      try {
        await logAiEvent({
          stage: "ai_recommendation",
          // fresh chain when the outage pre-empted chain creation
          chainId: chainId ?? newAiChainId(),
          action: "ai.ops_ai.response",
          scope: { surface: "ops-ai" },
          detail: {
            response: PROVIDER_UNAVAILABLE_MESSAGE,
            degraded: true,
            providerError: msg.slice(0, 200),
          },
        });
      } catch {
        // best-effort audit
      }
      return NextResponse.json({
        response: PROVIDER_UNAVAILABLE_MESSAGE,
        degraded: true,
        providerUnavailable: true,
      });
    }

    return NextResponse.json(
      { error: `Failed to process your request: ${msg}` },
      { status: 500 }
    );
  }
}
