import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission } from "@/lib/permissions";

// GET /api/ops/users/[id]/audit-log — returns audit entries for a specific user
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await hasPermission(session, "users", "view");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    // Get audit entries where:
    // - this user was the actor (userId = id), OR
    // - this user was the entity (entityType = "OpsUser" AND entityId = id)
    const entries = await db.auditLog.findMany({
      where: {
        OR: [
          { userId: id },
          { entityType: "OpsUser", entityId: id },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({ entries });
  } catch (error) {
    console.error("[/api/ops/users/[id]/audit-log GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
