#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# db-backup.sh — Backs up the SQLite database before any
# schema-changing operation. Rolling backups (keeps last 5).
# ═══════════════════════════════════════════════════════════

set -euo pipefail

DB_DIR="$(cd "$(dirname "$0")/../db" && pwd)"
DB_FILE="$DB_DIR/custom.db"
BACKUP_DIR="$DB_DIR/backups"

if [ ! -f "$DB_FILE" ]; then
  echo "⚠️  No database found at $DB_FILE — nothing to back up."
  exit 0
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date '+%Y%m%d-%H%M%S')
BACKUP_FILE="$BACKUP_DIR/custom-$TIMESTAMP.db"

cp "$DB_FILE" "$BACKUP_FILE"
echo "✅ Backup saved: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# Keep only the 5 most recent backups
ls -t "$BACKUP_DIR"/custom-*.db 2>/dev/null | tail -n +6 | xargs rm -f --
REMAINING=$(ls "$BACKUP_DIR"/custom-*.db 2>/dev/null | wc -l)
echo "   Rolling backups: $REMAINING kept (max 5)"