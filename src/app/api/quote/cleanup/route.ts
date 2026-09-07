import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getHouseholdSession } from "@/lib/household-auth";
import { getOpsSession } from "@/lib/ops-auth";
import { isCronRequest } from "@/lib/cron-auth";

const cleanupSchema = z.object({
  quotationId: z.string().min(1),
});

// POST /api/quote/cleanup
// Best-effort cleanup of orphaned DRAFT quotations when task creation fails
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = cleanupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid quotationId" }, { status: 400 });
    }

    // FIX-1a: previously fully unauthenticated (anyone could probe/delete
    // orphaned draft quotes). Now accepts the household session that owns
    // the quotation (the booking form cleans up its own failed quote), an
    // ops session, or the internal cron service via timing-safe
    // `x-cron-secret` (same convention as dispatch-expiry).
    let authorised = false;
    if (isCronRequest(request.headers)) {
      authorised = true;
    } else {
      const [hhSession, opsSession] = await Promise.all([
        getHouseholdSession(),
        getOpsSession(),
      ]);
      if (opsSession) {
        authorised = true;
      } else if (hhSession) {
        // Household may only clean up its OWN quotation. An unknown
        // quotation id is treated as "nothing to clean" (deleted: 0) —
        // same contract as the original route — while a quotation owned
        // by another household is a hard 403.
        const owned = await db.quotation.findUnique({
          where: { id: parsed.data.quotationId },
          select: { householdId: true },
        });
        if (owned && owned.householdId !== hhSession.householdId) {
          return NextResponse.json(
            { error: "Forbidden — you can only clean up your own quotations" },
            { status: 403 }
          );
        }
        authorised = true;
      }
    }

    if (!authorised) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { quotationId } = parsed.data;

    // Only delete DRAFT quotations that have no linked task
    // (FIX-1a note: `taskId` is not a selectable Prisma field — the FK is
    // exposed through the `task` relation; selecting the scalar threw
    // PrismaClientValidationError → this route always 500'd.)
    const quotation = await db.quotation.findUnique({
      where: { id: quotationId },
      select: { id: true, status: true, task: { select: { id: true } } },
    });

    if (!quotation) {
      return NextResponse.json({ deleted: 0 });
    }

    if (quotation.status === "DRAFT" && !quotation.task) {
      await db.quotation.delete({ where: { id: quotationId } });
      return NextResponse.json({ deleted: 1 });
    }

    // Not a draft or already linked — don't delete
    return NextResponse.json({ deleted: 0 });
  } catch (error) {
    console.error("POST /api/quote/cleanup error:", error);
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}