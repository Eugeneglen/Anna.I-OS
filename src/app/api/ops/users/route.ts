import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getOpsSession } from "@/lib/ops-auth";
import { hasPermission, auditLog } from "@/lib/permissions";

// ──────────────────────────────────────────────────────────
// GET /api/ops/users — List users
// ──────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await hasPermission(session, "users", "view");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || undefined;
    const roleId = searchParams.get("roleId") || undefined;
    const activeParam = searchParams.get("active");
    const limit = Math.min(Number(searchParams.get("limit") || 50), 100);
    const cursor = searchParams.get("cursor") || undefined;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
      ];
    }
    if (roleId) {
      where.roleId = roleId;
    }
    if (activeParam !== null) {
      where.isActive = activeParam === "true";
    }

    const users = await db.opsUser.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        roleId: true,
        isActive: true,
        createdAt: true,
        lastLoginAt: true,
        roleRel: { select: { id: true, name: true, slug: true, level: true, isSystem: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = users.length > limit;
    if (hasMore) users.pop();
    const nextCursor = hasMore ? users[users.length - 1].id : null;

    return NextResponse.json({ users, nextCursor });
  } catch (error) {
    console.error("[/api/ops/users GET]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ──────────────────────────────────────────────────────────
// POST /api/ops/users — Create user
// ──────────────────────────────────────────────────────────
const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(12, "Password must be at least 12 characters"),
  roleId: z.string().min(1, "Role is required"),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getOpsSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await hasPermission(session, "users", "create");
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const { name, email, password, roleId } = parsed.data;

    // Check target role
    const targetRole = await db.role.findUnique({ where: { id: roleId } });
    if (!targetRole) {
      return NextResponse.json({ error: "Role not found" }, { status: 400 });
    }

    // Cannot create super_admin unless requester is super_admin
    if (targetRole.slug === "super_admin") {
      if (session.roleId) {
        const reqRole = await db.role.findUnique({ where: { id: session.roleId } });
        if (!reqRole || reqRole.slug !== "super_admin") {
          return NextResponse.json({ error: "Cannot assign super_admin role" }, { status: 403 });
        }
      } else if (session.role !== "ADMIN") {
        return NextResponse.json({ error: "Cannot assign super_admin role" }, { status: 403 });
      }
    }

    // Check email uniqueness
    const existing = await db.opsUser.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    const user = await db.opsUser.create({
      data: {
        name,
        email,
        passwordHash,
        roleId: targetRole.id,
        // Keep legacy role field in sync
        role: targetRole.slug === "super_admin"
          ? "ADMIN" as const
          : targetRole.slug === "operations"
            ? "ADMIN" as const
            : targetRole.slug === "coordinator"
              ? "COORDINATOR" as const
              : "ANALYST" as const,
      },
      select: {
        id: true, name: true, email: true, role: true, roleId: true,
        isActive: true, createdAt: true,
        roleRel: { select: { id: true, name: true, slug: true, level: true, isSystem: true } },
      },
    });

    await auditLog({
      userId: session.userId,
      userName: session.name,
      action: "user.create",
      entityType: "OpsUser",
      entityId: user.id,
      metadata: { name, email, roleId: targetRole.id, roleName: targetRole.name },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    console.error("[/api/ops/users POST]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
