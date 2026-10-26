#!/bin/sh
# Compare performance of a base revision with the working tree on this machine.
# Usage: scripts/bench/run.sh [base-ref] [out-dir]
#   base-ref defaults to 29925c3 (0.3.0); out-dir defaults to docs/performance/raw/<date>.
#   ROUNDS (default 2) repeats every suite; base and head alternate within each round so
#   load changes on a busy machine hit both trees, and the summary keeps the best result.
#   SUITES (default "editor preview go webkit") picks the suites. webkit opens each tree's own
#   app in an off-screen WKWebView and needs the screen unlocked and the display awake.
# Requires Go, Bun 1.4.x (via npx), Python Playwright + Chrome, swiftc, and installed node_modules.
set -eu
repo=$(cd "$(dirname "$0")/../.." && pwd)
base_ref=${1:-29925c3}
out=${2:-$repo/docs/performance/raw/$(date +%Y-%m-%d)}
rounds=${ROUNDS:-2}
suites=${SUITES:-editor preview go webkit}
work=$(mktemp -d /tmp/liubai-bench.XXXXXX)
mkdir -p "$out"
bun="npx --yes bun@1.4.3"

mkdir -p "$work/base"
git -C "$repo" archive "$base_ref" | tar -x -C "$work/base"
ln -s "$repo/node_modules" "$work/base/node_modules"
# Trees before the storage benchmark (0.3.0) get the same scenarios written against their own API.
[ -f "$work/base/perf_bench_test.go" ] || cp "$repo/scripts/bench/legacy_perf_test.go.txt" "$work/base/perf_bench_test.go"
# The webkit suite serves each tree's committed web/ bundle from its own server.
(cd "$work/base" && go build -o "$work/base.bin" .)
(cd "$repo" && go build -o "$work/head.bin" .)

{
  echo "date: $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "base: $base_ref ($(git -C "$repo" rev-parse --short "$base_ref^{commit}"))"
  echo "head: $(git -C "$repo" rev-parse --short HEAD)$(git -C "$repo" diff --quiet || echo ' (dirty)')"
  echo "rounds: $rounds"
  echo "macOS: $(sw_vers -productVersion) ($(sw_vers -buildVersion))"
  echo "cpu: $(sysctl -n machdep.cpu.brand_string), $(sysctl -n hw.ncpu) cores, $(($(sysctl -n hw.memsize) / 1073741824)) GB"
  echo "go: $(cd "$repo" && go version)"
  echo "bun: $($bun --version)"
  echo "chrome: $("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --version 2>/dev/null)"
  echo "webkit: $(defaults read /System/Library/Frameworks/WebKit.framework/Resources/Info CFBundleVersion 2>/dev/null)"
  echo "load before: $(uptime | sed 's/.*load averages*: //')"
} > "$out/environment.txt"

for tree in base head; do
  : > "$out/$tree-editor.jsonl"; : > "$out/$tree-preview.jsonl"; : > "$out/$tree-go.txt"; : > "$out/$tree-webkit.jsonl"
  dir=$work/base; [ "$tree" = head ] && dir=$repo
  # What the app loads: the committed web/ bundle, raw and gzip-compressed.
  python3 - "$dir/web" > "$out/$tree-bundle.json" <<'EOF'
import gzip, json, re, sys
from pathlib import Path
web = Path(sys.argv[1])
groups = {"app.js": ["app.js"], "style.css": ["style.css"], "boot.js": ["boot.js"], "lazy chunks": [], "fonts": []}
for f in sorted(web.rglob("*")):
    rel = f.relative_to(web).as_posix()
    if re.match(r"(mermaid-runtime|docx-export)-[0-9a-f]+\.js$", rel): groups["lazy chunks"].append(rel)
    elif rel.startswith("fonts/") and f.is_file(): groups["fonts"].append(rel)
sizes = {k: {"bytes": sum((web / r).stat().st_size for r in v), "gzip": sum(len(gzip.compress((web / r).read_bytes(), 9)) for r in v)} for k, v in groups.items()}
sizes["web/ total"] = {"bytes": sum(f.stat().st_size for f in web.rglob("*") if f.is_file()), "gzip": None}
print(json.dumps(sizes))
EOF
done
round=1
while [ "$round" -le "$rounds" ]; do
  for suite in $suites; do
    for tree in base head; do
      dir=$work/base; [ "$tree" = head ] && dir=$repo
      echo "== round $round: $tree $suite"
      case $suite in
        editor) $bun "$repo/scripts/bench/editor.ts" "$dir" >> "$out/$tree-editor.jsonl" ;;
        preview) python3 "$repo/scripts/bench/preview.py" "$dir" >> "$out/$tree-preview.jsonl" ;;
        go) (cd "$dir" && go test -tags perf -run '^$' -bench . -benchtime 20x -count 3 .) >> "$out/$tree-go.txt" ;;
        webkit) python3 "$repo/scripts/bench/webkit.py" "$dir" "$work/$tree.bin" >> "$out/$tree-webkit.jsonl" ;;
      esac
    done
  done
  echo "load after round $round: $(uptime | sed 's/.*load averages*: //')" >> "$out/environment.txt"
  round=$((round + 1))
done
rm -rf "$work"
python3 "$repo/scripts/bench/summary.py" "$out"
