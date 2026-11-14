#!/bin/bash
# Pull fresh census feeds from the HPC into web/public/data every INTERVAL seconds (default 600).
# Requires an open SSH ControlMaster to the login node (ControlPath ~/.ssh/cm-%C). No credentials here.
INTERVAL=${INTERVAL:-600}
HOST=abdelmonaim.bounite@login-student-lab.mbzu.ae
DIR="$(cd "$(dirname "$0")" && pwd)/public/data"
mkdir -p "$DIR"
while true; do
  ssh -o ControlPath=~/.ssh/cm-%C "$HOST" 'timeout ${EXPORT_TIMEOUT:-3000} ssh -n -o BatchMode=yes gpu-01 "cd ~/skylens && nice -n 10 .venv/bin/python -m census.export_web --census ~/skylens/census_out --out ~/skylens/web_data >/dev/null 2>&1"' </dev/null
  # flipbook/ and sphx/ are superseded by the in-browser BLINK engine and the v2 exposure index (sphx2/)
  rsync -az --exclude flipbook --exclude sphx --exclude 'sphx*.tmp' -e "ssh -o ControlPath=$HOME/.ssh/cm-%C" "$HOST:skylens/web_data/" "$DIR/"
  echo "$(date '+%H:%M:%S') synced: $(python3 -c "import json;s=json.load(open('$DIR/summary.json'));print(s['tiles_done'],'/',s['tiles_total'],'tiles')" 2>/dev/null)"
  [ "$1" = "--once" ] && break
  sleep "$INTERVAL"
done
