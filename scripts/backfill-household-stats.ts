/**
 * Backfill Household cached stats (lastOrderAt, totalOrders, totalSpentCents).
 * Idempotent — safe to run multiple times.
 *
 * Usage: npx tsx scripts/backfill-household-stats.ts
 */
import { db } from "../src/lib/db";

async function main() {
  console.log("🔄 Backfilling Household cached stats...\n");

  const households = await db.household.findMany({
    select: { id: true, name: true },
  });

  if (households.length === 0) {
    console.log("✅ No households found.");
    return;
  }

  console.log(`Found ${households.length} households.\n`);

  let updated = 0;
  for (const hh of households) {
    const tasks = await db.task.findMany({
      where: {
        householdId: hh.id,
        status: { in: ["COMPLETED", "VERIFIED", "ESCROW_RELEASED"] },
      },
      select: { finalAmountCents: true, amountCents: true, completedAt: true, verifiedAt: true },
      orderBy: { completedAt: "desc" },
    });

    const totalOrders = tasks.length;
    const totalSpentCents = tasks.reduce((s, t) => s + (t.finalAmountCents || t.amountCents || 0), 0);
    const lastOrderAt = tasks[0]?.completedAt || tasks[0]?.verifiedAt || null;

    await db.household.update({
      where: { id: hh.id },
      data: {
        totalOrders,
        totalSpentCents,
        lastOrderAt: lastOrderAt ? new Date(lastOrderAt) : null,
      },
    });

    console.log(`  ✅ ${hh.name}: ${totalOrders} orders, $${(totalSpentCents / 100).toFixed(2)} spent, last: ${lastOrderAt ? new Date(lastOrderAt).toISOString().slice(0, 10) : "never"}`);
    updated++;
  }

  console.log(`\n✅ Backfilled ${updated} households.`);
}

main()
  .catch((e) => { console.error("❌ Backfill failed:", e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
