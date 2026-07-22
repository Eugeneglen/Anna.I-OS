/**
 * ensure-seed.ts — Checks if the database has demo data.
 * If critical tables are empty (Household, ServiceJobType, OpsUser), runs the full seed.
 *
 * IMPORTANT: OpsUser is treated as a hard requirement. If OpsUser is empty but
 * other tables have data (e.g. from a broken previous deploy), we still re-seed
 * because the seed scripts are idempotent (deleteMany + createMany).
 *
 * Usage:
 *   npx tsx scripts/ensure-seed.ts
 */

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const CRITICAL_TABLES = [
  { name: "Household", count: () => db.household.count() },
  { name: "ServiceJobType", count: () => db.serviceJobType.count() },
  { name: "OpsUser", count: () => db.opsUser.count() },
] as const;

async function main() {
  console.log("🔍 Checking database seed status...");

  try {
    await db.$connect();

    const results = await Promise.all(
      CRITICAL_TABLES.map(async (t) => ({
        name: t.name,
        count: await t.count(),
      }))
    );

    const empty = results.filter((r) => r.count === 0);
    const allEmpty = results.every((r) => r.count === 0);
    const opsUserEmpty = results.find((r) => r.name === "OpsUser")!.count === 0;

    for (const r of results) {
      const status = r.count > 0 ? `✅ ${r.count} rows` : "⚠️  empty";
      console.log(`  ${r.name}: ${status}`);
    }

    if (allEmpty || opsUserEmpty) {
      const reason = allEmpty
        ? "Database is completely empty"
        : "OpsUser table is empty (required for /ops login)";
      console.log(`\n🚨 ${reason}. Running full seed...`);
      console.log("─".repeat(50));
      const { main: seed } = await import("../prisma/seed");
      await seed();
      console.log("─".repeat(50));
      console.log("✅ Seed complete. Database is ready.\n");
    } else if (empty.length > 0) {
      console.log(
        `\n⚠️  Some tables are empty: ${empty.map((e) => e.name).join(", ")}`
      );
      console.log(
        "   This may be intentional. If not, run: bun run seed"
      );
    } else {
      console.log("\n✅ Database has data. No seed needed.\n");
    }
  } catch (e) {
    console.error("❌ Seed check failed:", e);
    if (process.env.NODE_ENV === "production") {
      console.error("   CRITICAL: Seed failure in production — crashing so container restarts.");
      process.exit(1);
    }
    // In dev, don't crash — just warn
    console.log("   Continuing with dev server start...");
  } finally {
    await db.$disconnect();
  }
}

main();