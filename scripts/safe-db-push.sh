#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# safe-db-push.sh — Safe replacement for `bun run db:push`
#
# 1. Backs up the DB
# 2. Runs prisma db push
# 3. Regenerates the Prisma client
# 4. On failure, offers to restore the backup
#
# Usage: ./scripts/safe-db-push.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "🔒 Safe DB Push"
echo "─────────────────────────────────"

# Step 1: Backup
echo ""
echo "Step 1/3: Backing up database..."
bash "$SCRIPT_DIR/db-backup.sh"

# Step 2: Push schema
echo ""
echo "Step 2/3: Pushing schema changes..."
if ! npx prisma db push 2>&1; then
  echo ""
  echo "❌ Schema push FAILED."
  echo "   Run to restore: ./scripts/db-restore.sh"
  exit 1
fi

# Step 3: Generate client
echo ""
echo "Step 3/3: Regenerating Prisma client..."
npx prisma generate

echo ""
echo "✅ Safe DB push complete."