import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;
const DEFAULT_PASSWORD = "anna1234";

/**
 * POST /api/ops/ensure-users
 *
 * Self-healing endpoint: if OpsUser table is empty (e.g. seed failed on Railway),
 * creates the 3 default ops users. Safe to call multiple times — skips if users
 * already exist.
 *
 * Also callable as GET for checking only (no mutations).
 */
const DEFAULT_OPS_USERS = [
  { name: "Eugene", email: "eugene@annai.sg", role: "ADMIN" as const },
  { name: "Ops Coordinator", email: "ops@annai.sg", role: "COORDINATOR" as const },
  { name: "Analyst", email: "analyst@annai.sg", role: "ANALYST" as const },
];

async function seedOpsUsers() {
  const existing = await db.opsUser.count();
  if (existing > 0) {
    return { created: false, existing };
  }

  const hash = bcrypt.hashSync(DEFAULT_PASSWORD, SALT_ROUNDS);

  for (const u of DEFAULT_OPS_USERS) {
    await db.opsUser.upsert({
      where: { email: u.email },
      update: {},
      create: {
        name: u.name,
        email: u.email,
        role: u.role,
        passwordHash: hash,
      },
    });
  }

  return { created: true, count: DEFAULT_OPS_USERS.length };
}

export async function POST() {
  try {
    const result = await seedOpsUsers();
    return NextResponse.json({
      success: true,
      message: result.created
        ? `Created ${result.count} ops users`
        : `Ops users already exist (${result.existing})`,
      ...result,
    });
  } catch (error) {
    console.error("[/api/ops/ensure-users POST]", error);
    return NextResponse.json(
      { success: false, error: "Failed to ensure ops users" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const count = await db.opsUser.count();
    const users = await db.opsUser.findMany({
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    return NextResponse.json({ count, users });
  } catch (error) {
    console.error("[/api/ops/ensure-users GET]", error);
    return NextResponse.json(
      { error: "Failed to check ops users" },
      { status: 500 }
    );
  }
}
