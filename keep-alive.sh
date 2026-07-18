#!/bin/bash
if ! pgrep -f "next-server" > /dev/null 2>&1; then
  cd /home/z/my-project
  pkill -f "next dev" 2>/dev/null
  NEXT_TELEMETRY_DISABLED=1 nohup /home/z/my-project/node_modules/.bin/next dev -p 3000 > /home/z/my-project/dev.log 2>&1 &
  disown
fi
