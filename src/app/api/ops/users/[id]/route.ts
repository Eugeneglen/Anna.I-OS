import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission, auditLog } from "@/lib/permissions";

// ──────────────────────────────────────────────────────────
// PATCH /api/ops/users/[id] — Update user
// ──────────────────────────────────────────────────────────
const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  roleId: z.string().min(1).optional(),
});

export async function PATCH(
  req: NextRequest,
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
    const body = await req.json();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const target = await db.opsUser.findUnique({
      where: { id },
      include: { roleRel: true },
    });
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Cannot change own role (prevent self-escalation)
    if (parsed.data.roleId && id === session.userId) {
      return NextResponse.json(
        { error: "Cannot change your own role" },
        { status: 403 }
      );
    }

    // If changing role, check level constraint
    if (parsed.data.roleId) {
      const targetRole = await db.role.findUnique({
        where: { id: parsed.data.roleId },
      });
      if (!targetRole) {
        return NextResponse.json({ error: "Role not found" }, { status: 400 });
      }

      // Ops users must NOT be assigned vendor-domain roles (vendor_* slugs).
      if (targetRole.slug.startsWith("vendor_")) {
        return NextResponse.json(
          { error: "Cannot assign a vendor role to an ops user" },
          { status: 400 }
        );
      }

      // Get requester's role level
      let reqLevel = 0;
      if (session.roleId) {
        const reqRole = await db.role.findUnique({ where: { id: session.roleId } });
        reqLevel = reqRole?.level ?? 0;
      } else {
        // Legacy fallback
        const legacyLevels: Record<string, number> = { ADMIN: 3, COORDINATOR: 2, ANALYST: 1 };
        reqLevel = legacyLevels[session.role] || 0;
      }

      if (targetRole.level > reqLevel) {
        return NextResponse.json(
          { error: "Cannot assign role with higher level than your own" },
          { status: 403 }
        );
      }
    }

    // Check email uniqueness if changing
    if (parsed.data.email && parsed.data.email !== target.email) {
      const existing = await db.opsUser.findUnique({ where: { email: parsed.data.email } });
      if (existing) {
        return NextResponse.json({ error: "Email already exists" }, { status: 409 });
      }
    }

    const updateData: Record<string, unknown> = { updatedBy: session.userId };
    if (parsed.data.name) updateData.name = parsed.data.name;
    if (parsed.data.email) updateData.email = parsed.data.email;
    if (parsed.data.roleId) {
      updateData.roleId = parsed.data.roleId;
      const targetRole = await db.role.findUnique({ where: { id: parsed.data.roleId } });
      if (targetRole) {
        updateData.role = targetRole.slug === "super_admin"
          ? "ADMIN"
          : targetRole.slug === "operations"
            ? "ADMIN"
            : targetRole.slug === "coordinator"
              ? "COORDINATOR"
              : "ANALYST";
      }
    }

    const updated = await db.opsUser.update({
      where: { id },
      data: updateData,
      select: {
        id: true, name: true, email: true, role: true, roleId: true,
        isActive: true, createdAt: true, lastLoginAt: true,
        roleRel: { select: { id: true, name: true, slug: true, level: true, isSystem: true } },
      },
    });

    await auditLog({
      userId: session.userId,
      userName: session.name,
      action: "user.update",
      entityType: "OpsUser",
      entityId: id,
      metadata: { changes: parsed.data },
    });

    return NextResponse.json({ user: updated });
  } catch (error) {
    console.error("[/api/ops/users/[id] PATCH]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ──────────────────────────────────────────────────────────
// DELETE /api/ops/users/[id] — Permanently delete a user
// Only allowed for already-deactivated users (soft-delete-first pattern).
// ──────────────────────────────────────────────────────────
export async function DELETE(
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

    // Self-deletion guard
    if (id === session.userId) {
      return NextResponse.json(
        { error: "You cannot delete your own account." },
        { status: 403 }
      );
    }

    const target = await db.opsUser.findUnique({ where: { id } });
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Safety: only allow deleting deactivated users
    if (target.isActive) {
      return NextResponse.json(
        { error: "Deactivate the user first before deleting." },
        { status: 409 }
      );
    }

    await db.opsUser.delete({ where: { id } });

    await auditLog({
      userId: session.userId,
      userName: session.name,
      action: "user.delete",
      entityType: "OpsUser",
      entityId: id,
      metadata: { name: target.name, email: target.email },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[/api/ops/users/[id] DELETE]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
