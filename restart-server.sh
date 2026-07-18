#!/bin/bash
if ! pgrep -f "server.js" > /dev/null 2>&1 && ! pgrep -f "next dev" > /dev/null 2>&1; then
  cd /home/z/my-project
  pkill -f "tee" 2>/dev/null
  NEXT_TELEMETRY_DISABLED=1 nohup bash -c 'npx next dev -p 3000 2>&1 | tee dev.log' > /dev/null 2>&1 &
  disown
  echo "$(date): Restarted dev server" >> /home/z/my-project/restart.log
fi
