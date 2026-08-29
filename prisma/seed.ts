/**
 * Unified seed entry point for `npx prisma db seed`
 * Runs all three seed scripts in dependency order.
 *
 * All sub-scripts share ONE PrismaClient via prisma/seed-db.ts
 * to avoid exhausting PostgreSQL connection limits.
 *
 * SEED_VERSION — bump this string whenever seed data changes.
 * ensure-db.ts compares this against the stored version in PlatformConfig.
 * If they differ (or no version is stored), the seed is re-run.
 *
 * Railway Console:
 *   npx prisma migrate deploy && npx prisma db seed
 */

import { db } from "./seed-db";

export const SEED_VERSION = "2025-08-25-v4";

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  Anna.I — Database Seed                     ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  await db.$connect();

  // 0. RBAC — roles, permissions, role-permission mappings, migrate existing users
  console.log("📦 [0/5] Seeding RBAC (roles, permissions, user migration)...");
  const seedRbac = (await import("./seed-rbac")).default;
  await seedRbac();

  // 1. Ops users (no dependencies — must exist for /ops login)
  console.log("📦 [1/5] Seeding ops users...");
  const { main: seedOps } = await import("./seed-ops");
  await seedOps();

  // 2. Service job types (no dependencies)
  console.log("📦 [2/5] Seeding service job types...");
  const { main: seedJobTypes } = await import("./seed-job-types");
  await seedJobTypes();

  // 3. Households, members, vendors, tasks, bookings
  console.log("\n📦 [3/5] Seeding households & demo data...");
  const { main: seedDemo } = await import("./seed-demo");
  await seedDemo();

  // 4. Anomalies (depends on households + tasks from step 3)
  console.log("\n📦 [4/5] Seeding anomalies...");
  const { main: seedAnomalies } = await import("./seed-anomalies");
  await seedAnomalies();

  // 5. Record seed version in PlatformConfig so ensure-db.ts can detect changes
  console.log("\n📦 [5/5] Recording seed version...");
  await db.platformConfig.upsert({
    where: { key: "seed_version" },
    update: { value: SEED_VERSION, label: "Current seed data version" },
    create: { key: "seed_version", value: SEED_VERSION, label: "Current seed data version" },
  });
  console.log(`  ✅ Seed version recorded: ${SEED_VERSION}`);

  // 5b. Seed marketing_config (Phase 2 Fix 8) — default magic-number values
  //     now stored in platform_config so they can be tuned without a code change.
  await db.platformConfig.upsert({
    where: { key: "marketing_config" },
    update: {},
    create: {
      key: "marketing_config",
      value: JSON.stringify({
        reactivationRate: 0.3,
        defaultDiscountValue: 15,
        avgOrderValueCents: 5000,
        rfmRecencyThresholds: [30, 60, 90, 180],
        rfmFrequencyThresholds: [1, 3, 6, 10],
        rfmMonetaryThresholds: [5000, 10000, 30000, 50000],
        voucherExpiryNoticeDays: 3,
      }),
      label: "Marketing module configuration (RFM thresholds, reactivation rate, etc.)",
    },
  });
  console.log(`  ✅ Marketing config seeded`);

  await db.$disconnect();

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  🎉 All seeds completed successfully!      ║");
  console.log("╚══════════════════════════════════════════════╝\n");
}

if (require.main === module) {
  main().catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  });
}

export default main;