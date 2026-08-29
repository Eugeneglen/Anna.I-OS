import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { createCampaign, getCampaigns } from "@/lib/marketing/campaign-service";
import { db } from "@/lib/db";
import {
  checkRateLimit,
  opsRateKey,
  rateLimitResponsePayload,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { invalidateBehaviourCache, invalidateCampaignPerfCache } from "@/lib/cache";

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
  // Phase 2 Fix 10 — campaign content editor
  subjectLine: z.string().max(200).optional(),
  bodyText: z.string().max(10_000).optional(),
  bodyHtml: z.string().max(50_000).optional(),
  smsText: z.string().max(160).optional(),
  // ── Fix 21 — timezone-aware scheduled send (additive) ──
  // Optional ISO datetime; if absent, the campaign has no scheduled
  // send (existing behaviour). `timezone` must be a valid IANA zone
  // name when provided; we default to "Asia/Singapore" server-side.
  sendAt: z.string().optional(),
  timezone: z.string().max(64).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const allowed = await hasPermission(session, "marketing", "create");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // ── Fix 17 — rate limit campaign creation per ops user ──
    // 10 requests / minute per user. Without this, a script (or a
    // trigger-happy clicker) can spam VoucherIssuanceJob rows + discount
    // codes that all hit the DB. Auth + permission checks stay first;
    // rate-limit is applied only to authenticated callers.
    const rlKey = opsRateKey(session.userId, "campaign-create");
    if (!checkRateLimit(rlKey, RATE_LIMITS.campaignCreate.limit, RATE_LIMITS.campaignCreate.windowMs)) {
      return NextResponse.json(rateLimitResponsePayload(rlKey), { status: 429 });
    }

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

    // ── Fix 19 — invalidate caches on campaign create ──
    // A new campaign (especially one immediately set to ACTIVE + linked
    // to a segment) starts accepting redemptions / issuing vouchers,
    // which changes the behaviour-engine outputs (acquisition source,
    // voucher counts, etc.). Drop the behaviour cache + the new
    // campaign's perf cache (currently empty, but defensive) so the
    // next read fetches fresh data.
    invalidateBehaviourCache();
    invalidateCampaignPerfCache(campaign.id);

    // Phase 2 Fix 11: if a segmentId is provided, do NOT issue vouchers
    // synchronously. Instead, create a VoucherIssuanceJob row (status=PENDING)
    // and return 202 immediately with the jobId. The actual issuance is
    // processed by POST /api/ops/marketing/process-issuance-job (polling).
    if (parsed.data.segmentId) {
      // Activate the campaign first (so codes can be redeemed)
      await db.campaign.update({
        where: { id: campaign.id },
        data: { status: "ACTIVE" },
      });

      // Link the segment to the campaign
      await db.segment.update({
        where: { id: parsed.data.segmentId },
        data: { campaignId: campaign.id },
      });

      // Count segment members so the UI can show progress upfront.
      const memberCount = await db.segmentMember.count({
        where: { segmentId: parsed.data.segmentId },
      });

      // Create the issuance job row.
      const job = await db.voucherIssuanceJob.create({
        data: {
          campaignId: campaign.id,
          segmentId: parsed.data.segmentId,
          status: "PENDING",
          totalMembers: memberCount,
        },
      });

      return NextResponse.json(
        {
          campaign,
          issuanceJobId: job.id,
          issuanceStatus: "PENDING",
          totalMembers: memberCount,
        },
        { status: 202 },
      );
    }

    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    console.error("[/api/ops/campaigns POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
