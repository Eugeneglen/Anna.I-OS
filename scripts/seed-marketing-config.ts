/**
 * One-off seed script — writes the `marketing_config` row into
 * `platform_config` (Phase 2 Fix 8). Safe to run multiple times
 * (upsert). Does NOT modify any other data.
 *
 * Usage:  bun run scripts/seed-marketing-config.ts
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const MARKETING_CONFIG = {
  reactivationRate: 0.3,
  defaultDiscountValue: 15,
  avgOrderValueCents: 5000,
  rfmRecencyThresholds: [30, 60, 90, 180],
  rfmFrequencyThresholds: [1, 3, 6, 10],
  rfmMonetaryThresholds: [5000, 10000, 30000, 50000],
  voucherExpiryNoticeDays: 3,
};

async function main() {
  console.log("Seeding marketing_config row...");
  await db.platformConfig.upsert({
    where: { key: "marketing_config" },
    update: {
      value: JSON.stringify(MARKETING_CONFIG),
      label: "Marketing module configuration (RFM thresholds, reactivation rate, etc.)",
    },
    create: {
      key: "marketing_config",
      value: JSON.stringify(MARKETING_CONFIG),
      label: "Marketing module configuration (RFM thresholds, reactivation rate, etc.)",
    },
  });
  console.log("✅ marketing_config seeded:", MARKETING_CONFIG);
}

main()
  .catch((e) => {
    console.error("❌ Failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
