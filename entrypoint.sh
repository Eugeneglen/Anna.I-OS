#!/bin/bash
set -e

echo "══════════════════════════════════════════════════"
echo "  Anna.I — Production Entrypoint"
echo "══════════════════════════════════════════════════"

# 0. Generate z-ai-web-dev-sdk config if env vars are set
#    The SDK reads from /etc/.z-ai-config (or $CWD/.z-ai-config).
#    On Railway we inject credentials via env vars and write the file.
if [ -n "$Z_AI_BASE_URL" ] && [ -n "$Z_AI_API_KEY" ]; then
  CONFIG_FILE="/etc/.z-ai-config"

  # Build JSON config (only include fields that are set)
  CONFIG="{\"baseUrl\":\"$Z_AI_BASE_URL\",\"apiKey\":\"$Z_AI_API_KEY\"}"
  [ -n "$Z_AI_CHAT_ID" ]  && CONFIG=$(echo "$CONFIG" | sed "s/}/,\"chatId\":\"$Z_AI_CHAT_ID\"}/")
  [ -n "$Z_AI_USER_ID" ]  && CONFIG=$(echo "$CONFIG" | sed "s/}/,\"userId\":\"$Z_AI_USER_ID\"}/")
  [ -n "$Z_AI_TOKEN" ]    && CONFIG=$(echo "$CONFIG" | sed "s/}/,\"token\":\"$Z_AI_TOKEN\"}/")

  echo "$CONFIG" > "$CONFIG_FILE"
  chmod 600 "$CONFIG_FILE"

  echo "  ✅ Z-AI SDK config written to $CONFIG_FILE"
else
  # If no env vars, check if a config file already exists (local dev / mounted volume)
  if [ ! -f "/etc/.z-ai-config" ] && [ ! -f "$PWD/.z-ai-config" ]; then
    echo "  ⚠️  Z-AI SDK config not found — AI features (Ask Anna, Quote Explain, Photo Analysis) will be disabled."
    echo "      Set Z_AI_BASE_URL and Z_AI_API_KEY env vars to enable."
  else
    echo "  ✅ Z-AI SDK config found (pre-existing)"
  fi
fi

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
