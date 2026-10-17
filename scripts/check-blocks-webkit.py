#!/usr/bin/env python3
"""Block handles, drag and the slash menu in WebKit (the desktop app's engine), off-screen.

Usage: python3 scripts/check-blocks-webkit.py http://127.0.0.1:<port>   # against a fresh web server
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]


def main():
    base = sys.argv[1].rstrip("/") + "/"
    work = Path(tempfile.mkdtemp(prefix="liubai-blocks-webkit-"))
    helper = work / "check-blocks-webkit"
    cache = Path(tempfile.gettempdir()) / "liubai-check-pdf-module-cache"
    subprocess.run(["swiftc", "-O", "-module-cache-path", str(cache), str(PROJECT / "scripts/check-blocks-webkit.swift"), "-o", str(helper)],
                   cwd=PROJECT, check=True, timeout=900)
    report = json.loads(subprocess.run([str(helper), base], check=True, stdout=subprocess.PIPE, text=True, timeout=120).stdout)
    assert report["typed"] == " 标题||第一段。||第二段。||- 甲|  - 乙|- 丙||第三段。", report
    assert report["hoverShowsGrip"] and report["gripAligned"], report
    assert report["insertionVisible"], report
    assert report["afterDrag"] == " 标题||第三段。||第一段。||第二段。||- 甲|  - 乙|- 丙", report
    assert report["slashMenu"], report
    assert report["tableInput"], report
    assert report["tableMarkdown"] == "前文。\n\n| 表头 | 说明 |\n| --- | --- |\n| 甲WK | 乙 |\n\n尾文。", report
    assert report["imageFixture"] and report["imageSelected"] and report["imageResizeBadge"] and report["imageWidthWritten"], report
    assert report["mathRendered"] and report["mathFontLoaded"], report
    assert report["mermaidRendered"] and report["mermaidCSP"] == [], report
    print("PASS: WebKit hover grip alignment, drag past a list, slash menu inline table input and image selection/resize, KaTeX rendering and bundled font loading, Mermaid SVG under the app CSP")


main()
