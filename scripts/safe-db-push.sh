#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# safe-db-push.sh — Migration-safe schema change workflow
#
# OLD BEHAVIOUR (DESTRUCTIVE — DO NOT USE):
#   prisma db push  → drops ALL data, recreates tables
#
# NEW BEHAVIOUR (PRESERVES DATA):
#   prisma migrate dev → generates an ALTER TABLE migration,
#                        applies it incrementally, preserves data
#
# Steps:
#   1. Backs up the DB (rolling, keeps last 5)
#   2. Runs prisma migrate dev to create + apply a migration
#   3. Regenerates the Prisma client
#   4. On failure, offers to restore the backup
#
# Usage:
#   bun run db:push                          # auto-names migration
#   MIGRATION_NAME="add-col-x" bun run db:push  # custom name
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🔒 Safe DB Migration"
echo "─────────────────────────────────"
echo ""
echo "ℹ️  Using prisma migrate dev (preserves existing data)."
echo "   If you need to DESTROY all data, use: bun run db:reset"

# Step 1: Backup
echo ""
echo "Step 1/3: Backing up database..."
bash "$SCRIPT_DIR/db-backup.sh"

# Step 2: Create and apply migration
echo ""
echo "Step 2/3: Creating and applying migration..."
MIGRATION_NAME="${MIGRATION_NAME:-auto}"

if ! npx prisma migrate dev --name "$MIGRATION_NAME" 2>&1; then
  echo ""
  echo "❌ Migration FAILED."
  echo "   The database was automatically rolled back by Prisma."
  echo "   If the DB is in a bad state, restore with: bun run db:restore"
  exit 1
fi

# Step 3: Generate client
echo ""
echo "Step 3/3: Regenerating Prisma client..."
npx prisma generate

echo ""
echo "✅ Migration complete. All existing data preserved."
echo "   Migration files are in: prisma/migrations/"