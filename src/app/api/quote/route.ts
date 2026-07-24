import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  calculateQuote,
  type JobTypePricingRules,
  type JobTypeRequiredField,
  type JobTypeAddOn,
} from "@/lib/quote-calculator";

const createQuotationSchema = z.object({
  householdId: z.string().min(1),
  jobTypeId: z.string().min(1),
  fieldValues: z.record(z.string(), z.number()),
  selectedAddOns: z.array(z.string()),
});

// POST /api/quote
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = createQuotationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }

    const { householdId, jobTypeId, fieldValues, selectedAddOns } =
      parsed.data;

    // Validate household exists
    const household = await db.household.findUnique({
      where: { id: householdId },
    });
    if (!household) {
      return NextResponse.json(
        { error: "Household not found" },
        { status: 404 }
      );
    }

    // Fetch the service job type
    const jobType = await db.serviceJobType.findUnique({
      where: { id: jobTypeId },
    });
    if (!jobType) {
      return NextResponse.json(
        { error: "Job type not found" },
        { status: 404 }
      );
    }
    if (!jobType.isActive) {
      return NextResponse.json(
        { error: "Job type is not active" },
        { status: 400 }
      );
    }

    // Parse JSON fields from the job type
    const pricingRules = jobType.pricingRules as unknown as JobTypePricingRules;
    const requiredFields =
      jobType.requiredFields as unknown as JobTypeRequiredField[];
    const addOns = jobType.addOns as unknown as JobTypeAddOn[];

    // Calculate the quote
    const result = calculateQuote(
      jobType.basePriceCents,
      pricingRules,
      requiredFields,
      addOns,
      fieldValues,
      selectedAddOns
    );

    // Create the quotation record
    const quotation = await db.quotation.create({
      data: {
        householdId,
        jobTypeId,
        fieldValues: fieldValues as never,
        selectedAddOns: selectedAddOns as never,
        baseCents: result.baseCents,
        addOnsCents: result.addOnsCents,
        totalCents: result.totalCents,
        breakdown: result.breakdown as never,
      },
    });

    // Fire-and-forget: generate AI explanation (Phase 4B)
    generateExplanationInBackground(
      quotation.id,
      jobType.name,
      jobType.category,
      result.totalCents,
      result.breakdown,
      addOns,
      selectedAddOns
    ).catch(() => {});

    return NextResponse.json(
      {
        quotation: {
          ...quotation,
          breakdown: result.breakdown,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/quote error:", error);
    return NextResponse.json(
      { error: "Failed to create quotation" },
      { status: 500 }
    );
  }
}

/**
 * Fire-and-forget AI explanation generation.
 * Runs in the background after quotation creation.
 */
async function generateExplanationInBackground(
  quotationId: string,
  jobTypeName: string,
  category: string,
  totalCents: number,
  breakdown: Array<{ label: string; amountCents: number }>,
  addOns: unknown[],
  selectedAddOns: string[]
) {
  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();

    const breakdownText = breakdown
      .map((item) => `${item.label}: SGD ${(item.amountCents / 100).toFixed(2)}`)
      .join("\n");

    const parsedAddOns = addOns as Array<{ key: string; label: string; priceCents: number }>;
    const addOnText = parsedAddOns
      .filter((a) => selectedAddOns.includes(a.key))
      .map((a) => `+ ${a.label}: SGD ${(a.priceCents / 100).toFixed(2)}`)
      .join("\n");

    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are Anna.I, Singapore's home services AI. Explain this quotation to a homeowner in 2-3 concise sentences. Be specific about what's included and why it costs what it does. Use SGD format. Warm, knowledgeable tone. No upselling.`,
        },
        {
          role: "user",
          content: `Service: ${jobTypeName} (${category})\nTotal: SGD ${(totalCents / 100).toFixed(2)}\n\nBreakdown:\n${breakdownText}${addOnText ? `\n\nAdd-ons:\n${addOnText}` : ""}`,
        },
      ],
      thinking: { type: "disabled" },
    });

    const explanation = completion.choices[0]?.message?.content;
    if (explanation) {
      await db.quotation.update({
        where: { id: quotationId },
        data: { aiExplanation: explanation },
      });
    }
  } catch (err) {
    console.warn("[POST /api/quote] Background explanation failed:", err);
  }
}