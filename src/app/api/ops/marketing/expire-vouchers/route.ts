import { NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { runExpirySweep } from "@/lib/marketing/voucher-engine";
import { invalidateBehaviourCache, invalidateAllCampaignPerfCaches } from "@/lib/cache";
import { checkRateLimit, opsRateKey, rateLimitResponsePayload } from "@/lib/rate-limit";

// POST /api/ops/marketing/expire-vouchers
// Manually triggers the voucher expiry lifecycle pass (F20): flip past-expiry
// CLAIMED vouchers → EXPIRED + send "expiring soon" reminders inside the
// configured notice window (config.voucherExpiryNoticeDays, default 3).
// The sweep logic lives in the voucher engine (runExpirySweep) so the
// ops-events cron tick (/api/ops/marketing/dispatch-expiry) runs the exact
// same code path.
export async function POST() {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const allowed = await hasPermission(session, "marketing", "edit");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ── F8: expiry sweep is heavy (notification fan-out) — 2/min max ──
    const rlKey = opsRateKey(session.userId, "expire-vouchers");
    if (!checkRateLimit(rlKey, 2, 60_000)) {
      return NextResponse.json(rateLimitResponsePayload(rlKey), { status: 429 });
    }

    // F20: expiry pass + reminder sweep (previously dead code inline in this
    // route — notifiedAt was pre-stamped at issuance so the reminder filter
    // never matched; see sendVoucherExpiryReminders in the voucher engine).
    const sweep = await runExpirySweep();

    // ── Fix 19 — bulk voucher expiry sweep touches multiple campaigns ──
    // Voucher status flips (CLAIMED → EXPIRED) change the behaviour
    // outputs (vouchersExpired) for every affected household and the
    // funnel numbers (vouchersIssued vs vouchersRedeemed denominator)
    // for every affected campaign. Drop the entire behaviour cache +
    // all campaign-perf caches so the next reads see the new state.
    invalidateBehaviourCache();
    invalidateAllCampaignPerfCaches();

    return NextResponse.json({
      expired: sweep.expired,
      expiringNotified: sweep.remindersSent,
    });
  } catch (error) {
    console.error("[/api/ops/marketing/expire-vouchers POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
