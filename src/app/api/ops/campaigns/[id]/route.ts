import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { getCampaign, updateCampaign, transitionCampaignStatus, getCampaignStats } from "@/lib/marketing/campaign-service";
import { CampaignStatus } from "@prisma/client";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const allowed = await hasPermission(session, "marketing", "view");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const stats = await getCampaignStats(id);
    return NextResponse.json({ campaign, stats });
  } catch (error) {
    console.error("[/api/ops/campaigns/[id] GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

const updateSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ENDED"]).optional(),
  appliesTo: z.enum(["SUBSCRIPTION_FEE", "JOB_COMMISSION", "BOTH"]).optional(),
  targetTier: z.string().nullable().optional(),
  targetCategory: z.string().nullable().optional(),
  maxRedemptions: z.number().int().positive().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  discountRule: z.object({
    discountType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]).optional(),
    discountValue: z.number().positive().optional(),
    minOrderValueCents: z.number().int().positive().nullable().optional(),
    maxDiscountCapCents: z.number().int().positive().nullable().optional(),
    stackable: z.boolean().optional(),
    eligibility: z.enum(["FIRST_TIME_HOUSEHOLD_ONLY", "EXISTING_HOUSEHOLD", "ANY"]).optional(),
    minAutonomyLevel: z.number().int().nullable().optional(),
    maxAutonomyLevel: z.number().int().nullable().optional(),
  }).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const allowed = await hasPermission(session, "marketing", "edit");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    // Handle status transition separately
    if (parsed.data.status) {
      const newStatus = parsed.data.status as CampaignStatus;
      const updated = await transitionCampaignStatus(id, newStatus);
      return NextResponse.json({ campaign: updated });
    }

    const updated = await updateCampaign(id, parsed.data);
    return NextResponse.json({ campaign: updated });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    console.error("[/api/ops/campaigns/[id] PATCH]", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const allowed = await hasPermission(session, "marketing", "delete");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    // Only allow deleting DRAFT campaigns
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (campaign.status !== "DRAFT") {
      return NextResponse.json({ error: "Only DRAFT campaigns can be deleted" }, { status: 409 });
    }

    const { db } = await import("@/lib/db");
    await db.campaign.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/ops/campaigns/[id] DELETE]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
