#!/bin/bash
# Marketing server watchdog — restarts the built standalone server if it dies.
# Uses start-stop-daemon with --chdir for proper working directory (needed for
# API endpoints that write to src/data/leads.json using process.cwd()).
while true; do
  if ! pgrep -f "entry.mjs" > /dev/null 2>&1; then
    echo "[$(date -Iseconds)] Marketing server down — restarting..." >> /home/z/my-project/marketing-watchdog.log
    start-stop-daemon --start --background --make-pidfile --pidfile /tmp/marketing.pid \
      --chdir /home/z/my-project/marketing-site \
      --exec /usr/bin/env -- \
      HOST=0.0.0.0 PORT=4321 \
      node /home/z/my-project/marketing-site/dist/server/entry.mjs
    sleep 3
  fi
  sleep 15
done
