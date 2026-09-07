import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { getHouseholdSession } from "@/lib/household-auth";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";
import { logAction } from "@/lib/audit-log";

const patchSchema = z.object({
  status: z.enum(["ACKNOWLEDGED", "RESOLVED", "DISMISSED"]),
});

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // FIX-1a: previously fully unauthenticated. The household portal's
    // anomaly banner acknowledges/dismisses its OWN anomalies; ops may act
    // on any anomaly (with anomalies:edit).
    const [hhSession, opsSession] = await Promise.all([
      getHouseholdSession(),
      getOpsSession(),
    ]);
    if (!hhSession && !opsSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (opsSession) {
      const allowed = await hasPermission(opsSession, "anomalies", "edit");
      if (!allowed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const body = await _request.json();
    const parsed = patchSchema.parse(body);

    const anomaly = await db.anomaly.findUnique({ where: { id } });
    if (!anomaly) {
      return NextResponse.json({ error: "Anomaly not found" }, { status: 404 });
    }

    if (hhSession && !opsSession && anomaly.householdId !== hhSession.householdId) {
      return NextResponse.json(
        { error: "Forbidden — this anomaly belongs to another household" },
        { status: 403 }
      );
    }

    const updateData: Record<string, unknown> = { status: parsed.status };
    if (parsed.status === "ACKNOWLEDGED") updateData.acknowledgedAt = new Date();
    if (parsed.status === "RESOLVED") updateData.resolvedAt = new Date();

    const updated = await db.anomaly.update({
      where: { id },
      data: updateData,
    });

    // FIX-1a audit coverage: anomaly status changes were previously
    // invisible in the audit trail.
    await logAction({
      ...(opsSession ? { userId: opsSession.userId } : {}),
      userName: opsSession
        ? opsSession.name
        : `${hhSession?.memberName} (household)`,
      action: "anomaly.update",
      entityType: "Anomaly",
      entityId: id,
      metadata: { status: parsed.status },
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
