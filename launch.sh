#!/usr/bin/env bash
# Launches the IPTV player server (if not already running) and opens it
# in its own Chrome app window (no tabs/address bar).
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-4040}"
URL="http://localhost:${PORT}"

if ! curl -s -o /dev/null "${URL}"; then
  cd "${APP_DIR}"
  nohup node server.js > /tmp/iptv-player.log 2>&1 &
  disown

  for i in $(seq 1 30); do
    curl -s -o /dev/null "${URL}" && break
    sleep 0.3
  done
fi

exec google-chrome --app="${URL}" --class=IPTVPlayer
