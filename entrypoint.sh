#!/bin/bash
set -e

echo "══════════════════════════════════════════════════"
echo "  Anna.I — Production Entrypoint"
echo "══════════════════════════════════════════════════"

# ─────────────────────────────────────────────────────
# 0. Validate DATABASE_URL
# ─────────────────────────────────────────────────────
echo ""
echo "▶ Step 0: Validating DATABASE_URL..."
if [ -z "$DATABASE_URL" ]; then
  echo "  ❌ FATAL: DATABASE_URL is not set!"
  echo "     On Railway: Create a PostgreSQL service and attach it to this service."
  echo "     Railway will auto-inject DATABASE_URL."
  echo ""
  echo "     CRASHING — container will restart. Fix DATABASE_URL to proceed."
  exit 1
fi

# Determine database type from DATABASE_URL
if echo "$DATABASE_URL" | grep -qi "^postgres"; then
  echo "  ✅ DATABASE_URL points to PostgreSQL"
  DB_TYPE="postgresql"
elif echo "$DATABASE_URL" | grep -qi "^file:"; then
  echo "  ✅ DATABASE_URL points to SQLite (local/development mode)"
  DB_TYPE="sqlite"
else
  echo "  ⚠️  DATABASE_URL format unrecognized: ${DATABASE_URL:0:30}..."
  echo "     Attempting to proceed anyway..."
  DB_TYPE="unknown"
fi

# ─────────────────────────────────────────────────────
# 1. Generate z-ai-web-dev-sdk config if env vars are set
# ─────────────────────────────────────────────────────
echo ""
echo "▶ Step 1: Preparing AI SDK config..."
if [ -n "$Z_AI_BASE_URL" ] && [ -n "$Z_AI_API_KEY" ]; then
  CONFIG_FILE="/etc/.z-ai-config"

  CONFIG="{\"baseUrl\":\"$Z_AI_BASE_URL\",\"apiKey\":\"$Z_AI_API_KEY\"}"
  [ -n "$Z_AI_CHAT_ID" ]  && CONFIG=$(echo "$CONFIG" | sed "s/}/,\"chatId\":\"$Z_AI_CHAT_ID\"}/")
  [ -n "$Z_AI_USER_ID" ]  && CONFIG=$(echo "$CONFIG" | sed "s/}/,\"userId\":\"$Z_AI_USER_ID\"}/")
  [ -n "$Z_AI_TOKEN" ]    && CONFIG=$(echo "$CONFIG" | sed "s/}/,\"token\":\"$Z_AI_TOKEN\"}/")

  echo "$CONFIG" > "$CONFIG_FILE"
  chmod 600 "$CONFIG_FILE"
  echo "  ✅ Z-AI SDK config written to $CONFIG_FILE"
else
  if [ ! -f "/etc/.z-ai-config" ] && [ ! -f "$PWD/.z-ai-config" ]; then
    echo "  ⚠️  Z-AI SDK config not found — AI features will be disabled."
    echo "      Set Z_AI_BASE_URL and Z_AI_API_KEY env vars to enable."
  else
    echo "  ✅ Z-AI SDK config found (pre-existing)"
  fi
fi

# ─────────────────────────────────────────────────────
# 2. Ensure upload directory exists and is writable
# ─────────────────────────────────────────────────────
UPLOAD_DIR="${UPLOAD_DIR:-/data/uploads}"
echo ""
echo "▶ Step 2: Preparing upload directory ($UPLOAD_DIR)..."
mkdir -p "$UPLOAD_DIR/attachments/verification" "$UPLOAD_DIR/attachments/photos" "$UPLOAD_DIR/attachments/videos" "$UPLOAD_DIR/avatars/vendors"
echo "  ✅ Upload directories ready"

# ─────────────────────────────────────────────────────
# 3. Database auto-init (schema sync + seed)
#    This is the CRITICAL step that prevents login errors.
#    It ensures tables exist and demo data is present.
# ─────────────────────────────────────────────────────
echo ""
echo "▶ Step 3: Database auto-init..."
npx tsx scripts/ensure-db.ts 2>&1
echo "  ✅ Database ready"

# ─────────────────────────────────────────────────────
# 3b. Backfill job numbers for existing tasks
#     Idempotent — skips tasks that already have a jobNo.
#     Runs on every startup so any pre-existing tasks (from before
#     the job-number feature was deployed) get assigned a number.
#     Safe to run repeatedly (no-op once all tasks have jobNo).
# ─────────────────────────────────────────────────────
echo ""
echo "▶ Step 3b: Backfilling job numbers (idempotent)..."
npx tsx scripts/backfill-jobno.ts 2>&1 || echo "  ⚠️  Backfill skipped (non-fatal)"
echo "  ✅ Job numbers ready"

# ─────────────────────────────────────────────────────
# 3c. Backfill household cached stats (idempotent)
# ─────────────────────────────────────────────────────
echo ""
echo "▶ Step 3c: Backfilling household stats (idempotent)..."
npx tsx scripts/backfill-household-stats.ts 2>&1 || echo "  ⚠️  Backfill skipped (non-fatal)"
echo "  ✅ Household stats ready"

# ─────────────────────────────────────────────────────
# 4. Start the Next.js server
# ─────────────────────────────────────────────────────
echo ""
echo "▶ Step 4: Starting server on port ${PORT:-8080}..."
exec bun server.js
