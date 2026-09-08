import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getOpsSession } from "@/lib/ops-auth";
import { requireAiPermission } from "@/lib/ai-guards";
import { sweepBriefs } from "@/lib/ai-dispute/brief-service";

// ─────────────────────────────────────────────────────────────
// POST /api/ops/ai/cases/sweep — the 60-second coverage sweep.
//
// Two accepted callers (mirrors dispatch-issuance):
//   1. the ops-events cron with the shared x-cron-secret header
//   2. an ops session holding ai:prepare
//
// Everyone else: 401. In production an unset CRON_SECRET stays
// closed (same hardening as the issuance dispatcher).
// ─────────────────────────────────────────────────────────────

// Dev fallback secret — same convention as dispatch-issuance: in dev an
// unset CRON_SECRET falls back to this value so the cron works out of the
// box; in production an unset secret keeps the endpoint CLOSED.
const DEV_FALLBACK_SECRET = "anna-cron-dev-secret";

function resolveSecret(): string | null {
  const s = process.env.CRON_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[ai-cases-sweep] CRON_SECRET is not set — endpoint CLOSED (401) until it is configured."
    );
    return null;
  }
  return DEV_FALLBACK_SECRET;
}

function cronSecretOk(request: NextRequest): boolean {
  const secret = resolveSecret();
  if (!secret) return false; // closed when unset in production
  const provided = request.headers.get("x-cron-secret");
  if (!provided) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  // Cron path
  if (cronSecretOk(request)) {
    const result = await sweepBriefs();
    if (result.qualifyingDisputes === 0 && result.ensured === 0 && result.expired === 0) {
      return new NextResponse(null, { status: 204 });
    }
    return NextResponse.json({ swept: true, ...result });
  }

  // Session path (ai:prepare)
  const session = await getOpsSession();
  if (session) {
    const guard = await requireAiPermission("prepare");
    if (guard.ok) {
      const result = await sweepBriefs();
      return NextResponse.json({ swept: true, ...result });
    }
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
