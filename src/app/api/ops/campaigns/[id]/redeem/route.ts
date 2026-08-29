import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOpsSession } from "@/lib/ops-auth";
import { hasAnyPermission } from "@/lib/permissions";
import { validateRedemption, applyRedemption } from "@/lib/marketing/campaign-service";
import {
  checkRateLimit,
  opsRateKey,
  rateLimitResponsePayload,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { invalidateBehaviourCache, invalidateCampaignPerfCache } from "@/lib/cache";

// POST /api/ops/campaigns/[id]/redeem — validate + apply a discount code
// OPS-only endpoint: used by OPS staff to redeem a code on behalf of a household.
// The household-side redemption goes through /api/tasks POST which calls
// validateRedemption + applyRedemption server-side with the household session.
const redeemSchema = z.object({
  code: z.string().min(1),
  householdId: z.string().min(1),
  orderValueCents: z.number().int().positive(),
  orderType: z.enum(["job", "subscription"]),
  category: z.string().optional(),
  bookingId: z.string().optional(),
  subscriptionId: z.string().optional(),
  existingDiscountApplied: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    // Auth: this endpoint is OPS-only (used to redeem on behalf of a household).
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const allowed = await hasAnyPermission(session, ["marketing:edit", "marketing:create"]);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ── Fix 17 — rate limit code redemption per ops user ──
    // 20 requests / minute per ops user. The endpoint mutates ledger rows
    // (decrements usesRemaining, increments campaign.redemptionsCount, writes
    // CodeRedemption) — a runaway loop would double-charge a household's
    // voucher balance. Auth + permission checks stay first.
    const rlKey = opsRateKey(session.userId, "campaign-redeem");
    if (!checkRateLimit(rlKey, RATE_LIMITS.campaignRedeem.limit, RATE_LIMITS.campaignRedeem.windowMs)) {
      return NextResponse.json(rateLimitResponsePayload(rlKey), { status: 429 });
    }

    const body = await req.json();
    const parsed = redeemSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    // 1. Validate the redemption
    const result = await validateRedemption({
      code: parsed.data.code,
      householdId: parsed.data.householdId,
      orderValueCents: parsed.data.orderValueCents,
      orderType: parsed.data.orderType,
      category: parsed.data.category,
      existingDiscountApplied: parsed.data.existingDiscountApplied,
    });

    if (!result.valid) {
      return NextResponse.json({ valid: false, reason: result.reason }, { status: 409 });
    }

    // 2. Apply the redemption (write to DB)
    const redemption = await applyRedemption({
      code: parsed.data.code,
      householdId: parsed.data.householdId,
      discountCents: result.discountCents!,
      campaignId: result.campaignId!,
      codeId: result.codeId!,
      bookingId: parsed.data.bookingId,
      subscriptionId: parsed.data.subscriptionId,
    });

    // ── Fix 19 — invalidate caches after a successful redemption ──
    // The behaviour cache holds voucher/redemption counts + RFM scores
    // that just changed; the campaign-perf cache holds funnel + ROI
    // numbers that just incremented. Drop both so the next read sees
    // the new redemption.
    invalidateBehaviourCache();
    invalidateCampaignPerfCache(result.campaignId!);

    return NextResponse.json({
      valid: true,
      discountCents: result.discountCents,
      redemptionId: redemption.id,
      discountedAmountCents: parsed.data.orderValueCents - result.discountCents!,
    });
  } catch (error) {
    console.error("[/api/ops/campaigns/redeem POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
