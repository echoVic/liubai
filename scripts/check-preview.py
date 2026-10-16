"""Run shared Markdown/HTML delivery checks in a real browser DOM.

Requires Python Playwright and Chrome (or PLAYWRIGHT_CHANNEL).
Usage: python3 scripts/check-preview.py
"""
import os
from pathlib import Path
import subprocess
import tempfile

from playwright.sync_api import sync_playwright


project = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix="liubai-render-check-") as folder:
    bundle = Path(folder) / "check.js"
    subprocess.run(
        [
            str(project / "node_modules/.bin/esbuild"),
            "scripts/check-preview.ts",
            "--bundle",
            "--platform=browser",
            "--format=iife",
            "--global-name=PreviewChecks",
            f"--outfile={bundle}",
        ],
        cwd=project,
        check=True,
    )
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True, channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome")
        )
        try:
            page = browser.new_page(locale="zh-CN", )
            page.route("https://example.invalid/**", lambda route: route.abort())
            page.set_content("<!doctype html><html><body></body></html>")
            page.add_script_tag(path=str(bundle))
            print(page.evaluate("() => PreviewChecks.runPreviewChecks()"))
        finally:
            browser.close()
