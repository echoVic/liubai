"""Opening controls regain focus after dialog dismissal in both engines."""
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from checklib import base_url, launch

BASE = base_url()
FAILURES = []

with sync_playwright() as pw:
    for engine in ("chromium", "webkit"):
        kind = getattr(pw, engine)
        if not Path(kind.executable_path).exists():
            if os.environ.get("REQUIRE_WEBKIT"):
                FAILURES.append("WebKit missing")
            print("SKIP WebKit not installed", flush=True)
            continue
        browser = launch(kind)
        page = browser.new_page(viewport={"width": 1120, "height": 820}, locale="zh-CN")
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
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
        # A completed action that moves focus keeps it: the dialog's close event must not hand focus back to the opener.
        page.locator(".cm-content").focus()
        page.keyboard.press("Meta+k")
        expect(page.locator("#commands")).to_be_visible()
        page.locator("#command-search").fill("查找正文")
        page.keyboard.press("Enter")
        expect(page.locator("#find-query")).to_be_visible()
        page.evaluate("()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
        ok = page.locator("#find-query").evaluate("e=>e===document.activeElement")
        name = f"{engine} Find in Document from All Commands keeps focus in the find field"
        print(("PASS " if ok else "FAIL ") + name, flush=True)
        if not ok:
            FAILURES.append(name)
        page.keyboard.press("Escape")
        page.locator(".cm-content").focus()
        page.keyboard.insert_text("链接")
        page.keyboard.press("Shift+Home")
        page.locator('#format-bar [data-action="link"]').click()
        expect(page.locator("#link-dialog")).to_be_visible()
        page.locator("#link-url").fill("https://example.com")
        page.locator('#link-form [type="submit"]').click()
        expect(page.locator("#link-dialog")).to_be_hidden()
        page.evaluate("()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
        ok = page.evaluate("()=>!!document.activeElement?.closest('.cm-content')")
        name = f"{engine} applying a link from the toolbar returns focus to the editor"
        print(("PASS " if ok else "FAIL ") + name, page.evaluate("()=>({tag:document.activeElement.tagName,id:document.activeElement.id})"), flush=True)
        if not ok:
            FAILURES.append(name)
        browser.close()
        if errors:
            FAILURES.append(f"{engine} page errors: {errors}")
print(f"RESULT failures={len(FAILURES)}", json.dumps(FAILURES), flush=True)
sys.exit(bool(FAILURES))
