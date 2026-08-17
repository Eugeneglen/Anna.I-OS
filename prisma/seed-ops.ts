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
  await db.auditLog.deleteMany();
  await db.opsUser.deleteMany();

  const users = [
    { name: "Eugene", email: "eugene@annai.sg", role: "ADMIN" as const, passwordHash: DEFAULT_HASH },
    { name: "Ops Coordinator", email: "ops@annai.sg", role: "COORDINATOR" as const, passwordHash: DEFAULT_HASH },
    { name: "Analyst", email: "analyst@annai.sg", role: "ANALYST" as const, passwordHash: DEFAULT_HASH },
  ];

  for (const u of users) {
    // Look up the new Role record (seed-rbac.ts runs before this)
    const slug = ROLE_SLUG_MAP[u.role];
    const role = slug ? await db.role.findUnique({ where: { slug } }) : null;

    await db.opsUser.create({
      data: {
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
