import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission, auditLog } from "@/lib/permissions";

// ──────────────────────────────────────────────────────────
// POST /api/ops/users/[id]/deactivate
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

    const allowed = await hasPermission(session, "users", "delete");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    // Cannot deactivate self
    if (id === session.userId) {
      return NextResponse.json(
        { error: "Cannot deactivate yourself" },
        { status: 403 }
      );
    }

    const target = await db.opsUser.findUnique({
      where: { id },
      include: { roleRel: true },
    });
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!target.isActive) {
      return NextResponse.json({ error: "User is already deactivated" }, { status: 400 });
    }

    // Must keep at least 1 active super_admin
    if (target.roleRel?.slug === "super_admin") {
      const activeSuperAdmins = await db.opsUser.count({
        where: {
          isActive: true,
          roleRel: { slug: "super_admin" },
        },
      });
      if (activeSuperAdmins <= 1) {
        return NextResponse.json(
          { error: "Cannot deactivate the last active super_admin" },
          { status: 403 }
        );
      }
    }

    await db.opsUser.update({
      where: { id },
      data: { isActive: false, updatedBy: session.userId },
    });

    await auditLog({
      userId: session.userId,
      userName: session.name,
      action: "user.deactivate",
      entityType: "OpsUser",
      entityId: id,
      metadata: { targetName: target.name, targetEmail: target.email },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/ops/users/[id]/deactivate POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
