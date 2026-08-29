import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { generateSingleCode, generateBulkCodes } from "@/lib/marketing/campaign-service";

// GET — list codes for a campaign
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const allowed = await hasPermission(session, "marketing", "view");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const { db } = await import("@/lib/db");

    const codes = await db.discountCode.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ codes });
  } catch (error) {
    console.error("[/api/ops/campaigns/[id]/codes GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

const generateSchema = z.object({
  mode: z.enum(["single", "bulk"]),
  // Single
  code: z.string().optional(),
  // Bulk
  quantity: z.number().int().min(1).max(10000).optional(),
  prefix: z.string().optional(),
  codeLength: z.number().int().min(4).max(20).optional(),
  // Shared
  maxUses: z.number().int().positive().optional(),
  expiresAt: z.string().optional(),
}).refine(
  (data) => data.mode === "single" || (data.mode === "bulk" && data.quantity),
  { message: "quantity is required for bulk mode" }
);

// POST — generate codes
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getOpsSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const allowed = await hasPermission(session, "marketing", "create");
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;
    const body = await req.json();
    const parsed = generateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    if (parsed.data.mode === "single") {
      const code = await generateSingleCode(id, {
        code: parsed.data.code,
        maxUses: parsed.data.maxUses,
        expiresAt: parsed.data.expiresAt,
      });
      return NextResponse.json({ code }, { status: 201 });
    } else {
      const result = await generateBulkCodes(id, {
        quantity: parsed.data.quantity!,
        prefix: parsed.data.prefix,
        codeLength: parsed.data.codeLength,
        maxUses: parsed.data.maxUses,
        expiresAt: parsed.data.expiresAt,
      });
      return NextResponse.json(result, { status: 201 });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    console.error("[/api/ops/campaigns/[id]/codes POST]", error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
