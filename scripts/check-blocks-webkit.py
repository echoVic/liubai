#!/usr/bin/env python3
"""Block handles, drag and the slash menu in WebKit (the desktop app's engine), off-screen.

Usage: python3 scripts/check-blocks-webkit.py http://127.0.0.1:<port>   # against a fresh web server
"""
import base64
import hashlib
import io
import zipfile
import json
import os
import subprocess
import tempfile
from pathlib import Path
from checklib import base_url, evidence

PROJECT = Path(__file__).resolve().parents[1]


def main():
    base = base_url() + "/"
    work = evidence("liubai-blocks-webkit-")
    # Compiled once per source version, beside the module cache check-pdf.py shares; the rename keeps a broken build out of the cache.
    cache = Path(tempfile.gettempdir()) / "liubai-check-pdf-module-cache"
    cache.mkdir(exist_ok=True)
    source = PROJECT / "scripts/check-blocks-webkit.swift"
    helper = cache / ("check-blocks-webkit-" + hashlib.sha256(source.read_bytes()).hexdigest()[:12])
    if not helper.exists():
        partial = work / "check-blocks-webkit"
        subprocess.run(["swiftc", "-O", "-module-cache-path", str(cache), str(source), "-o", str(partial)],
                       cwd=PROJECT, check=True, timeout=900)
        os.replace(partial, helper)
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
    assert report["docxCSP"] == [], report
    docx = base64.b64decode(report["docxBase64"])
    (work / "webkit.docx").write_bytes(docx)
    with zipfile.ZipFile(io.BytesIO(docx)) as package:
        assert package.testzip() is None
        xml = package.read("word/document.xml").decode()
        assert 'Heading1' in xml and '<m:f>' in xml and 'Word 中文' in xml, xml
        assert any(path.endswith('.png') for path in package.namelist())
    print("PASS: WebKit hover grip alignment, drag past a list, slash menu inline table input and image selection/resize, KaTeX rendering and bundled font loading, Mermaid SVG and Word OOXML conversion under the app CSP")


main()
