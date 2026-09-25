#!/usr/bin/env bash
# The shipped app, driven in a browser. Three checks, one command.
#
# 1. drive.mjs     nothing past the edge, no broken word, no sideways
#                  scroll, at 320, 375 and 390 in both themes.
# 2. clickable.mjs no screen grew a row, card or tile that goes nowhere
#                  (qa/clickable-baseline.json).
# 3. links.mjs     every link on every screen lands on a real screen the
#                  signed-in person may open.
#
# FIXTURE_MODE swaps the two Supabase seams for the fixture and nothing
# else, so this is the real app with its real font, hydration and chrome.
set -euo pipefail
cd "$(dirname "$0")/../.."

PORT="${PORT:-3100}"
export PW_CHROMIUM="${PW_CHROMIUM:-/opt/pw-browsers/chromium}"
export BASE="http://localhost:${PORT}"

echo "==> Building the app against the fixture"
FIXTURE_MODE=1 npx next build > /tmp/live-build.log 2>&1 || { tail -30 /tmp/live-build.log; exit 1; }

echo "==> Starting it on ${PORT}"
fuser -k "${PORT}/tcp" > /dev/null 2>&1 || true
sleep 1
FIXTURE_MODE=1 npx next start -p "${PORT}" > /tmp/live-server.log 2>&1 &
SERVER=$!
trap 'kill ${SERVER} 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "${BASE}/login"; then break; fi
  sleep 1
done

echo "==> Every screen at 320, 375 and 390, both themes"
node scripts/live/drive.mjs

echo "==> Every row, card and tile: does it go anywhere"
node scripts/live/clickable.mjs

echo "==> Every link: does it land"
node scripts/live/links.mjs

echo "==> A screen that threw would be in the server log"
if grep -q "⨯" /tmp/live-server.log; then
  grep -n "⨯" -A 4 /tmp/live-server.log | head -40
  echo "FAIL: a screen threw while it was being driven"
  exit 1
fi

echo "==> Done. The app runs, every screen is clean, every link lands."
