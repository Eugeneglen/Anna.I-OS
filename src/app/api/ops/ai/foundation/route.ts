import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getZAI } from "@/lib/zai";
import { requireAiPermission, aiGuardErrorResponse } from "@/lib/ai-guards";

// GET /api/ops/ai/foundation
//
// L4 AI governance foundation status — a server-side introspection
// endpoint, NOT a dashboard. This is the enforcement surface for the
// ai:configure permission (Phase 1 · Step 1.1) and the verification
// point for the acceptance matrix:
//
//   unauthenticated → 401 · ops session without ai:configure → 403 ·
//   authorised role → 200
//
// Returns:
//   aiPermissions  — the four ai:* permissions and their seeded roles
//   availability    — whether the z-ai SDK is configured
//   foundationTables — row counts for the L4 foundation models
//   auditChain      — counts of the AI audit-chain events recorded so far

export async function GET() {
  try {
    const guard = await requireAiPermission("configure");
    if (!guard.ok) {
      return aiGuardErrorResponse(guard);
    }

    const [aiPerms, zai, conversations, caseBriefs, insights, photoVerifications, aiAuditRows] =
      await Promise.all([
        db.permission.findMany({
          where: { module: "ai" },
          orderBy: { action: "asc" },
          select: { id: true, action: true, description: true },
        }),
        getZAI(),
        db.conversation.count(),
        db.aiCaseBrief.count(),
        db.aiInsight.count(),
        db.photoVerification.count(),
        db.auditLog.count({
          where: { metadata: { path: "ai", equals: true } },
        }),
      ]);

    // Resolve which roles hold each ai:* permission (reads RolePermission —
    // the EXISTING permission system, no parallel store).
    const rolePermissions = await db.rolePermission.findMany({
      where: { permission: { module: "ai" } },
      select: {
        permission: { select: { action: true } },
        role: { select: { slug: true, name: true, level: true } },
      },
    });
    rolePermissions.sort(
      (a, b) =>
        a.role.level - b.role.level ||
        a.permission.action.localeCompare(b.permission.action)
    );

    const rolesByAction: Record<string, string[]> = {};
    for (const rp of rolePermissions) {
      const key = rp.permission.action;
      rolesByAction[key] = rolesByAction[key] ?? [];
      rolesByAction[key].push(rp.role.slug);
    }

    return NextResponse.json({
      phase: "L4 · Phase 1 · Step 1.1 — AI governance foundation",
      aiPermissions: aiPerms.map((p) => ({
        permission: `ai:${p.action}`,
        description: p.description,
        roles: rolesByAction[p.action] ?? [],
      })),
      availability: { zaiConfigured: !!zai },
      foundationTables: {
        conversations,
        aiCaseBriefs: caseBriefs,
        aiInsights: insights,
        photoVerifications,
      },
      auditChain: { aiAuditEvents: aiAuditRows },
    });
  } catch (error) {
    console.error("GET /api/ops/ai/foundation error:", error);
    return NextResponse.json(
      { error: "Failed to read AI foundation status" },
      { status: 500 }
    );
  }
}
