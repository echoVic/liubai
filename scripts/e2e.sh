#!/bin/sh
# Run one browser regression against a fresh web server and data directory.
# Usage: scripts/e2e.sh <check> [port]   e.g. scripts/e2e.sh check-reader
# Requires Go and Python Playwright with an installed Chrome.
set -eu
repo=$(cd "$(dirname "$0")/.." && pwd)
check=${1:?usage: scripts/e2e.sh <check> [port]}
port=${2:-4196}
work=$(mktemp -d /tmp/liubai-e2e.XXXXXX)
go build -C "$repo" -o "$work/liubai" .
"$work/liubai" -web "127.0.0.1:$port" -data-dir "$work/data" > "$work/server.log" 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true; wait $server 2>/dev/null || true' EXIT
i=0
until curl -s -o /dev/null "http://127.0.0.1:$port/"; do
  i=$((i + 1))
  if [ $i -ge 150 ] || ! kill -0 $server 2>/dev/null; then echo "server did not start, see $work/server.log" >&2; exit 1; fi
  sleep 0.2
done
python3 "$repo/scripts/$check.py" "http://127.0.0.1:$port"
