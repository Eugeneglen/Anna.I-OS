import { NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops-auth";
import {
  scanForPromotions,
  executePromotions,
  type PromotionCandidate,
} from "@/lib/promotion-engine";
import { z } from "zod";

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

  try {
    const body = await request.json();

    // --- SCAN ---
    const scanParse = scanSchema.safeParse(body);
    if (scanParse.success) {
      const candidates = await scanForPromotions();
      return NextResponse.json({ candidates });
    }

    // --- EXECUTE ---
    const execParse = executeSchema.safeParse(body);
    if (execParse.success) {
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
