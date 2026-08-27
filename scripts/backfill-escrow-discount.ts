/**
 * Backfill EscrowLedger entries with discount info from their associated Tasks.
 *
 * For each existing EscrowLedger row:
 * - If the associated Task has discountCents > 0:
 *   - Set escrow.originalAmountCents = task.amountCents (pre-discount)
 *   - Set escrow.discountCents = task.discountCents
 *   - Set escrow.discountFundedBy = "PLATFORM"
 *   - NOTE: We do NOT retroactively change amountCents, commissionCents, or vendorPayoutCents
 *     on existing entries — those are historical records. New entries (created after this fix)
 *     will use the correct discounted amounts.
 * - If no discount was applied: leave as-is (originalAmountCents = 0, discountCents = 0)
 *
 * Usage:
 *   npx tsx scripts/backfill-escrow-discount.ts
 */
import { db } from "../src/lib/db";

async function main() {
  console.log("🔄 Backfilling EscrowLedger discount fields...\n");

  // Find all escrow entries that belong to tasks with discounts
  const escrowEntries = await db.escrowLedger.findMany({
    where: {
      originalAmountCents: 0, // not yet backfilled
    },
    include: {
      task: {
        select: { id: true, amountCents: true, discountCents: true, finalAmountCents: true },
      },
    },
  });

  if (escrowEntries.length === 0) {
    console.log("✅ No escrow entries need backfilling.");
    return;
  }

  console.log(`Found ${escrowEntries.length} escrow entries to check.\n`);

  let updated = 0;
  let skipped = 0;

  for (const entry of escrowEntries) {
    const task = entry.task;
    if (!task) {
      console.log(`  ⚠️  Escrow ${entry.id} has no associated task — skipping`);
      skipped++;
      continue;
    }

    const discountCents = task.discountCents || 0;

    if (discountCents > 0) {
      // This task had a discount — record it in the escrow
      await db.escrowLedger.update({
        where: { id: entry.id },
        data: {
          originalAmountCents: task.amountCents,
          discountCents,
          discountFundedBy: "PLATFORM",
        },
      });
      console.log(`  ✅ ${entry.id} → original: ${task.amountCents}, discount: ${discountCents} (task: ${task.id})`);
      updated++;
    } else {
      // No discount on this task — leave originalAmountCents at 0 (already set)
      skipped++;
    }
  }

  console.log(`\n✅ Backfilled ${updated} escrow entries. Skipped ${skipped} (no discount).`);
  console.log("⚠️  NOTE: Existing escrow amountCents/commissionCents/vendorPayoutCents were NOT");
  console.log("   retroactively changed. New escrows created after this fix will use the correct");
  console.log("   discounted amounts. Historical entries keep their original amounts for audit.");
}

main()
  .catch((e) => {
    console.error("❌ Backfill failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
