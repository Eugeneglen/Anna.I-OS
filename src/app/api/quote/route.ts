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