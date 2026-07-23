/**
 * ensure-seed.ts — Checks if the database has demo data.
 * If critical tables are empty (Household, ServiceJobType, OpsUser), runs the full seed.
 *
 * Also performs additive backfills for new columns that were added via
 * `prisma db push` (which adds columns as NULL to existing rows).
 * Backfills run even when the full seed is skipped because tables already have data.
 *
 * IMPORTANT: OpsUser is treated as a hard requirement. If OpsUser is empty but
 * other tables have data (e.g. from a broken previous deploy), we still re-seed
 * because the seed scripts are idempotent (deleteMany + createMany).
 *
 * Usage:
 *   npx tsx scripts/ensure-seed.ts
 */

import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const db = new PrismaClient();

const CRITICAL_TABLES = [
  { name: "Household", count: () => db.household.count() },
  { name: "ServiceJobType", count: () => db.serviceJobType.count() },
  { name: "OpsUser", count: () => db.opsUser.count() },
] as const;

/**
 * Backfill passwordHash on existing FamilyMember records that have NULL.
 * Safe & idempotent: only updates rows where passwordHash IS NULL.
 * Uses the known demo password "household123".
 */
async function backfillMemberPasswords() {
  const missing = await db.familyMember.count({ where: { passwordHash: null } });
  if (missing === 0) {
    console.log("  FamilyMember passwordHash: ✅ all populated");
    return;
  }
  console.log(`  FamilyMember passwordHash: ⚠️  ${missing} rows missing — backfilling...`);
  const hash = bcrypt.hashSync("household123", 10);
  const updated = await db.familyMember.updateMany({
    where: { passwordHash: null },
    data: { passwordHash: hash },
  });
  console.log(`  FamilyMember passwordHash: ✅ backfilled ${updated.count} rows`);
}

/**
 * Backfill passwordHash on existing Vendor records that have NULL.
 * Safe & idempotent: only updates rows where passwordHash IS NULL.
 * Uses the known demo password "vendor123".
 */
async function backfillVendorPasswords() {
  const missing = await db.vendor.count({ where: { passwordHash: null } });
  if (missing === 0) {
    console.log("  Vendor passwordHash: ✅ all populated");
    return;
  }
  console.log(`  Vendor passwordHash: ⚠️  ${missing} rows missing — backfilling...`);
  const hash = await bcrypt.hash("vendor123", 10);
  const updated = await db.vendor.updateMany({
    where: { passwordHash: null },
    data: { passwordHash: hash },
  });
  console.log(`  Vendor passwordHash: ✅ backfilled ${updated.count} rows`);
}

/**
 * Backfill onboardingStep / onboardingCompletedAt on Households that have
 * onboardingStep = 0 (the @default). Demo households should be marked as
 * already onboarded so they skip the wizard.
 */
async function backfillOnboardingStatus() {
  const needsUpdate = await db.household.count({
    where: { onboardingStep: 0 },
  });
  if (needsUpdate === 0) {
    console.log("  Household onboarding status: ✅ all set");
    return;
  }
  console.log(`  Household onboarding status: ⚠️  ${needsUpdate} households at step 0 — marking as onboarded...`);
  const updated = await db.household.updateMany({
    where: { onboardingStep: 0 },
    data: { onboardingStep: 5, onboardingCompletedAt: new Date() },
  });
  console.log(`  Household onboarding status: ✅ updated ${updated.count} households`);
}

async function runBackfills() {
  console.log("\n📦 Running additive backfills...");
  await backfillMemberPasswords();
  await backfillVendorPasswords();
  await backfillOnboardingStatus();
  console.log("  Backfills complete.\n");
}

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
      // Still run backfills even when only some tables are empty
      await runBackfills();
    } else {
      console.log("\n✅ Database has data. Running backfills for new columns...");
      await runBackfills();
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
