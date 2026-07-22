#!/bin/bash
set -e

echo "══════════════════════════════════════════════════"
echo "  Anna.I — Production Entrypoint"
echo "══════════════════════════════════════════════════"

# 1. Push schema (idempotent — safe to re-run)
echo ""
echo "▶ Step 1: Syncing schema (prisma db push)..."
npx prisma db push --accept-data-loss --skip-generate 2>&1
echo "  ✅ Schema synced"

# 2. Seed if database is empty (ensure-seed checks before seeding)
echo ""
echo "▶ Step 2: Checking seed status..."
npx tsx scripts/ensure-seed.ts 2>&1
echo "  ✅ Seed check complete"

# 3. Start the Next.js server
echo ""
echo "▶ Step 3: Starting server on port ${PORT:-8080}..."
exec bun server.js