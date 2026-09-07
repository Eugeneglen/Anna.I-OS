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

    const target = await db.opsUser.findUnique({
      where: { id },
      include: { roleRel: { select: { slug: true, level: true } } },
    });
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // ── P1 (AUDIT-4): tier check — a non-super-admin must never be able to
    //    reset the password of a user at or above their own tier. Previously
    //    ANY holder of users:edit (e.g. Operations, level 3) could reset a
    //    super_admin's (level 4) password and receive the plaintext new
    //    password in the response — full account takeover of the top tier.
    //    With this rule, the plaintext password is only ever returned to an
    //    actor strictly above the target's tier (or a super_admin), so it can
    //    no longer leak "downwards". ──
    const LEGACY_LEVELS: Record<string, number> = { ADMIN: 3, COORDINATOR: 2, ANALYST: 1 };
    const reqLevel = session.roleId
      ? (await db.role.findUnique({ where: { id: session.roleId }, select: { level: true } }))?.level ?? 0
      : LEGACY_LEVELS[session.role] ?? 0;
    const targetLevel = target.roleRel?.level ?? LEGACY_LEVELS[target.role] ?? 0;
    const reqIsSuperAdmin = session.roleId
      ? (await db.role.findUnique({ where: { id: session.roleId }, select: { slug: true } }))?.slug === "super_admin"
      : session.role === "ADMIN";

    if (!reqIsSuperAdmin && targetLevel >= reqLevel) {
      await auditLog({
        userId: session.userId,
        userName: session.name,
        action: "user.reset_password.denied",
        entityType: "OpsUser",
        entityId: id,
        metadata: {
          targetName: target.name,
          targetEmail: target.email,
          reason: "tier_check",
          requesterLevel: reqLevel,
          targetLevel,
        },
      });
      return NextResponse.json(
        {
          error:
            "Forbidden — you cannot reset the password of a user at or above your own tier (super_admin excepted)",
        },
        { status: 403 }
      );
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
      metadata: {
        targetName: target.name,
        targetEmail: target.email,
        // P1: record the tier context of the reset for audit review
        requesterLevel: reqLevel,
        requesterIsSuperAdmin: reqIsSuperAdmin,
        targetLevel,
        targetRoleSlug: target.roleRel?.slug ?? null,
      },
    });

    // The new password is only reachable here by an actor strictly above the
    // target's tier (or a super_admin) — see the P1 tier check above. Lower
    // tiers are rejected before the password is ever generated.
    return NextResponse.json({ success: true, password: newPassword });
  } catch (error) {
    console.error("[/api/ops/users/[id]/reset-password POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
