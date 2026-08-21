#!/bin/sh
# Scheduler loop.
#   CONFIG_DIR      : shared configs dir on the volume (default /data/configs)
#   SCRAPE_INTERVAL : seconds between cycles (default 300 = 5 min)
# A config with top-level `enabled: false` is skipped.
set -u

CONFIG_DIR="${CONFIG_DIR:-/data/configs}"
INTERVAL="${SCRAPE_INTERVAL:-300}"

# Seed: copy the bundled configs on first start (empty shared dir)
mkdir -p "$CONFIG_DIR"
if ! ls "$CONFIG_DIR"/*.yml >/dev/null 2>&1; then
  echo "🌱 Seeding $CONFIG_DIR from bundled configs"
  cp /app/configs/*.yml "$CONFIG_DIR"/
fi

echo "🚀 eBay CA scraper — configs: $CONFIG_DIR | interval: ${INTERVAL}s"

while true; do
  for cfg in "$CONFIG_DIR"/*.yml; do
    [ -e "$cfg" ] || continue
    if grep -qiE '^enabled:[[:space:]]*(false|no)[[:space:]]*$' "$cfg"; then
      echo "⏭️  $(basename "$cfg") disabled (enabled: false)"
      continue
    fi
    python scrapper.py "$cfg" || echo "⚠️  run failed for $cfg (will retry next cycle)"
  done
  sleep "$INTERVAL"
done
