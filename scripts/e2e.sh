#!/bin/sh
# Run one browser regression against a fresh web server and data directory.
# Usage: scripts/e2e.sh <check> [port]   e.g. scripts/e2e.sh check-reader
# Without a port the OS assigns a free one, so an app already using the default
# port cannot make the check run against the wrong server. Requires Go and
# Python Playwright with an installed Chrome.
set -eu
repo=$(cd "$(dirname "$0")/.." && pwd)
check=${1:?usage: scripts/e2e.sh <check> [port]}
if [ "${2:-}" ]; then
  port=$2
else
  port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
fi
# Fail fast on a port another app already owns (e.g. a dev server): otherwise its
# 200 makes the check run against the wrong app. SO_REUSEADDR still allows a port
# left in TIME_WAIT, which Go can bind.
if ! python3 - "$port" <<'PY'
import socket,sys
s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
try: s.bind(("127.0.0.1",int(sys.argv[1])))
except OSError: sys.exit(1)
s.close()
PY
then
  echo "port $port is already in use; pass a free port or omit it to get an ephemeral one" >&2
  exit 1
fi
work=$(mktemp -d /tmp/liubai-e2e.XXXXXX)
go build -C "$repo" -o "$work/liubai" .
"$work/liubai" -web "127.0.0.1:$port" -data-dir "$work/data" > "$work/server.log" 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true; wait $server 2>/dev/null || true' EXIT
i=0
while true; do
  if curl -s -o /dev/null "http://127.0.0.1:$port/"; then
    # A 200 can come from another app that already owns the port; trust it only
    # while our own server process is still alive (it exits on a bind failure).
    if kill -0 "$server" 2>/dev/null; then break; fi
    echo "port $port is already served by another app; the test server exited. See $work/server.log" >&2
    cat "$work/server.log" >&2
    exit 1
  fi
  i=$((i + 1))
  if [ "$i" -ge 150 ] || ! kill -0 "$server" 2>/dev/null; then
    echo "server did not start, see $work/server.log" >&2
    cat "$work/server.log" >&2
    exit 1
  fi
  sleep 0.2
done
python3 "$repo/scripts/$check.py" "http://127.0.0.1:$port"
