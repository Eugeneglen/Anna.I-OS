import { NextRequest, NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { getCampaignFunnel, calculateCampaignROI } from "@/lib/marketing/attribution-engine";

// GET /api/ops/marketing/[campaignId]/performance
// Returns the full campaign performance: funnel, ROI, timeline, reactivation
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

    const [funnel, roi] = await Promise.all([
      getCampaignFunnel(campaignId),
      calculateCampaignROI(campaignId),
    ]);

    return NextResponse.json({
      funnel,
      roi,
    });
  } catch (error) {
    console.error("[/api/ops/marketing/[campaignId]/performance GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
