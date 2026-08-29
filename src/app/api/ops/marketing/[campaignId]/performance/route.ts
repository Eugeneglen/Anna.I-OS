import { NextRequest, NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { getCampaignFunnel, calculateCampaignROI } from "@/lib/marketing/attribution-engine";
import { get, set, MARKETING_CACHE_KEYS } from "@/lib/cache";

// GET /api/ops/marketing/[campaignId]/performance
// Returns the full campaign performance: funnel, ROI, timeline, reactivation
//
// Fix 19 — server-side in-memory cache (30s TTL, per-campaign). The
// underlying `getCampaignFunnel` + `calculateCampaignROI` pair runs 10+
// Prisma queries per call (counts, group-bys, attributed-task fetches,
// reactivated-customer scans). A short TTL + per-campaign invalidation
// on redemption keeps the dashboard responsive without serving stale
// data after a write.
const CAMPAIGN_PERF_CACHE_TTL_MS = 30_000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const allowed = await hasPermission(session, "marketing", "view");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { campaignId } = await params;

    // ── Fix 19 — short-circuit on cache hit ──
    // Auth + permission checks still run on every request, so cached
    // responses stay access-controlled. The cache key is per-campaign
    // so a busy dashboard looking at one campaign doesn't get blocked
    // by another tenant's traffic.
    const cacheKey = MARKETING_CACHE_KEYS.campaignPerf(campaignId);
    const cached = get<unknown>(cacheKey);
    if (cached !== null) {
      return NextResponse.json(cached);
    }

    const [funnel, roi] = await Promise.all([
      getCampaignFunnel(campaignId),
      calculateCampaignROI(campaignId),
    ]);

    const payload = { funnel, roi };

    // Cache for 30s. Mutations (redemption applied, voucher issued,
    // campaign status change) call `invalidateCampaignPerfCache(id)`
    // to drop the entry so the next read fetches fresh data.
    set(cacheKey, payload, CAMPAIGN_PERF_CACHE_TTL_MS);

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[/api/ops/marketing/[campaignId]/performance GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
