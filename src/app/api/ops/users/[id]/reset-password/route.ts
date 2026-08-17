import { NextRequest, NextResponse } from "next/server";
import * as bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission, auditLog } from "@/lib/permissions";

// ──────────────────────────────────────────────────────────
// POST /api/ops/users/[id]/reset-password
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

    // Generate random 16-char password
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*";
    const newPassword = Array.from({ length: 16 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");

    const passwordHash = bcrypt.hashSync(newPassword, 10);

    await db.opsUser.update({
      where: { id },
      data: { passwordHash, updatedBy: session.userId },
    });

    await auditLog({
      userId: session.userId,
      userName: session.name,
      action: "user.reset_password",
      entityType: "OpsUser",
      entityId: id,
      metadata: { targetName: target.name, targetEmail: target.email },
    });

    return NextResponse.json({ success: true, password: newPassword });
  } catch (error) {
    console.error("[/api/ops/users/[id]/reset-password POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
