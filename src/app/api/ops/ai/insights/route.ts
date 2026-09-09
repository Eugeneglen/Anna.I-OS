import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AiInsightStatus } from "@prisma/client";
import { requireAiPermission, aiGuardErrorResponse } from "@/lib/ai-guards";
import { ensureAnomalyInsight, sweepInsights, getInsightStats } from "@/lib/ai-insight/insight-service";

// ─────────────────────────────────────────────────────────────
// GET /api/ops/ai/insights — the Ops AI Insights feed (ai:prepare).
//
// The list view also fires the coverage sweep in the background
// (mirrors /api/ops/ai/cases): any ACTIVE anomaly that somehow has
// no insight gets one generated. Non-blocking with a cooldown.
// ─────────────────────────────────────────────────────────────

let lastSweepFiredAt = 0;

export async function GET(request: NextRequest) {
  const guard = await requireAiPermission("prepare");
  if (!guard.ok) {
    return aiGuardErrorResponse(guard);
  }

  try {
    const sp = request.nextUrl.searchParams;
    const status = sp.get("status") || "";
    const limit = Math.min(parseInt(sp.get("limit") || "50", 10) || 50, 100);

    const where: Record<string, unknown> = {};
    if (status && Object.values(AiInsightStatus).includes(status as AiInsightStatus)) {
      where.status = status;
    }

    const [insights, stats] = await Promise.all([
      db.aiInsight.findMany({
        where: where as never,
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          insightType: true,
          severity: true,
          entityType: true,
          entityId: true,
          householdId: true,
          vendorId: true,
          status: true,
          title: true,
          body: true,
          evidence: true,
          dedupKey: true,
          aiChainId: true,
          generationStatus: true,
          generationAttempts: true,
          generationError: true,
          recommendedAction: true,
          fallbackFromInvalid: true,
          modelVersion: true,
          confidence: true,
          reviewedById: true,
          reviewedAt: true,
          createdAt: true,
          updatedAt: true,
          household: { select: { id: true, name: true } },
          vendor: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
      }),
      getInsightStats(),
    ]);

    // Background coverage sweep — cooldown so list polling does not
    // amplify SQLite write pressure. The ops-events cron remains the
    // hard SLA backstop.
    if (Date.now() - lastSweepFiredAt > 10_000) {
      lastSweepFiredAt = Date.now();
      void sweepInsights().catch((e) => {
        console.warn("[ops/ai/insights GET] background sweep failed:", e);
      });
    }

    return NextResponse.json({ insights, stats });
  } catch (error) {
    console.error("[/api/ops/ai/insights GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/ops/ai/insights — generate (or regenerate) an insight
// for an anomaly (ai:prepare). Body: { anomalyId, force? }.
//
// The optional `simulateLlmResponse` field is the ADVERSARIAL TEST
// seam (mirrors /api/ops/ai/cases): it injects a raw LLM response so
// the live server can be proven to reject garbage — including
// execution-shaped action inventions. Requires BOTH ai:configure
// AND non-production, checked BEFORE any resource lookup.
// ─────────────────────────────────────────────────────────────

const generateSchema = z.object({
  anomalyId: z.string().min(1),
  force: z.boolean().optional(),
  simulateLlmResponse: z
    .union([z.string().max(4000), z.object({ simulatedError: z.enum(["timeout", "provider"]) })])
    .optional(),
});

export async function POST(request: NextRequest) {
  const guard = await requireAiPermission("prepare");
  if (!guard.ok) {
    return aiGuardErrorResponse(guard);
  }

  try {
    const parsed = generateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map((i) => i.message).join(", ") },
        { status: 400 }
      );
    }
    const { anomalyId, force, simulateLlmResponse } = parsed.data;

    // Adversarial-test seam permission FIRST (fail fast on authority
    // before any resource lookup — no existence information leaks).
    let simulate: string | { simulatedError: "timeout" | "provider" } | undefined;
    if (simulateLlmResponse !== undefined) {
      if (process.env.NODE_ENV === "production") {
        return NextResponse.json(
          { error: "LLM simulation is not available in production" },
          { status: 403 }
        );
      }
      const configureGuard = await requireAiPermission("configure");
      if (!configureGuard.ok) {
        return NextResponse.json(
          { error: "LLM simulation requires ai:configure (adversarial-test permission)" },
          { status: 403 }
        );
      }
      simulate = simulateLlmResponse;
    }

    const result = await ensureAnomalyInsight(anomalyId, {
      trigger: "manual",
      force: force ?? true,
      simulate,
    });

    const insight = result.insightId
      ? await db.aiInsight.findUnique({ where: { id: result.insightId } })
      : null;

    return NextResponse.json({ result, insight });
  } catch (error) {
    console.error("[/api/ops/ai/insights POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
