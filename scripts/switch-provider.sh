#!/bin/bash
# ============================================================
# Anna.I — Toggle Prisma provider between SQLite (local) and PostgreSQL (Railway)
# Usage:
#   bun run db:provider          # Show current datasource provider
#   bun run db:provider:local    # Switch to SQLite for local dev
#   bun run db:provider:prod     # Switch to PostgreSQL for Railway push
# ============================================================

SCHEMA="prisma/schema.prisma"

current_provider() {
  # Only match the provider inside the datasource block (not generator)
  awk '/^datasource/,/}/' "$SCHEMA" | grep -oP 'provider\s*=\s*"\K[^"]+'
}

case "${1:-show}" in
  show)
    echo "Datasource provider: $(current_provider)"
    ;;
  local|sqlite)
    if [ "$(current_provider)" = "sqlite" ]; then
      echo "Already on SQLite (local)"
      exit 0
    fi
    sed -i 's/provider = "postgresql"/provider = "sqlite"/' "$SCHEMA"
    echo "✅ Switched to SQLite (local) — run: npx prisma generate && npx prisma db push"
    ;;
  prod|postgresql|pg)
    if [ "$(current_provider)" = "postgresql" ]; then
      echo "Already on PostgreSQL (production)"
      exit 0
    fi
    sed -i 's/provider = "sqlite"/provider = "postgresql"/' "$SCHEMA"
    echo "✅ Switched to PostgreSQL (production) — ready to push"
    ;;
  *)
    echo "Usage: bun run db:provider [local|prod]"
    echo "  local  — Switch to SQLite for local development"
    echo "  prod   — Switch to PostgreSQL for Railway deployment"
    exit 1
    ;;
esac