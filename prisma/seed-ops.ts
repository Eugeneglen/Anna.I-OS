import { db } from './seed-db'
import * as bcrypt from "bcryptjs";
const SALT_ROUNDS = 10;
const DEFAULT_HASH = bcrypt.hashSync("anna1234", SALT_ROUNDS);

/** Map legacy OpsRole enum → new Role slug (created by seed-rbac.ts) */
const ROLE_SLUG_MAP: Record<string, string> = {
  ADMIN: "super_admin",
  COORDINATOR: "coordinator",
  ANALYST: "data_analyst",
};

export async function main() {
  // ── P8 (AUDIT-4): non-destructive by default.
  //
  // Previously this seed unconditionally ran:
  //   await db.auditLog.deleteMany();
  //   await db.opsUser.deleteMany();
  // …wiping the ENTIRE ops user table (including users created via User
  // Management) and the full audit log on every re-run. On a fresh
  // database the upserts below produce the exact same end state as the
  // destructive version, so CI/dev bootstrap is unchanged — but a re-run
  // against a live database now only (re)ensures the three demo users,
  // preserving every other account, its password, and the audit trail.
  //
  // The old reset behaviour is available explicitly via SEED_RESET=1
  // (used only when you genuinely want to wipe ops users + audit logs).
  if (process.env.SEED_RESET === "1") {
    console.log("  SEED_RESET=1 — wiping ops users + audit logs (destructive)");
    await db.auditLog.deleteMany();
    await db.opsUser.deleteMany();
  } else {
    console.log("  Non-destructive mode (SEED_RESET=1 enables full reset)");
  }

  const users = [
    { name: "Eugene", email: "eugene@annai.sg", role: "ADMIN" as const, passwordHash: DEFAULT_HASH },
    { name: "Ops Coordinator", email: "ops@annai.sg", role: "COORDINATOR" as const, passwordHash: DEFAULT_HASH },
    { name: "Analyst", email: "analyst@annai.sg", role: "ANALYST" as const, passwordHash: DEFAULT_HASH },
  ];

  for (const u of users) {
    // Look up the new Role record (seed-rbac.ts runs before this)
    const slug = ROLE_SLUG_MAP[u.role];
    const role = slug ? await db.role.findUnique({ where: { slug } }) : null;

    // Upsert by email: create with the demo password on a fresh database;
    // on re-run, keep the EXISTING passwordHash (a dev may have changed it)
    // and only re-sync name/role/roleId.
    await db.opsUser.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        roleId: role?.id ?? null,
      },
      create: {
        name: u.name,
        email: u.email,
        role: u.role,
        passwordHash: u.passwordHash,
        roleId: role?.id,     // Attach RBAC role if available
      },
    });
    console.log(`  ${u.name} (${u.role}${role ? ` → ${role.slug}` : ""}) — ${u.email}`);
  }
  console.log(`\n  ${users.length} ops users seeded`);
}

if (require.main === module) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => db.$disconnect?.());
}
