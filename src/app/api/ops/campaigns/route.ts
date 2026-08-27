import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { createCampaign, getCampaigns } from "@/lib/marketing/campaign-service";
import { issueVouchersToSegment } from "@/lib/marketing/voucher-engine";
import { db } from "@/lib/db";

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
  segmentId: z.string().optional(), // Phase 2: link campaign to a segment for voucher issuance
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

    // Phase 2: If a segmentId is provided, issue per-household vouchers to all segment members
    let vouchersIssued = 0;
    if (parsed.data.segmentId) {
      // Activate the campaign first (so codes can be redeemed)
      await db.campaign.update({
        where: { id: campaign.id },
        data: { status: "ACTIVE" },
      });

      // Issue vouchers to all segment members
      const result = await issueVouchersToSegment({
        segmentId: parsed.data.segmentId,
        campaignId: campaign.id,
      });
      vouchersIssued = result.issued;

      // Link the segment to the campaign
      await db.segment.update({
        where: { id: parsed.data.segmentId },
        data: { campaignId: campaign.id },
      });
    }

    return NextResponse.json({ campaign, vouchersIssued }, { status: 201 });
  } catch (error) {
    console.error("[/api/ops/campaigns POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
