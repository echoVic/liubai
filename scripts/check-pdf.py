"""Check PDF pagination, Chinese text mappings and unchanged rendering with macOS WebKit.

Usage: python3 scripts/check-pdf.py
Requires local esbuild, Go and the macOS Swift toolchain; no browser downloads.
"""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


PROJECT = Path(__file__).resolve().parent.parent
ARTIFACTS = Path(tempfile.mkdtemp(prefix="liubai-pdf-qa-"))


def run(*args, env=None, timeout=120):
    return subprocess.run(args, cwd=PROJECT, env=env, check=True, timeout=timeout)


def read_json(helper, command, *paths):
    result = subprocess.run(
        [str(helper), command, *map(str, paths)], cwd=PROJECT,
        check=True, stdout=subprocess.PIPE, text=True, timeout=120,
    )
    (ARTIFACTS / f"{command}-{'-'.join(path.stem for path in paths)}.json").write_text(result.stdout, encoding="utf-8")
    return json.loads(result.stdout)


def has_radicals(text):
    return any(0x2E80 <= ord(char) <= 0x2FDF for char in text)


def main():
    print(f"Evidence: {ARTIFACTS}", flush=True)
    esbuild = str(PROJECT / "node_modules/.bin/esbuild")
    run(esbuild, "scripts/pdf-fixture.ts", "--bundle", "--platform=browser", "--format=iife", f"--outfile={ARTIFACTS / 'fixture.js'}")
    run(esbuild, "src/style.css", "--bundle", f"--outfile={ARTIFACTS / 'style.css'}")
    html = ARTIFACTS / "page.html"
    html.write_text(
        '<!doctype html><html><head><meta charset="utf-8"><title>loading</title>'
        '<link rel="stylesheet" href="style.css"></head>'
        '<body><div id="print-document"></div><script src="fixture.js"></script></body></html>',
        encoding="utf-8",
    )
    helper = ARTIFACTS / "check-pdf"
    # A shared module cache: building AppKit/WebKit modules from scratch takes minutes on a busy machine.
    cache = Path(tempfile.gettempdir()) / "liubai-check-pdf-module-cache"
    run("swiftc", "-O", "-module-cache-path", str(cache),
        str(PROJECT / "scripts/check-pdf.swift"), "-o", str(helper), timeout=900)
    raw, fixed = ARTIFACTS / "raw.pdf", ARTIFACTS / "fixed.pdf"
    run(str(helper), "print", str(html), str(raw), timeout=60)
    go_env = dict(os.environ, LIUBAI_PDF_IN=str(raw), LIUBAI_PDF_OUT=str(fixed))
    run("go", "test", "-run", "^TestFixPDFFile$", "-count=1", ".", env=go_env)
    raw_info, fixed_info = [read_json(helper, "inspect", path) for path in (raw, fixed)]
    print(f"Raw PDF radical aliases present: {has_radicals(raw_info['text'])}", flush=True)
    for name, info in (("raw.pdf", raw_info), ("fixed.pdf", fixed_info)):
        size = info["size"]
        assert abs(size["width"] - 595) <= 1 and abs(size["height"] - 842) <= 1, (name, size)
        assert info["pages"] >= 5, (name, info["pages"])
        assert len(info["lines"]) == info["pages"], (name, "missing page text")
        for page, lines in enumerate(info["lines"][:-1], start=1):
            assert lines, (name, page, "empty page")
            assert not re.fullmatch(r"第 \d+ 节", lines[-1]), (name, page, "stranded heading", lines[-1])
    assert not has_radicals(fixed_info["text"]), "fixed.pdf still contains CJK radical aliases"
    for text in ("长文导出测试", "第 1 节", "第 40 节", "全文结束标记：尾声。"):
        assert text in fixed_info["text"], ("missing PDF text", text)
    comparison = read_json(helper, "compare", raw, fixed)
    assert comparison["pages"] == raw_info["pages"] == fixed_info["pages"], comparison
    assert comparison["identical"] and comparison["maxDiff"] == 0, comparison
    print(f"PASS: A4, {fixed_info['pages']} pages, no stranded headings, searchable Chinese text, identical PDF pixels")


if __name__ == "__main__":
    main()
