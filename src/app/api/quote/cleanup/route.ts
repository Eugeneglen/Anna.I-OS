import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const cleanupSchema = z.object({
  quotationId: z.string().min(1),
});

// POST /api/quote/cleanup
// Best-effort cleanup of orphaned DRAFT quotations when task creation fails
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = cleanupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid quotationId" }, { status: 400 });
    }

    const { quotationId } = parsed.data;

    // Only delete DRAFT quotations that have no linked task
    const quotation = await db.quotation.findUnique({
      where: { id: quotationId },
      select: { id: true, status: true, taskId: true },
    });

    if (!quotation) {
      return NextResponse.json({ deleted: 0 });
    }

    if (quotation.status === "DRAFT" && !quotation.taskId) {
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