import { NextRequest, NextResponse } from "next/server";
import { runAnomalyDetection } from "@/lib/anomaly-detector";
import { getHouseholdSession } from "@/lib/household-auth";
import { getOpsSession } from "@/lib/ops-auth";
import { isCronRequest } from "@/lib/cron-auth";
import {
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponsePayload,
} from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    // FIX-1a: previously fully unauthenticated — an anonymous POST ran the
    // global detection sweep and created anomaly rows. Now accepts:
    //   - household session (scoped to its OWN household only)
    //   - ops session (any household / global sweep)
    //   - the internal cron service via timing-safe `x-cron-secret`
    //     (same convention as /api/ops/marketing/dispatch-expiry)
    const body = await request.json().catch(() => ({}));
    const bodyHouseholdId =
      typeof body.householdId === "string" ? body.householdId : undefined;

    let householdId: string | undefined;

    if (isCronRequest(request.headers)) {
      // Internal cron timer — may sweep globally or for one household.
      householdId = bodyHouseholdId;
      const rlKey = "cron:anomalies-check";
      if (
        !checkRateLimit(rlKey, RATE_LIMITS.anomalyCheck.limit, RATE_LIMITS.anomalyCheck.windowMs)
      ) {
        return NextResponse.json(rateLimitResponsePayload(rlKey), { status: 429 });
      }
    } else {
      const [hhSession, opsSession] = await Promise.all([
        getHouseholdSession(),
        getOpsSession(),
      ]);

      if (opsSession) {
        householdId = bodyHouseholdId;
      } else if (hhSession) {
        // Household sessions are pinned to their own household — the body
        // householdId is ignored (prevents cross-household probing).
        householdId = hhSession.householdId;
      } else {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      // Light per-caller cap so a single session cannot hammer the sweep.
      const rlKey = `anomalies-check:${opsSession ? `ops:${opsSession.userId}` : `hh:${householdId}`}`;
      if (
        !checkRateLimit(rlKey, RATE_LIMITS.anomalyCheck.limit, RATE_LIMITS.anomalyCheck.windowMs)
      ) {
        return NextResponse.json(rateLimitResponsePayload(rlKey), { status: 429 });
      }
    }

    const result = await runAnomalyDetection(householdId);

    return NextResponse.json({
      message: `Detection complete: ${result.created} new anomalies detected, ${result.skipped} filtered`,
      ...result,
    });
  } catch (error) {
    console.error("POST /api/anomalies/check error:", error);
    return NextResponse.json(
      { error: "Anomaly detection failed" },
      { status: 500 }
    );
  }
}
