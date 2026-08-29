#!/bin/bash
# Keep Anna.I Next.js server alive — called by cron every minute.
# Checks if port 3000 responds; if not, restarts the server detached.

LOG=/home/z/my-project/dev.log
PIDFILE=/tmp/anna-server.pid

# Health check: does port 3000 respond?
if curl -s --max-time 3 -o /dev/null http://localhost:3000/ops/login; then
  # Server is up — nothing to do
  exit 0
fi

echo "[keepalive $(date)] server down, restarting..." >> "$LOG"

# Kill any stale processes
pkill -9 -f "next start" 2>/dev/null
pkill -9 -f "next-server" 2>/dev/null
sleep 1

# Start the server detached via setsid (survives this script exiting)
cd /home/z/my-project
setsid env \
  NEXT_TELEMETRY_DISABLED=1 \
  NODE_ENV=production \
  NEXTAUTH_SECRET="anna-i-dev-secret-32-chars-long-string-x" \
  PORT=3000 HOSTNAME=0.0.0.0 \
  bun x next start -p 3000 -H 0.0.0.0 >> "$LOG" 2>&1 < /dev/null &

echo "[keepalive $(date)] restart triggered" >> "$LOG"
