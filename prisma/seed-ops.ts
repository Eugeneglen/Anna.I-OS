import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const db = new PrismaClient();
const SALT_ROUNDS = 10;
const DEFAULT_HASH = bcrypt.hashSync("anna1234", SALT_ROUNDS);

export async function main() {
  await db.auditLog.deleteMany();
  await db.opsUser.deleteMany();

  const users = [
    { name: "Eugene", email: "eugene@annai.sg", role: "ADMIN" as const, passwordHash: DEFAULT_HASH },
    { name: "Ops Coordinator", email: "ops@annai.sg", role: "COORDINATOR" as const, passwordHash: DEFAULT_HASH },
    { name: "Analyst", email: "analyst@annai.sg", role: "ANALYST" as const, passwordHash: DEFAULT_HASH },
  ];

  for (const u of users) {
    await db.opsUser.create({ data: u });
    console.log(`  ${u.name} (${u.role}) — ${u.email}`);
  }
  console.log(`\n  ${users.length} ops users seeded`);
}

if (require.main === module) {
  main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => db.$disconnect());
}