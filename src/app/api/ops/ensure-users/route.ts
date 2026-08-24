import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import * as bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;
const DEFAULT_PASSWORD = "anna1234";

/**
 * POST /api/ops/ensure-users
 *
 * Self-healing endpoint: if OpsUser table is empty (e.g. seed failed on
 * Railway), creates the 3 default ops users. Safe to call multiple times —
 * skips if users already exist.
 *
 * SECURITY: This endpoint MUST remain callable without authentication —
 * its purpose is to recover from an empty OpsUser table, where no
 * authenticated user exists to call it. To avoid information disclosure,
 * the response does NOT reveal how many users exist (only whether any
 * were created). The GET variant (which listed all users) is removed.
 */
const DEFAULT_OPS_USERS = [
  { name: "Eugene", email: "eugene@annai.sg", role: "ADMIN" as const },
  { name: "Ops Coordinator", email: "ops@annai.sg", role: "COORDINATOR" as const },
  { name: "Analyst", email: "analyst@annai.sg", role: "ANALYST" as const },
];

async function seedOpsUsers() {
  // Use a count > 0 check (not the exact count) so we don't disclose how
  // many ops users exist to an unauthenticated caller.
  const any = await db.opsUser.count();
  if (any > 0) {
    return { created: false };
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
      // `created` is a boolean (not a count) — safe to return. The login
      // page's auto-repair flow checks this to show the right toast.
      created: result.created,
      message: result.created
        ? `Created ${result.count} ops users`
        : "Ops users already exist",
    });
  } catch (error) {
    console.error("[/api/ops/ensure-users POST]", error);
    return NextResponse.json(
      { success: false, error: "Failed to ensure ops users" },
      { status: 500 }
    );
  }
}

// GET removed — it previously listed all ops user emails + roles to
// unauthenticated callers (information disclosure + recon aid).
// If a health check is needed in future, gate it behind an authenticated
// super_admin session.
