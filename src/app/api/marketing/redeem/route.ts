import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRedemption, applyRedemption, RedemptionLimitError } from "@/lib/marketing/campaign-service";
import { invalidateBehaviourCache, invalidateCampaignPerfCache } from "@/lib/cache";
import { resolveHouseholdScope } from "@/lib/api-guards";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { auditLog } from "@/lib/permissions";

// POST /api/marketing/redeem — households redeem discount codes.
//
// F1 (audit C1): dual-caller auth gate at the top —
//   • household session → householdId is DERIVED from the session; any
//     body.householdId is ignored (spoofing impossible);
//   • ops session → requires marketing:edit and may target body.householdId
//     (programmatic / manual ops redemption path);
//   • anyone else → 401.
//
// NOTE: this endpoint is NOT called by the household booking flow today —
// that flow validates + applies the redemption inside POST /api/tasks
// within a single transaction. This endpoint remains for programmatic /
// manual redemptions. Do not delete without confirming ops has no callers.
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
    const body = await req.json();
    const parsed = redeemSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    // ── F1 auth gate ──────────────────────────────────────────────
    const scope = await resolveHouseholdScope(parsed.data.householdId, {
      opsPermission: ["marketing", "edit"],
    });
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status });
    }
    const householdId = scope.householdId;

    // Rate limit: 20/min per caller (mirrors ops campaignRedeem limit).
    const rateKey = `redeem:${scope.actor.kind}:${scope.actor.kind === "household" ? scope.actor.householdId : scope.actor.userId}`;
    if (!checkRateLimit(rateKey, RATE_LIMITS.campaignRedeem.limit, RATE_LIMITS.campaignRedeem.windowMs)) {
      return NextResponse.json({ error: "Too many redemption attempts. Try again shortly." }, { status: 429 });
    }

    const result = await validateRedemption({
      code: parsed.data.code,
      householdId,
      orderValueCents: parsed.data.orderValueCents,
      orderType: parsed.data.orderType,
      category: parsed.data.category,
      existingDiscountApplied: parsed.data.existingDiscountApplied,
    });

    if (!result.valid) {
      return NextResponse.json({ valid: false, reason: result.reason }, { status: 409 });
    }

    const redemption = await applyRedemption({
      code: parsed.data.code,
      householdId,
      discountCents: result.discountCents!,
      campaignId: result.campaignId!,
      codeId: result.codeId!,
      bookingId: parsed.data.bookingId,
      subscriptionId: parsed.data.subscriptionId,
    });

    // Audit trail (F15-lite for this route): who redeemed, for whom, how much.
    if (scope.actor.kind === "ops") {
      try {
        await auditLog({
          userId: scope.actor.userId,
          userName: scope.actor.session.name || scope.actor.session.email,
          action: "marketing.redeem",
          entityType: "campaign",
          entityId: result.campaignId!,
          metadata: { code: parsed.data.code, householdId, discountCents: result.discountCents },
        });
      } catch (auditErr) {
        console.error("[/api/marketing/redeem] auditLog failed:", auditErr);
      }
    }

    // ── Fix 19 — invalidate caches after a successful redemption ──
    // Mirrors the ops-side /api/ops/campaigns/[id]/redeem invalidation:
    // a household-side redemption changes behaviour counts (vouchersRedeemed)
    // + campaign-perf numbers (redemptionRate, conversionRate, etc.).
    invalidateBehaviourCache();
    invalidateCampaignPerfCache(result.campaignId!);

    return NextResponse.json({
      valid: true,
      discountCents: result.discountCents,
      redemptionId: redemption.id,
      discountedAmountCents: parsed.data.orderValueCents - result.discountCents!,
    });
  } catch (error) {
    // F3: limit errors are conflicts (someone consumed the last use), not 500s.
    if (error instanceof RedemptionLimitError) {
      return NextResponse.json({ valid: false, reason: error.message, code: error.code }, { status: 409 });
    }
    console.error("[/api/marketing/redeem POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
