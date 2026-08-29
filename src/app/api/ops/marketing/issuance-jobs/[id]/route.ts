import { NextRequest, NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { db } from "@/lib/db";

// GET /api/ops/marketing/issuance-jobs/[id] — fetch a single VoucherIssuanceJob
//
// Used by the client (campaign-create-dialog) to poll the job status after
// POST /api/ops/campaigns returns 202 with an issuanceJobId. The client polls
// every ~1.5s until status === "COMPLETED" or "FAILED".
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const allowed = await hasPermission(session, "marketing", "view");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const job = await db.voucherIssuanceJob.findUnique({
      where: { id },
      select: {
        id: true,
        campaignId: true,
        segmentId: true,
        status: true,
        totalMembers: true,
        processedCount: true,
        failedCount: true,
        error: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    });

    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    return NextResponse.json({ job });
  } catch (error) {
    console.error("[/api/ops/marketing/issuance-jobs/[id] GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
