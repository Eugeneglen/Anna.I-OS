#!/bin/bash
# Dev server watchdog — auto-restarts on crash
cd /home/z/my-project

while true; do
  echo "[$(date -Iseconds)] Starting dev server..." >> dev-watchdog.log
  bun run dev >> dev.log 2>&1
  EXIT_CODE=$?
  echo "[$(date -Iseconds)] Dev server exited with code $EXIT_CODE, restarting in 3s..." >> dev-watchdog.log
  sleep 3
done