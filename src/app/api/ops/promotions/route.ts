import { NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import {
  scanForPromotions,
  executePromotions,
  type PromotionCandidate,
} from "@/lib/promotion-engine";
import { z } from "zod";
import { checkRateLimit, opsRateKey, rateLimitResponsePayload } from "@/lib/rate-limit";

const scanSchema = z.object({ action: z.literal("scan") });

const executeSchema = z.object({
  action: z.literal("execute"),
  candidates: z.array(
    z.object({
      householdId: z.string(),
      householdName: z.string(),
      category: z.string(),
      currentLevel: z.number(),
      currentLevelName: z.string(),
      newLevel: z.number(),
      newLevelName: z.string(),
      verifiedCyclesAtLevel: z.number(),
      cyclesRequired: z.number(),
    })
  ),
});

export async function POST(request: Request) {
  // Ops auth required
  const session = await getOpsSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── P5 (AUDIT-4): was session-only. The promotion engine walks every
  // household and EXECUTE mutates marketing state platform-wide — both
  // branches are now permission-gated instead of "any ops login":
  //   scan    → marketing:view
  //   execute → marketing:create
  // (coordinator / operations / super_admin hold both; data_analyst,
  // which is read-only, holds neither and is denied.)
  const scanAllowed = await hasPermission(session, "marketing", "view");
  const execAllowed = await hasPermission(session, "marketing", "create");

  // ── F8: promotion scans walk every household — 10/min max ──
  const rlKey = opsRateKey(session.userId, "promotions");
  if (!checkRateLimit(rlKey, 10, 60_000)) {
    return NextResponse.json(rateLimitResponsePayload(rlKey), { status: 429 });
  }

  try {
    const body = await request.json();

    // --- SCAN ---
    const scanParse = scanSchema.safeParse(body);
    if (scanParse.success) {
      if (!scanAllowed) {
        return NextResponse.json({ error: "Forbidden — requires marketing:view" }, { status: 403 });
      }
      const candidates = await scanForPromotions();
      return NextResponse.json({ candidates });
    }

    // --- EXECUTE ---
    const execParse = executeSchema.safeParse(body);
    if (execParse.success) {
      if (!execAllowed) {
        return NextResponse.json({ error: "Forbidden — requires marketing:create" }, { status: 403 });
      }
      const results = await executePromotions(execParse.data.candidates);
      const promoted = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;
      return NextResponse.json({ results, promoted, failed });
    }

    return NextResponse.json(
      { error: "Invalid action. Use { action: 'scan' } or { action: 'execute', candidates: [...] }" },
      { status: 400 }
    );
  } catch (error) {
    console.error("POST /api/ops/promotions error:", error);
    return NextResponse.json(
      { error: "Promotion engine error" },
      { status: 500 }
    );
  }
}
