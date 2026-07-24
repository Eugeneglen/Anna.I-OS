/**
 * ensure-db.ts — Bulletproof database initialization.
 *
 * This script is the SINGLE point of truth for making sure the database
 * is ready before the app starts. It runs on EVERY startup (local dev,
 * production entrypoint, Railway deploy).
 *
 * What it does (in order):
 *   1. Ensures the database directory exists (SQLite)
 *   2. Runs `prisma db push` to sync schema (idempotent — safe to re-run)
 *   3. Runs `prisma generate` to regenerate the client
 *   4. Checks if seed data exists, and seeds if needed (idempotent)
 *
 * Failure modes it prevents:
 *   - "Unable to open database file" (missing directory)
 *   - "Table doesn't exist" (schema not applied)
 *   - "No users found" (empty database, no seed)
 *
 * Usage:
 *   npx tsx scripts/ensure-db.ts
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const PROJECT_ROOT = path.resolve(__dirname, "..");

function ensureDir() {
  const dbUrl = process.env.DATABASE_URL || "";

  if (!dbUrl.startsWith("file:")) {
    console.log("  [1/4] Directory check: skipped (non-SQLite DATABASE_URL)");
    return;
  }

  let filePath = dbUrl.replace(/^file:/, "");
  if (!path.isAbsolute(filePath)) {
    filePath = path.resolve(PROJECT_ROOT, filePath);
  }

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    console.log(`  [1/4] Creating database directory: ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
    console.log("  [1/4] ✅ Directory created");
  } else {
    console.log("  [1/4] ✅ Database directory exists");
  }
}

function runPrismaPush() {
  console.log("  [2/4] Syncing schema (prisma db push)...");
  try {
    execSync("npx prisma db push --accept-data-loss --skip-generate", {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      timeout: 30_000,
    });
    console.log("  [2/4] ✅ Schema synced");
  } catch (err: any) {
    const stderr = err?.stderr?.toString() || "";
    // `prisma db push` exits 0 even when "already in sync" — any non-zero is real
    console.error("  [2/4] ❌ prisma db push FAILED:");
    console.error(stderr);
    throw new Error(`prisma db push failed: ${stderr.slice(-200)}`);
  }
}

function runPrismaGenerate() {
  console.log("  [3/4] Regenerating Prisma client...");
  try {
    execSync("npx prisma generate", {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      timeout: 30_000,
    });
    console.log("  [3/4] ✅ Client regenerated");
  } catch (err: any) {
    const stderr = err?.stderr?.toString() || "";
    console.error("  [3/4] ❌ prisma generate FAILED:");
    console.error(stderr);
    throw new Error(`prisma generate failed: ${stderr.slice(-200)}`);
  }
}

async function checkSeed() {
  console.log("  [4/4] Checking seed data...");
  // Re-import the ensure-seed logic directly to avoid spawning another process
  const { PrismaClient } = await import("@prisma/client");
  const seedDb = new PrismaClient();

  try {
    const [householdCount, opsUserCount, jobTypeCount] = await Promise.all([
      seedDb.household.count(),
      seedDb.opsUser.count(),
      seedDb.serviceJobType.count(),
    ]);

    console.log(
      `  [4/4] Current data: ${householdCount} households, ${opsUserCount} ops users, ${jobTypeCount} job types`
    );

    const needsSeed = householdCount === 0 || opsUserCount === 0 || jobTypeCount === 0;

    if (needsSeed) {
      console.log("  [4/4] Running seed...");
      // Dynamic import the seed script (uses default export)
      const seedModule = await import("../prisma/seed");
      const seed = seedModule.default || seedModule.main;
      if (typeof seed !== "function") {
        throw new Error("seed.ts does not export a default or named 'main' function");
      }
      await seed();
      console.log("  [4/4] ✅ Seed complete");
    } else {
      console.log("  [4/4] ✅ Seed data present — skipping");
    }
  } finally {
    await seedDb.$disconnect();
  }
}

async function main() {
  console.log("");
  console.log("══════════════════════════════════════════════════");
  console.log("  🛡️  Anna.I — Database Auto-Init");
  console.log("══════════════════════════════════════════════════");
  console.log("");

  // Step 1: Ensure directory
  ensureDir();

  // Step 2: Sync schema
  runPrismaPush();

  // Step 3: Regenerate client
  runPrismaGenerate();

  // Step 4: Check/seed data
  await checkSeed();

  console.log("");
  console.log("══════════════════════════════════════════════════");
  console.log("  ✅ Database is ready. Starting app...");
  console.log("══════════════════════════════════════════════════");
  console.log("");
}

main().catch((err) => {
  console.error("");
  console.error("══════════════════════════════════════════════════");
  console.error("  ❌ DATABASE INIT FAILED — app cannot start safely");
  console.error("══════════════════════════════════════════════════");
  console.error(err);
  console.error("");

  if (process.env.NODE_ENV === "production") {
    // In production, crash so Railway restarts the container
    process.exit(1);
  }
  // In dev, warn but don't crash (Next.js hot reload will retry)
  console.warn("  ⚠️  Continuing in dev mode (database may not work)");
});
