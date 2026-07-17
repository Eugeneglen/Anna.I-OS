#!/bin/bash
# Silent watchdog - restarts next dev if it's down
if ! curl -s -o /dev/null -w "" http://localhost:3000 2>/dev/null; then
  pkill -f "next dev" 2>/dev/null
  sleep 1
  NEXT_TELEMETRY_DISABLED=1 nohup npx next dev -p 3000 >> /home/z/my-project/dev.log 2>&1 &
  disown
fi
