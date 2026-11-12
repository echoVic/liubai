"""Check PDF pagination with macOS WebKit: A4 pages with text and no heading left at a page's foot.

The app's PrintToPDF (MyGo) also restores the Chinese characters that WebKit's text
layer names as radicals; this check prints with WebKit alone, so it leaves the text be.

Usage: python3 scripts/check-pdf.py
Requires local esbuild and the macOS Swift toolchain; no browser downloads.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from checklib import evidence


PROJECT = Path(__file__).resolve().parent.parent
ARTIFACTS = evidence("liubai-pdf-qa-")


def run(*args, env=None, timeout=120):
    return subprocess.run(args, cwd=PROJECT, env=env, check=True, timeout=timeout)


def read_json(helper, command, *paths):
    result = subprocess.run(
        [str(helper), command, *map(str, paths)], cwd=PROJECT,
        check=True, stdout=subprocess.PIPE, text=True, timeout=120,
    )
    (ARTIFACTS / f"{command}-{'-'.join(path.stem for path in paths)}.json").write_text(result.stdout, encoding="utf-8")
    return json.loads(result.stdout)


def main():
    esbuild = str(PROJECT / "node_modules/.bin/esbuild")
    run(esbuild, "scripts/pdf-fixture.ts", "--bundle", "--platform=browser", "--format=iife", f"--outfile={ARTIFACTS / 'fixture.js'}")
    # The stylesheet bundles KaTeX, whose font files need a loader each.
    run(esbuild, "src/style.css", "--bundle", "--loader:.woff2=file", "--loader:.woff=file", "--loader:.ttf=file", "--asset-names=fonts/[name]", f"--outfile={ARTIFACTS / 'style.css'}")
    html = ARTIFACTS / "page.html"
    html.write_text(
        '<!doctype html><html><head><meta charset="utf-8"><title>loading</title>'
        '<link rel="stylesheet" href="style.css"></head>'
        '<body><div id="print-document"></div><script src="fixture.js"></script></body></html>',
        encoding="utf-8",
    )
    # Compiled once per source version, beside a shared module cache: building the helper and the
    # AppKit/WebKit modules takes minutes on a busy machine. The rename keeps a broken build out of the cache.
    cache = Path(tempfile.gettempdir()) / "liubai-check-pdf-module-cache"
    cache.mkdir(exist_ok=True)
    source = PROJECT / "scripts/check-pdf.swift"
    helper = cache / ("check-pdf-" + hashlib.sha256(source.read_bytes()).hexdigest()[:12])
    if not helper.exists():
        partial = ARTIFACTS / "check-pdf"
        run("swiftc", "-O", "-module-cache-path", str(cache), str(source), "-o", str(partial), timeout=900)
        os.replace(partial, helper)
    pdf = ARTIFACTS / "page.pdf"
    run(str(helper), "print", str(html), str(pdf), timeout=60)
    info = read_json(helper, "inspect", pdf)
    size = info["size"]
    assert abs(size["width"] - 595) <= 1 and abs(size["height"] - 842) <= 1, size
    assert info["pages"] >= 5, info["pages"]
    assert len(info["lines"]) == info["pages"], "missing page text"
    # Neither 第 nor 节 is a radical, so the headings read alike in WebKit's text layer.
    for page, lines in enumerate(info["lines"][:-1], start=1):
        assert lines, (page, "empty page")
        assert not re.fullmatch(r"第 \d+ 节", lines[-1]), (page, "stranded heading", lines[-1])
    print(f"PASS: A4, {info['pages']} pages with text, no stranded headings")


if __name__ == "__main__":
    main()
