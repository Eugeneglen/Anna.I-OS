import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const r = await db.voucher.updateMany({
    where: { issuedFromEscrowId: { not: null } },
    data: { origin: "SERVICE_RECOVERY" },
  });
  const counts = await db.voucher.groupBy({ by: ["origin"], _count: { _all: true } });
  console.log("backfilled:", r.count, JSON.stringify(counts));
}
main().finally(() => db.$disconnect());
