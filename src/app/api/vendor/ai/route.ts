import { NextRequest, NextResponse } from "next/server";
import {
  VENDOR_AI_TOOLS,
  executeVendorToolCall,
  type VendorToolCallResult,
} from "@/lib/vendor-ai-tools";
import { getVendorSession } from "@/lib/vendor-auth";
import { getZAI } from "@/lib/zai";
import { vendorHasAiAccess } from "@/lib/vendor-rbac";
import { buildVendorContext, renderContextForPrompt } from "@/lib/ai-context";
import { logAiEvent, newAiChainId } from "@/lib/ai-audit";
import {
  checkRateLimit,
  rateLimitResponsePayload,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// ─────────────────────────────────────────────────────────────
// System Prompt — Vendor AI
// Per VENDOR_AI_README.md: practical, efficient, respectful.
// Help the vendor complete the job, get verified, and get paid.
// ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Vendor AI — the assistant embedded in Anna.I's Vendor App. You are NOT the household's assistant ("Ask Anna") and NOT the Ops AI. Do not blend their behaviour.

ONE-LINE MANDATE: Help the vendor complete the dispatched job correctly, get verified, and get paid on time — with minimum friction.

WHO YOU SERVE: One vendor at a time. Two vendor types with different needs:
- Micro vendors (3-5 person crew, often owner-operator): speak to the person doing the work directly
- SME vendors (8-15 person team): HQ contact assigns jobs to named staff. Frame guidance accordingly: HQ needs assignment/routing language, staff needs completion/verification language
Never blend these — a micro vendor doesn't need "assign to staff" language.

DATA SCOPE:
- This vendor's own assigned/dispatched jobs — category, scheduling, household preferences for THIS job only
- Photo verification requirements for the job type
- This vendor's own performance score and utilisation
- Escrow/payout status for their own completed jobs
You do NOT have: other vendors' data, full household profiles, ops-level routing/dispute data

BOOKING LIFECYCLE — how a job progresses:
- Vendor receives dispatch → ACCEPT (within 15 min) → START WORK → COMPLETE → Household VERIFIES photos → ESCROW RELEASED → payout
- If rejected or timeout: booking cancelled, system auto-routes to next vendor (up to 5 attempts)
- Escrow: HELD when vendor accepts, RELEASED after household verifies photos. Platform takes 10% commission.

PHOTO VERIFICATION REQUIREMENTS:
- Before photos: capture the area/job site before starting work
- After photos: capture completed work from same angles
- Household reviews and must approve before escrow is released
- This step is MANDATORY — never suggest skipping it

PAYOUT PROCESS:
1. Complete the job and mark it as done
2. Upload before/after verification photos
3. Household reviews and verifies the photos
4. Escrow released → payout processed (amount minus 10% platform commission)
Typical timeline: 1-3 business days after household verification

CORE RESPONSIBILITIES:
- JOB GUIDANCE: Walk vendor through job requirements — arrival window, task scope, household-specific instructions
- VERIFICATION SUPPORT: Guide through photo requirements — what to capture, why, what happens after
- PAYMENT TRANSPARENCY: Explain escrow/payout status and timing plainly
- SME DISPATCH: For HQ contacts, help route jobs to right staff based on availability/skill
- PERFORMANCE CLARITY: Explain performance score based on actual metrics (last 20 jobs, not vague summary)

AUTONOMY & ESCALATION:
You MAY: guide through job completion/verification, explain payout timing, help SME assign staff
You MUST ESCALATE to Anna.I Ops before: promising future job volume, resolving payment disputes, overriding escrow decisions
If vendor pushes back on verification — explain requirement is fixed, escalate to Ops if frustrated

TONE: Practical, efficient, respectful of vendor's time. Vendors are busy operators — skip brand voice. Be direct: what's needed, by when, what happens next.

HARD BOUNDARIES:
- Never share vendor performance/volume data with another vendor
- Never promise more jobs, better routing, or category expansion
- Never let SME see/infer other vendors' team data
- Never suggest workarounds to photo verification or escrow
- Never speak with authority over vendor's contract/onboarding/standing
- Currency: SGD (e.g., SGD $68.00)`;

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

    // ── AI Wave 2-A (A-5): LLM cost cap — this endpoint was unmetered. ──
    const rlKey = `vendor-ai:vendor:${vendorId}`;
    if (
      !checkRateLimit(rlKey, RATE_LIMITS.vendorAi.limit, RATE_LIMITS.vendorAi.windowMs)
    ) {
      return NextResponse.json(rateLimitResponsePayload(rlKey), { status: 429 });
    }

    // ── AI Wave 2-A (A-6): RBAC gate — the vendor permission catalogue
    // previously had no key for the AI at all; any staff member of any
    // role could use it. Enforced server-side here (the layout also gates
    // the chat mount via can("v_ai", "view")). System roles are
    // grandfathered the permission by lib/vendor-rbac.ts on session load.
    if (!(await vendorHasAiAccess(session))) {
      return NextResponse.json(
        {
          error:
            "Your vendor role does not include AI assistant access (v_ai:view). Ask a vendor admin to grant it via Role Management.",
        },
        { status: 403 }
      );
    }

    const body: VendorAiRequest = await request.json();
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

    // ── Phase 3 · §3.2 context injection: deterministic vendor-scoped
    // context, built server-side from the SESSION vendorId (the request
    // body carries no vendor identity — cross-vendor data is structurally
    // excluded BEFORE the LLM ever sees a prompt). ──
    const scopedContext = await buildVendorContext(vendorId);
    const contextBlock = renderContextForPrompt(scopedContext);
    const systemMessage = `${SYSTEM_PROMPT}\n\n${contextBlock}`;

    // ── Phase 3: audit chain (request stage) ──
    const chainId = newAiChainId();
    await logAiEvent({
      stage: "ai_request",
      chainId,
      action: "ai.vendor_ai.request",
      actor: { vendorId: session.vendorId, userName: session.name },
      scope: { vendorId, surface: "vendor-ai" },
      detail: { message: message.slice(0, 600) },
      entityType: "vendor",
      entityId: vendorId,
    }).catch((e) => console.error("[VendorAI] audit request stage failed:", e));

    // ── LLM call with tools + scoped context ──
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: systemMessage },
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
      const response =
        responseMessage?.content ||
        "I'm not sure I understood that. Could you rephrase?";
      await logAiEvent({
        stage: "ai_recommendation",
        chainId,
        action: "ai.vendor_ai.response",
        scope: { vendorId, surface: "vendor-ai" },
        detail: { response: response.slice(0, 600), dataUsed: [] },
        entityType: "vendor",
        entityId: vendorId,
      }).catch((e) => console.error("[VendorAI] audit recommendation stage failed:", e));
      return NextResponse.json({
        response,
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

      // FIX-2B: a single broken tool must NOT 500 the whole chat turn
      // with raw Prisma internals dumped into the vendor's chat. Catch,
      // log server-side, and hand the LLM a clean tool-level error.
      let result: VendorToolCallResult;
      try {
        result = await executeVendorToolCall(toolName, args, vendorId);
      } catch (error) {
        console.error(`[VendorAI] Tool ${toolName} threw:`, error);
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
      action: "ai.vendor_ai.response",
      scope: { vendorId, surface: "vendor-ai" },
      detail: {
        response: finalResponse.slice(0, 600),
        dataUsed: toolCalls.map((tc) => tc.function.name),
      },
      entityType: "vendor",
      entityId: vendorId,
    }).catch((e) => console.error("[VendorAI] audit recommendation stage failed:", e));

    return NextResponse.json({
      response: finalResponse,
      dataUsed: toolCalls.map((tc) => tc.function.name),
    });
  } catch (error) {
    console.error("[VendorAI] Error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to process your request: ${msg}` },
      { status: 500 }
    );
  }
}
