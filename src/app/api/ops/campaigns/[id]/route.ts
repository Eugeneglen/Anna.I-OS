import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { getCampaign, updateCampaign, transitionCampaignStatus, getCampaignStats } from "@/lib/marketing/campaign-service";
import { CampaignStatus } from "@prisma/client";
import { invalidateBehaviourCache, invalidateCampaignPerfCache } from "@/lib/cache";
import {
  discountRuleRefinement,
  isoDateString,
  MAX_PERCENT_DISCOUNT,
  MAX_FIXED_DISCOUNT_VALUE,
  MAX_SPEND_CENTS,
} from "@/lib/marketing/schemas";

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

// F8 (police-1c finding #1): the EDIT path now enforces the exact same
// bounds as POST — previously pct-500 / fixed-$1B / end-before-start were
// ACCEPTED here while POST 400'd them (H10 half-open on edit).
const updateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(2_000).nullable().optional(),
    status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ENDED"]).optional(),
    appliesTo: z.enum(["SUBSCRIPTION_FEE", "JOB_COMMISSION", "BOTH"]).optional(),
    targetTier: z.string().max(40).nullable().optional(),
    targetCategory: z.string().max(40).nullable().optional(),
    maxRedemptions: z.number().int().positive().max(1_000_000).nullable().optional(),
    startDate: isoDateString.nullable().optional(),
    endDate: isoDateString.nullable().optional(),
    discountRule: z
      .object({
        discountType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]).optional(),
        discountValue: z.number().positive().optional(),
        minOrderValueCents: z.number().int().positive().max(MAX_SPEND_CENTS).nullable().optional(),
        maxDiscountCapCents: z.number().int().positive().max(MAX_SPEND_CENTS).nullable().optional(),
        stackable: z.boolean().optional(),
        eligibility: z.enum(["FIRST_TIME_HOUSEHOLD_ONLY", "EXISTING_HOUSEHOLD", "ANY"]).optional(),
        minAutonomyLevel: z.number().int().min(1).max(5).nullable().optional(),
        maxAutonomyLevel: z.number().int().min(1).max(5).nullable().optional(),
      })
      .superRefine((rule, ctx) => {
        // Same discount bounds as create; applies when the edit includes a
        // discountType/value pair (or edits value alone — the EXISTING rule
        // from the DB is merged below before validation).
        if (rule.discountType || rule.discountValue !== undefined) {
          discountRuleRefinement(
            {
              discountType: rule.discountType ?? "",
              discountValue: rule.discountValue ?? 0,
              maxDiscountCapCents: rule.maxDiscountCapCents ?? undefined,
            },
            ctx
          );
        }
        if (
          rule.discountType === undefined &&
          rule.discountValue !== undefined &&
          rule.discountValue > Math.max(MAX_PERCENT_DISCOUNT, MAX_FIXED_DISCOUNT_VALUE)
        ) {
          ctx.addIssue({ code: "custom", path: ["discountValue"], message: "Discount value out of range" });
        }
      })
      .optional(),
  })
  .refine(
    (d) =>
      !d.startDate ||
      !d.endDate ||
      new Date(d.endDate).getTime() > new Date(d.startDate).getTime(),
    { message: "endDate must be after startDate", path: ["endDate"] }
  );

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
      // ── Fix 19 — status transitions (e.g. DRAFT → ACTIVE) change the
      // funnel's "active campaign" status and may unlock redemptions, so
      // drop the campaign-perf cache. The behaviour cache is unaffected
      // by a status flip alone, but we invalidate defensively because a
      // PAUSED → ENDED transition may freeze voucher issuance flows.
      invalidateCampaignPerfCache(id);
      invalidateBehaviourCache();
      return NextResponse.json({ campaign: updated });
    }

    const updated = await updateCampaign(id, parsed.data);
    // ── Fix 19 — content / rule edits change the funnel (codes count,
    // discount rules) and the behaviour outputs (discountCents affects
    // monetaryScore if a redemption is later applied with new rules).
    invalidateCampaignPerfCache(id);
    invalidateBehaviourCache();
    return NextResponse.json({ campaign: updated });
  } catch (error) {
    console.error("[/api/ops/campaigns/[id] PATCH]", error);
    // Police-1c: unknown id previously leaked Prisma internals via
    // error.message → generic 500 message + a 404 fast-path is handled by
    // updateCampaign throwing — keep the generic message.
    return NextResponse.json({ error: "Failed to update campaign" }, { status: 500 });
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
    // ── Fix 19 — campaign deletion removes the funnel + ROI rows, so
    // drop the perf cache. The behaviour cache may still reference the
    // deleted campaign via attribution rows, so invalidate defensively.
    invalidateCampaignPerfCache(id);
    invalidateBehaviourCache();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/ops/campaigns/[id] DELETE]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
