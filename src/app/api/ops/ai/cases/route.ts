import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { AiBriefStatus } from "@prisma/client";
import { requireAiPermission, aiGuardErrorResponse } from "@/lib/ai-guards";
import { ensureDisputeCaseBrief, sweepBriefs } from "@/lib/ai-dispute/brief-service";

// ─────────────────────────────────────────────────────────────
// GET /api/ops/ai/cases — list dispute case briefs (ai:prepare).
//
// The list view also fires the coverage sweep in the background
// (§8): any qualifying dispute that somehow has no brief gets
// one generated. Non-blocking — the list returns immediately.
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
    const taskId = sp.get("taskId") || "";
    const limit = Math.min(parseInt(sp.get("limit") || "50", 10) || 50, 100);

    const where: Record<string, unknown> = { caseType: "DISPUTE" };
    if (status && Object.values(AiBriefStatus).includes(status as AiBriefStatus)) {
      where.status = status;
    }
    if (taskId) where.entityId = taskId;

    const briefs = await db.aiCaseBrief.findMany({
      where: where as never,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        caseType: true,
        entityType: true,
        entityId: true,
        householdId: true,
        escrowId: true,
        vendorId: true,
        aiChainId: true,
        status: true,
        generationStatus: true,
        generationAttempts: true,
        generationError: true,
        summary: true,
        recommendation: true,
        recommendedAmountCents: true,
        fallbackFromInvalid: true,
        rationale: true,
        confidence: true,
        contextSnapshot: true,
        eligibleActions: true,
        financialImpact: true,
        reviewedById: true,
        reviewedAt: true,
        decisionNote: true,
        decisionKind: true,
        decisionAction: true,
        decisionLatencyMs: true,
        executionResult: true,
        createdAt: true,
        updatedAt: true,
        household: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
      },
    });

    // Background coverage sweep — fire and forget, with a cooldown so list
    // polling (every ~2s from the UI/tests) does not amplify SQLite write
    // pressure. The 60s ops-events cron remains the hard SLA backstop.
    if (Date.now() - lastSweepFiredAt > 10_000) {
      lastSweepFiredAt = Date.now();
      void sweepBriefs().catch((e) => {
        console.warn("[ops/ai/cases GET] background sweep failed:", e);
      });
    }

    return NextResponse.json({ briefs });
  } catch (error) {
    console.error("[/api/ops/ai/cases GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/ops/ai/cases — generate (or regenerate) a brief for
// a task (ai:prepare). Body: { taskId, force? }.
//
// The optional `simulateLlmResponse` field is the ADVERSARIAL
// TEST seam (§9): it injects a raw LLM response so the live
// server can be proven to reject garbage. It requires BOTH
// ai:configure AND a non-production NODE_ENV, and the resulting
// brief records fallbackFromInvalid for the audit chain.
// ─────────────────────────────────────────────────────────────

const generateSchema = z.object({
  taskId: z.string().min(1),
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
    const { taskId, force, simulateLlmResponse } = parsed.data;

    // ── Adversarial-test seam permission FIRST (fail fast on authority
    // before any resource lookup — no existence information leaks). ──
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

    // The task must exist — but identity/scope for generation comes ONLY
    // from the server-side task lookup, never from client hints.
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: { id: true, householdId: true, status: true },
    });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const result = await ensureDisputeCaseBrief(taskId, {
      trigger: "manual",
      force: force ?? true,
      simulate,
    });

    const brief = result.briefId
      ? await db.aiCaseBrief.findUnique({ where: { id: result.briefId } })
      : null;

    return NextResponse.json({ result, brief });
  } catch (error) {
    console.error("[/api/ops/ai/cases POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
