/**
 * Unified seed entry point for `npx prisma db seed`
 * Runs all three seed scripts in dependency order.
 *
 * Railway Console:
 *   npx prisma db push && npx prisma db seed
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  Anna.I — Database Seed                     ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  await db.$connect();

  // 1. Service job types (no dependencies)
  console.log("📦 [1/3] Seeding service job types...");
  const { main: seedJobTypes } = await import("./seed-job-types");
  await seedJobTypes();

  // 2. Households, members, vendors, tasks, bookings
  console.log("\n📦 [2/3] Seeding households & demo data...");
  const { main: seedDemo } = await import("./seed-demo");
  await seedDemo();

  // 3. Anomalies (depends on households + tasks from step 2)
  console.log("\n📦 [3/3] Seeding anomalies...");
  const { main: seedAnomalies } = await import("./seed-anomalies");
  await seedAnomalies();

  await db.$disconnect();

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  🎉 All seeds completed successfully!      ║");
  console.log("╚══════════════════════════════════════════════╝\n");
}

main().catch((e) => {
  console.error("❌ Seed failed:", e);
  process.exit(1);
});

export default main;