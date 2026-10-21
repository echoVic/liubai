"""Check PDF pagination with macOS WebKit: A4 pages with text and no heading left at a page's foot.

The app's PrintToPDF (MyGo) also restores the Chinese characters that WebKit's text
layer names as radicals; this check prints with WebKit alone, so it leaves the text be.

Usage: python3 scripts/check-pdf.py
Requires local esbuild, Go and the macOS Swift toolchain; no browser downloads.
"""
import json
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


def main():
    print(f"Evidence: {ARTIFACTS}", flush=True)
    esbuild = str(PROJECT / "node_modules/.bin/esbuild")
    run(esbuild, "scripts/pdf-fixture.ts", "--bundle", "--platform=browser", "--format=iife", f"--outfile={ARTIFACTS / 'fixture.js'}")
    # The stylesheet bundles KaTeX, whose fonts need the same loaders as scripts/build.mjs.
    run(esbuild, "src/style.css", "--bundle", "--loader:.woff2=file", "--loader:.woff=file", "--loader:.ttf=file", "--asset-names=fonts/[name]", f"--outfile={ARTIFACTS / 'style.css'}")
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
