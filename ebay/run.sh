#!/bin/sh
# Scheduler loop.
#   CONFIG_DIR      : shared configs dir on the volume (default /data/configs)
#   SCRAPE_INTERVAL : seconds between cycles (default 300 = 5 min)
# A config with top-level `enabled: false` is skipped.
set -u

CONFIG_DIR="${CONFIG_DIR:-/data/configs}"
INTERVAL="${SCRAPE_INTERVAL:-300}"
LOG_DIR="${LOG_DIR:-/data/logs}"
LOG_MAX_BYTES="${LOG_MAX_BYTES:-1048576}"   # rotate au-delà de 1 Mo (on garde la moitié)

mkdir -p "$LOG_DIR"

# Append stdin to the per-config log, then cap its size.
log_append() {
  # $1 = log file
  tee -a "$1"
  size=$(wc -c < "$1" 2>/dev/null || echo 0)
  if [ "$size" -gt "$LOG_MAX_BYTES" ]; then
    tail -c "$((LOG_MAX_BYTES / 2))" "$1" > "$1.tmp" && mv "$1.tmp" "$1"
  fi
}

# Sync: copy any new bundled configs to shared dir (won't overwrite existing)
mkdir -p "$CONFIG_DIR"
for cfg in /app/configs/*.yml; do
  [ -e "$cfg" ] || continue
  dest="$CONFIG_DIR/$(basename "$cfg")"
  if [ ! -e "$dest" ]; then
    echo "🌱 Adding new config: $(basename "$cfg")"
    cp "$cfg" "$dest"
  fi
done

echo "🚀 eBay CA scraper — configs: $CONFIG_DIR | interval: ${INTERVAL}s"

while true; do
  for cfg in "$CONFIG_DIR"/*.yml; do
    [ -e "$cfg" ] || continue
    if grep -qiE '^enabled:[[:space:]]*(false|no)[[:space:]]*$' "$cfg"; then
      echo "⏭️  $(basename "$cfg") disabled (enabled: false)"
      continue
    fi
    stem=$(basename "$cfg" .yml)
    {
      echo "── run $(date '+%Y-%m-%d %H:%M:%S') ─────────────────────────"
      python scrapper.py "$cfg" 2>&1 || echo "⚠️  run failed for $cfg (will retry next cycle)"
      # Kijiji companion run — no-op unless the config defines kijiji_url
      python kijiji_scrapper.py "$cfg" 2>&1 || echo "⚠️  kijiji run failed for $cfg (will retry next cycle)"
    } | log_append "$LOG_DIR/$stem.log"
  done
  sleep "$INTERVAL"
done
