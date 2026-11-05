"""Opening controls regain focus after dialog dismissal in both engines."""
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1]
FAILURES = []

with sync_playwright() as pw:
    for engine in ("chromium", "webkit"):
        kind = getattr(pw, engine)
        if not Path(kind.executable_path).exists():
            if os.environ.get("REQUIRE_WEBKIT"):
                FAILURES.append("WebKit missing")
            print("SKIP WebKit not installed", flush=True)
            continue
        browser = kind.launch(headless=True)
        page = browser.new_page(viewport={"width": 1120, "height": 820}, locale="zh-CN")
        page.goto(BASE, wait_until="networkidle")
        page.locator('[data-view="single"]').click()
        for selector, dialog in [
            ('[data-action="deliver"]', "delivery-dialog"),
            ("#doc-title", "rename-dialog"),
            ('[data-action="settings"]', "appearance"),
            ('#format-bar [data-action="link"]', "link-dialog"),
        ]:
            trigger = page.locator(selector)
            for how in ("click", "Enter"):
                for close in ("Escape", "button"):
                    page.locator(".cm-content").focus()
                    if how == "click":
                        trigger.click()
                    else:
                        trigger.focus()
                        page.keyboard.press("Enter")
                    expect(page.locator("#" + dialog)).to_be_visible()
                    if close == "Escape":
                        page.keyboard.press("Escape")
                    else:
                        page.locator(f'[data-close="{dialog}"]').click()
                    expect(page.locator("#" + dialog)).to_be_hidden()
                    page.evaluate("()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
                    ok = trigger.evaluate("e=>e===document.activeElement")
                    name = f"{engine} {dialog} {how}/{close} restores trigger"
                    print(("PASS " if ok else "FAIL ") + name,
                          page.evaluate("()=>({tag:document.activeElement.tagName,id:document.activeElement.id})"),
                          flush=True)
                    if not ok:
                        FAILURES.append(name)
        browser.close()
print(f"RESULT failures={len(FAILURES)}", json.dumps(FAILURES), flush=True)
sys.exit(bool(FAILURES))
