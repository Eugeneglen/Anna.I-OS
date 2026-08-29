import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission, auditLog } from "@/lib/permissions";

// ──────────────────────────────────────────────────────────
// POST /api/ops/users/[id]/reactivate
// ──────────────────────────────────────────────────────────
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await hasPermission(session, "users", "edit");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const target = await db.opsUser.findUnique({ where: { id } });
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (target.isActive) {
      return NextResponse.json(
        { error: "User is already active" },
        { status: 400 }
      );
    }

    await db.opsUser.update({
      where: { id },
      data: { isActive: true, updatedBy: session.userId },
    });

    await auditLog({
      userId: session.userId,
      userName: session.name,
      action: "user.reactivate",
      entityType: "OpsUser",
      entityId: id,
      metadata: { targetName: target.name, targetEmail: target.email },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/ops/users/[id]/reactivate POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
