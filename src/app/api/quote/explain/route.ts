import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getZAI } from "@/lib/zai";
import { getHouseholdSession } from "@/lib/household-auth";
import {
  checkRateLimit,
  rateLimitResponsePayload,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const EXPLAIN_SYSTEM_PROMPT = `You are Anna.I, the AI operating system for modern households in Singapore. You are explaining a service quotation to a homeowner.

Your job is to take the quotation breakdown and explain it clearly, helpfully, and transparently — like a trusted advisor, not a salesperson.

GUIDELINES:
- Be concise (2-4 short paragraphs max).
- Explain WHAT the quote covers and WHY each line item exists.
- Use SGD currency format (e.g., SGD $68.00).
- Mention any add-ons the user selected and what value they add.
- If there are cost-saving suggestions, mention them naturally.
- Never upsell aggressively — you serve the household, not the vendor.
- Use a warm, knowledgeable tone appropriate for Singapore households.
- Avoid generic filler. Every sentence must add real information.`;

interface ExplainRequest {
  quotationId?: string;
  // Allow inline explanation without a saved quotation
  jobTypeName?: string;
  category?: string;
  totalCents?: number;
  breakdown?: Array<{ label: string; amountCents: number }>;
  fieldValues?: Record<string, number>;
  selectedAddOns?: string[];
  addOns?: Array<{ key: string; label: string; priceCents: number }>;
  householdId?: string;
}

export async function POST(request: NextRequest) {
  try {
    // ── AI Wave 2-A (A-1): this route was FULLY UNAUTHENTICATED. A live
    // probe during the AI audit returned HTTP 200 with a REAL quotation's
    // contents (SGD 350 base + SGD 25 add-on) to an anonymous caller —
    // the LLM was acting as a free data-leak + token-burn proxy. Guarded
    // now: household session required, quotation lookups scoped to the
    // session's own household, rate-limited.
    const session = await getHouseholdSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rlKey = `quote-explain:hh:${session.householdId}`;
    if (
      !checkRateLimit(rlKey, RATE_LIMITS.quoteExplain.limit, RATE_LIMITS.quoteExplain.windowMs)
    ) {
      return NextResponse.json(rateLimitResponsePayload(rlKey), { status: 429 });
    }

    const body: ExplainRequest = await request.json();
    const { quotationId } = body;

    // A-1: strip client-supplied householdId — never trusted for scoping.
    delete (body as Record<string, unknown>).householdId;

    let contextData: {
      jobTypeName: string;
      category: string;
      totalCents: number;
      breakdown: Array<{ label: string; amountCents: number }>;
      selectedAddOns: string[];
      addOns: Array<{ key: string; label: string; priceCents: number }>;
      fieldValues: Record<string, number>;
    };

    // If quotationId is provided, fetch from DB — ownership-scoped (A-1:
    // a quotationId from ANY household previously explained fine).
    if (quotationId) {
      const quotation = await db.quotation.findUnique({
        where: { id: quotationId },
        include: {
          jobType: { select: { name: true, category: true } },
        },
      });

      if (!quotation || quotation.householdId !== session.householdId) {
        // 404 (not 403) — don't confirm existence of other households' data.
        return NextResponse.json(
          { error: "Quotation not found" },
          { status: 404 }
        );
      }

      contextData = {
        jobTypeName: quotation.jobType.name,
        category: quotation.jobType.category,
        totalCents: quotation.totalCents,
        breakdown: quotation.breakdown as unknown as Array<{ label: string; amountCents: number }>,
        selectedAddOns: quotation.selectedAddOns as unknown as string[],
        addOns: [],
        fieldValues: {},
      };

      // Return cached explanation if it exists
      if (quotation.aiExplanation) {
        return NextResponse.json({
          explanation: quotation.aiExplanation,
          cached: true,
        });
      }
    } else {
      // Inline explanation from form data
      contextData = {
        jobTypeName: body.jobTypeName || "Service",
        category: body.category || "GENERAL",
        totalCents: body.totalCents || 0,
        breakdown: body.breakdown || [],
        selectedAddOns: body.selectedAddOns || [],
        addOns: body.addOns || [],
        fieldValues: body.fieldValues || {},
      };
    }

    // Format the breakdown for the LLM
    const breakdownText = contextData.breakdown
      .map((item) => `${item.label}: SGD ${(item.amountCents / 100).toFixed(2)}`)
      .join("\n");

    const addOnText = contextData.addOns
      .filter((a) => contextData.selectedAddOns.includes(a.key))
      .map((a) => `+ ${a.label}: SGD ${(a.priceCents / 100).toFixed(2)}`)
      .join("\n");

    const userPrompt = `Please explain this quotation to the homeowner:

Service: ${contextData.jobTypeName} (${contextData.category})
Total: SGD ${(contextData.totalCents / 100).toFixed(2)}

Breakdown:
${breakdownText}
${addOnText ? `\nSelected Add-ons:\n${addOnText}` : ""}

Explain what this covers and why it costs what it does. Be specific and helpful.`;

    const zai = await getZAI();
    if (!zai) {
      return NextResponse.json(
        { explanation: "AI-powered quote explanation is not available on this server. Please contact support." },
        { status: 503 }
      );
    }

    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: EXPLAIN_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
    });

    const explanation =
      completion.choices[0]?.message?.content ||
      "This quotation covers the selected service. The price reflects standard market rates for Singapore.";

    // Cache the explanation on the quotation record if we have an ID
    if (body.quotationId) {
      await db.quotation.update({
        where: { id: body.quotationId },
        data: { aiExplanation: explanation },
      }).catch(() => {
        // Non-critical — don't fail the response if caching fails
        console.warn("[/api/quote/explain] Failed to cache aiExplanation");
      });
    }

    return NextResponse.json({ explanation, cached: false });
  } catch (error) {
    console.error("[/api/quote/explain] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate explanation" },
      { status: 500 }
    );
  }
}
