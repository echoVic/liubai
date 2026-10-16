#!/bin/sh
# Compare performance of a base revision with the working tree on this machine.
# Usage: scripts/bench/run.sh [base-ref] [out-dir]
#   base-ref defaults to 29925c3 (0.3.0); out-dir defaults to docs/performance/raw/<date>.
#   ROUNDS (default 2) repeats every suite; base and head alternate within each round so
#   load changes on a busy machine hit both trees, and the summary keeps the best result.
# Requires Go, Bun 1.4.x (via npx), Python Playwright + Chrome, and installed node_modules.
set -eu
repo=$(cd "$(dirname "$0")/../.." && pwd)
base_ref=${1:-29925c3}
out=${2:-$repo/docs/performance/raw/$(date +%Y-%m-%d)}
rounds=${ROUNDS:-2}
work=$(mktemp -d /tmp/liubai-bench.XXXXXX)
mkdir -p "$out"
bun="npx --yes bun@1.4.3"

mkdir -p "$work/base"
git -C "$repo" archive "$base_ref" | tar -x -C "$work/base"
ln -s "$repo/node_modules" "$work/base/node_modules"
cp "$repo/scripts/bench/legacy_perf_test.go.txt" "$work/base/perf_bench_test.go"

{
  echo "date: $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "base: $base_ref ($(git -C "$repo" rev-parse --short "$base_ref"))"
  echo "head: $(git -C "$repo" rev-parse --short HEAD)$(git -C "$repo" diff --quiet || echo ' (dirty)')"
  echo "rounds: $rounds"
  echo "macOS: $(sw_vers -productVersion) ($(sw_vers -buildVersion))"
  echo "cpu: $(sysctl -n machdep.cpu.brand_string), $(sysctl -n hw.ncpu) cores, $(($(sysctl -n hw.memsize) / 1073741824)) GB"
  echo "go: $(cd "$repo" && go version)"
  echo "bun: $($bun --version)"
  echo "load before: $(uptime | sed 's/.*load averages*: //')"
} > "$out/environment.txt"

for tree in base head; do
  : > "$out/$tree-editor.jsonl"; : > "$out/$tree-preview.jsonl"; : > "$out/$tree-go.txt"
done
round=1
while [ "$round" -le "$rounds" ]; do
  for suite in editor preview go; do
    for tree in base head; do
      dir=$work/base; [ "$tree" = head ] && dir=$repo
      echo "== round $round: $tree $suite"
      case $suite in
        editor) $bun "$repo/scripts/bench/editor.ts" "$dir" >> "$out/$tree-editor.jsonl" ;;
        preview) python3 "$repo/scripts/bench/preview.py" "$dir" >> "$out/$tree-preview.jsonl" ;;
        go) (cd "$dir" && go test -tags perf -run '^$' -bench . -benchtime 20x -count 3 .) >> "$out/$tree-go.txt" ;;
      esac
    done
  done
  echo "load after round $round: $(uptime | sed 's/.*load averages*: //')" >> "$out/environment.txt"
  round=$((round + 1))
done
rm -rf "$work"
python3 "$repo/scripts/bench/summary.py" "$out"
