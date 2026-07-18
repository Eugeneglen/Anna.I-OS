#!/bin/bash
# Production server watchdog — auto-restarts on crash
cd /home/z/my-project

while true; do
  echo "[$(date -Iseconds)] Starting production server..." >> server-watchdog.log
  NODE_ENV=production node .next/standalone/server.js >> server.log 2>&1
  EXIT_CODE=$?
  echo "[$(date -Iseconds)] Server exited with code $EXIT_CODE, restarting in 3s..." >> server-watchdog.log
  sleep 3
done