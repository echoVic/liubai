"""Rich clipboard regression in native WKWebView and AppKit, without a browser."""
import hashlib
import os
import subprocess
import tempfile
import sys
from pathlib import Path

project = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="liubai-rich-clipboard-") as folder:
    work = Path(folder)
    subprocess.run([str(project / "node_modules/.bin/esbuild"), "scripts/rich-clipboard-fixture.ts",
                    "--bundle", "--format=iife", "--global-name=RichClipboardChecks",
                    f"--outfile={work / 'check.js'}"], cwd=project, check=True)
    (work / "check.html").write_text('<!doctype html><meta charset="utf-8"><body><script src="check.js"></script></body>')
    # Compiled once per source version, beside the module cache check-pdf.py shares; the rename keeps a broken build out of the cache.
    cache = Path(tempfile.gettempdir()) / "liubai-check-pdf-module-cache"
    cache.mkdir(exist_ok=True)
    source = project / "scripts/check-rich-clipboard.swift"
    helper = cache / ("check-rich-clipboard-" + hashlib.sha256(source.read_bytes()).hexdigest()[:12])
    if not helper.exists():
        subprocess.run(["swiftc", "-O", "-module-cache-path", str(cache), str(source),
                        "-o", str(work / "check")], check=True, timeout=900)
        os.replace(work / "check", helper)
    subprocess.run([str(helper), str(work / "check.html"), *sys.argv[1:]], check=True, timeout=30)
