import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { createCampaign, getCampaigns } from "@/lib/marketing/campaign-service";

export async function GET(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const allowed = await hasPermission(session, "marketing", "view");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || undefined;
    const type = searchParams.get("type") || undefined;

    const campaigns = await getCampaigns({ status, type });
    return NextResponse.json({ campaigns });
  } catch (error) {
    console.error("[/api/ops/campaigns GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  type: z.enum(["FIRST_TIME", "CROSS_SELL", "UPGRADE", "REFERRAL", "PUBLIC_PROMO", "OTHER"]),
  appliesTo: z.enum(["SUBSCRIPTION_FEE", "JOB_COMMISSION", "BOTH"]).optional(),
  targetTier: z.string().optional(),
  targetCategory: z.string().optional(),
  maxRedemptions: z.number().int().positive().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  discountType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
  discountValue: z.number().positive(),
  minOrderValueCents: z.number().int().positive().optional(),
  maxDiscountCapCents: z.number().int().positive().optional(),
  stackable: z.boolean().optional(),
  eligibility: z.enum(["FIRST_TIME_HOUSEHOLD_ONLY", "EXISTING_HOUSEHOLD", "ANY"]).optional(),
  minAutonomyLevel: z.number().int().optional(),
  maxAutonomyLevel: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const allowed = await hasPermission(session, "marketing", "create");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const campaign = await createCampaign({
      ...parsed.data,
      createdById: session.userId,
      createdByName: session.name,
    });

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    console.error("[/api/ops/campaigns POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
