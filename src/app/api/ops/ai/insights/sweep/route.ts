import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getOpsSession } from "@/lib/ops-auth";
import { requireAiPermission, aiGuardErrorResponse } from "@/lib/ai-guards";
import { sweepInsights } from "@/lib/ai-insight/insight-service";

// ─────────────────────────────────────────────────────────────
// POST /api/ops/ai/insights/sweep — event-driven coverage sweep.
//
// Auth mirrors /api/ops/ai/cases/sweep and /api/anomalies/check:
//   • header `x-cron-secret` (timing-safe; prod-unset → CLOSED 401),
//   • OR an ops session with ai:prepare.
//
// The ops-events cron (60s) and the anomaly-detection route both
// drive this: every ACTIVE anomaly gets an insight (dedupKey makes
// it idempotent). 204 = quiet when nothing was ensured (the cron's
// "no log spam" convention).
// ─────────────────────────────────────────────────────────────

const DEV_FALLBACK_SECRET = "anna-cron-dev-secret";

function secretsMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function resolveSecret(): string | null {
  const s = process.env.CRON_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[ai/insights/sweep] CRON_SECRET is not set — cron branch CLOSED (401) until it is configured."
    );
    return null;
  }
  console.warn(
    "[ai/insights/sweep] CRON_SECRET not set — using dev fallback secret. Do NOT ship this to production."
  );
  return DEV_FALLBACK_SECRET;
}

export async function POST(request: NextRequest) {
  try {
    const cronSecret = request.headers.get("x-cron-secret") ?? "";
    const expectedSecret = resolveSecret();
    const viaCron =
      !!expectedSecret && !!cronSecret && secretsMatch(cronSecret, expectedSecret);

    if (!viaCron) {
      const guard = await requireAiPermission("prepare");
      if (!guard.ok) {
        return aiGuardErrorResponse(guard);
      }
    } else {
      // Even the cron path needs a session-shaped identity for logs only;
      // there is none — the sweep is a system act (audit attribution is
      // ANNA-AI inside the service).
      void (await getOpsSession());
    }

    const result = await sweepInsights();

    if (result.ensured === 0 && result.scanned === 0) {
      return new NextResponse(null, { status: 204 });
    }

    return NextResponse.json({
      message: `Insight sweep complete: ${result.ensured} ensured, ${result.skipped} skipped of ${result.scanned} active anomalies`,
      ...result,
    });
  } catch (error) {
    console.error("POST /api/ops/ai/insights/sweep error:", error);
    return NextResponse.json({ error: "Insight sweep failed" }, { status: 500 });
  }
}
