"""Rich clipboard regression in native WKWebView and AppKit, without a browser."""
import subprocess
import tempfile
import sys
from pathlib import Path

project = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="liubai-rich-clipboard-") as folder:
    work = Path(folder)
    subprocess.run([str(project / "node_modules/.bin/esbuild"), "scripts/check-rich-clipboard.ts",
                    "--bundle", "--format=iife", "--global-name=RichClipboardChecks",
                    f"--outfile={work / 'check.js'}"], cwd=project, check=True)
    (work / "check.html").write_text('<!doctype html><meta charset="utf-8"><body><script src="check.js"></script></body>')
    helper = work / "check"
    subprocess.run(["swiftc", "-O", str(project / "scripts/check-rich-clipboard.swift"),
                    "-o", str(helper)], check=True, timeout=120)
    subprocess.run([str(helper), str(work / "check.html"), *sys.argv[1:]], check=True, timeout=30)
