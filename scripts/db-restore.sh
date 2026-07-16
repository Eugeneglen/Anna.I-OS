#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# db-restore.sh — Restores the most recent backup.
# Usage: ./scripts/db-restore.sh [backup-file]
#   With no args, restores the latest backup.
# ═══════════════════════════════════════════════════════════

set -euo pipefail

DB_DIR="$(cd "$(dirname "$0")/../db" && pwd)"
DB_FILE="$DB_DIR/custom.db"
BACKUP_DIR="$DB_DIR/backups"

if [ -n "${1:-}" ]; then
  BACKUP_FILE="$1"
else
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/custom-*.db 2>/dev/null | head -1)
fi

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "❌ No backup found. Available backups:"
  ls -la "$BACKUP_DIR"/custom-*.db 2>/dev/null || echo "   (none)"
  exit 1
fi

echo "📦 Restoring from: $BACKUP_FILE"
cp "$BACKUP_FILE" "$DB_FILE"
echo "✅ Database restored. Run seed scripts if needed:"
echo "   bun run prisma/seed-job-types.ts && bun run prisma/seed.ts && bun run prisma/seed-anomalies.ts"