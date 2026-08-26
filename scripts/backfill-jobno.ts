/**
 * Backfill jobNo for existing tasks.
 *
 * Assigns AI-00000001, AI-00000002, ... in chronological order based on
 * createdAt. Existing tasks that already have a jobNo are skipped.
 *
 * Usage:
 *   npx tsx scripts/backfill-jobno.ts
 */
import { db } from "../src/lib/db";
import { formatJobNo } from "../src/lib/job-number";

async function main() {
  console.log("🔄 Backfilling jobNo for existing tasks...\n");

  const tasks = await db.task.findMany({
    where: { jobNo: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true },
  });

  if (tasks.length === 0) {
    console.log("✅ No tasks need backfilling. All tasks already have a jobNo.");
    return;
  }

  console.log(`Found ${tasks.length} tasks without a jobNo.\n`);

  // Find the highest existing sequence to continue from
  const existingMax = await db.task.findFirst({
    where: { jobNo: { not: null } },
    orderBy: { jobNo: "desc" },
    select: { jobNo: true },
  });

  let seq = 0;
  if (existingMax?.jobNo) {
    const match = existingMax.jobNo.match(/(\d+)$/);
    if (match) seq = parseInt(match[1], 10);
  }

  let updated = 0;
  for (const task of tasks) {
    seq++;
    const jobNo = formatJobNo(seq);
    await db.task.update({
      where: { id: task.id },
      data: { jobNo },
    });
    console.log(`  ✅ ${task.id} → ${jobNo} (created ${task.createdAt.toISOString()})`);
    updated++;
  }

  console.log(`\n✅ Backfilled ${updated} tasks. Next jobNo will be ${formatJobNo(seq + 1)}.`);
}

main()
  .catch((e) => {
    console.error("❌ Backfill failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
