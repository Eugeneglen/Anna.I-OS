/**
 * Unified seed entry point for `npx prisma db seed`
 * Runs all three seed scripts in dependency order.
 *
 * Railway usage:
 *   npx prisma db deploy && npx prisma db seed
 */

async function main() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  Anna.I — Database Seed                     ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // Each seed file runs itself on import (calls main() as side effect).
  // We import sequentially to respect dependency order.
  console.log("📦 [1/3] Seeding service job types...");
  await import("./seed-job-types");

  console.log("\n📦 [2/3] Seeding households & demo data...");
  await import("./seed");

  console.log("\n📦 [3/3] Seeding anomalies...");
  await import("./seed-anomalies");

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  🎉 All seeds completed successfully!      ║");
  console.log("╚══════════════════════════════════════════════╝\n");
}

main().catch((e) => {
  console.error("❌ Seed failed:", e);
  process.exit(1);
});

export default main;