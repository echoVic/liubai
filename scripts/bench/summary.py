"""Summarize a scripts/bench/run.sh output directory as Markdown tables (base vs head).

Each cell shows the range of the per-round results (best–worst); the speed-up
compares the best results.
"""
import json
from pathlib import Path
import re
import sys

out = Path(sys.argv[1])


def jsonl(name):
    rows = {}
    path = out / name
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            row = json.loads(line)
            rows.setdefault((row["scenario"], row["chars"]), []).append(row["ms"])
    return rows


def go(name):
    rows = {}
    path = out / name
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            m = re.match(r"Benchmark(\S+?)-\d+\s+\d+\s+([\d.]+) ns/op", line)
            if m:
                rows.setdefault(m.group(1), []).append(float(m.group(2)) / 1e6)
    return rows


def number(v):
    return f"{v:.3f}" if v < 1 else f"{v:.2f}" if v < 100 else f"{v:.0f}"


def cell(values):
    if not values:
        return "—"
    lo, hi = min(values), max(values)
    return number(lo) if len(values) == 1 or number(lo) == number(hi) else f"{number(lo)}–{number(hi)}"


def ratio(a, b):
    if not a or not b:
        return "—"
    r = min(a) / min(b)
    return f"{r:,.0f}×" if r >= 100 else f"{r:.1f}×"


def table(title, base, head, keyed):
    lines = ["", title, "", f"| {keyed} | base | head | speed-up |", "|---|---:|---:|---:|"]
    for key in sorted(set(base) | set(head)):
        label = f"{key[0]} · {key[1]:,}" if isinstance(key, tuple) else key
        lines.append(f"| {label} | {cell(base.get(key))} | {cell(head.get(key))} | {ratio(base.get(key), head.get(key))} |")
    return lines


lines = ["# Benchmark summary", "", "ms per operation; per-round results as best–worst; speed-up = base best / head best."]
lines += table("## Editor (Bun / JavaScriptCore; each round is the best of 5 batches)", jsonl("base-editor.jsonl"), jsonl("head-editor.jsonl"), "scenario · chars")
lines += table("## Preview render (Chrome; each round is the best of 5 batches)", jsonl("base-preview.jsonl"), jsonl("head-preview.jsonl"), "scenario · chars")
lines += table("## Storage (Go; 3 runs × 20 iterations per round)", go("base-go.txt"), go("head-go.txt"), "benchmark")
text = "\n".join(lines) + "\n"
(out / "summary.md").write_text(text, encoding="utf-8")
print(text)
