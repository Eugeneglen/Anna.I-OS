import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";

const patchSchema = z.object({
  status: z.enum(["ACKNOWLEDGED", "RESOLVED", "DISMISSED"]),
});

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await _request.json();
    const parsed = patchSchema.parse(body);

    const anomaly = await db.anomaly.findUnique({ where: { id } });
    if (!anomaly) {
      return NextResponse.json({ error: "Anomaly not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = { status: parsed.status };
    if (parsed.status === "ACKNOWLEDGED") updateData.acknowledgedAt = new Date();
    if (parsed.status === "RESOLVED") updateData.resolvedAt = new Date();

    const updated = await db.anomaly.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({ anomaly: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", details: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    console.error("PATCH /api/anomalies/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update anomaly" },
      { status: 500 }
    );
  }
}