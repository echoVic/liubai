"""English/Chinese interface regression. Run against -web with an isolated data dir.

python3 scripts/check-english.py http://127.0.0.1:4199
Requires Python Playwright and Chrome (or PLAYWRIGHT_CHANNEL).
"""
import json
import os
from pathlib import Path
import sys
import tempfile

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4199"
ARTIFACTS = Path(tempfile.mkdtemp(prefix="liubai-english-qa-"))


def chrome_is_english(page):
    # Document titles, excerpts, editor and rendered content belong to the user.
    # Language autonyms intentionally name each language in its own script.
    offending = page.evaluate("""() => {
        const skip = '#doc-title, #document-kind, .cm-content, #preview-content, #print-document, .recent-item b, .recent-item p, .outline-item, #missing-list, #table-grid input, #rename-input, #link-text, #link-url';
        const cjk = /[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}]/u;
        const found = [];
        for (const el of document.querySelectorAll('body *')) {
            if (el.closest(skip) || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
            if (el.closest('[data-language-autonym]')) continue;
            for (const text of el.childNodes) if (text.nodeType === Node.TEXT_NODE && cjk.test(text.textContent)) found.push(text.textContent);
            for (const attr of ['title', 'aria-label', 'placeholder']) if (cjk.test(el.getAttribute(attr) || '')) found.push(el.getAttribute(attr));
        }
        return found;
    }""")
    assert not offending, offending


def palette(page, text):
    page.keyboard.press("Meta+k")
    page.locator("#command-search").fill(text)
    page.locator("#command-list button").filter(has_text=text).first.click()


def english(context):
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE)
    expect(page.locator(".cm-content")).to_be_visible()
    expect(page.locator('html')).to_have_attribute("lang", "en")
    expect(page.locator('[data-view="single"]')).to_have_text("Edit")
    expect(page.locator('[data-view="split"]')).to_have_text("Split")
    expect(page.locator('[data-view="read"]')).to_have_text("Read")
    expect(page.locator(".export-label")).to_have_text("Export")
    expect(page.locator('#format-bar [data-action="bold"]')).to_have_attribute("aria-label", "Bold")
    chrome_is_english(page)
    page.locator("#more-button").click()
    expect(page.locator('[data-menu-action="new"]')).to_contain_text("New Document")
    expect(page.locator('[data-menu-action="commands"]')).to_contain_text("All Commands…")
    expect(page.locator('[data-menu-action="captureSettings"]')).to_contain_text("Quick Note Settings…")
    chrome_is_english(page)
    page.keyboard.press("Escape")

    page.locator("#sidebar-button").click()
    expect(page.locator("#recent-tab")).to_have_text("Recent Documents")
    expect(page.locator("#outline-tab")).to_have_text("Outline")
    chrome_is_english(page)
    page.keyboard.press("Escape")

    page.locator('[data-action="deliver"]').click()
    expect(page.locator("#delivery-dialog h2")).to_have_text("Export This Page")
    expect(page.locator('[data-deliver="pdf"] b')).to_have_text("Export PDF")
    chrome_is_english(page)
    page.keyboard.press("Escape")
    page.locator('[data-action="theme"]').click()
    expect(page.locator("#appearance h2")).to_have_text("Appearance and Typography")
    expect(page.locator("#themes")).to_contain_text("Paper")
    expect(page.locator('#line-width option[value="full"]')).to_have_text("Full Width")
    chrome_is_english(page)
    page.keyboard.press("Escape")

    page.locator("#more-button").click()
    page.locator('[data-menu-action="captureSettings"]').click()
    # The dialog opens after its settings load; wait for it before pressing Escape.
    expect(page.locator("#capture-settings")).to_be_visible()
    expect(page.locator("#capture-settings h2")).to_have_text("Quick Note")
    expect(page.locator("#capture-web-note")).to_have_text("Quick Note is available in the desktop app.")
    chrome_is_english(page)
    page.keyboard.press("Escape")
    expect(page.locator("#capture-settings")).to_be_hidden()

    # A real edit exercises structured save status and ICU singular/plural counts.
    page.locator("#more-button").click()
    with page.expect_response(lambda r: r.url.endswith('/api') and r.request.post_data_json.get('method') == 'New'):
        page.locator('[data-menu-action="new"]').click()
    expect(page.locator("#save-status")).to_have_text("Draft saved")
    expect(page.locator("#doc-title")).to_have_text("Untitled Document")
    page.locator("#doc-title").click()
    page.locator("#rename-input").fill("我的标题")
    page.locator('#rename-form button[type="submit"]').click()
    expect(page.locator("#doc-title")).to_have_text("我的标题")
    palette(page, "简体中文")
    expect(page.locator('[data-view="single"]')).to_have_text("编辑")
    expect(page.locator("#doc-title")).to_have_text("我的标题")
    palette(page, "English")
    expect(page.locator('[data-view="single"]')).to_have_text("Edit")
    expect(page.locator("#doc-title")).to_have_text("我的标题")
    page.locator(".cm-content").click()
    page.keyboard.insert_text("hello")
    expect(page.locator("#save-status")).to_have_text("Draft saved")
    expect(page.locator("#word-count")).to_have_text("1 word")
    page.keyboard.insert_text(" world")
    expect(page.locator("#word-count")).to_have_text("2 words")
    expect(page.locator("#save-status")).to_have_text("Draft saved")
    chrome_is_english(page)

    def failed_file_save(route):
        if route.request.post_data_json.get("method") == "Update":
            result = route.fetch().json()
            result["value"]["statusCode"] = "fileSaveFailed"
            result["value"]["status"] = "Unrelated legacy prose"
            route.fulfill(status=200, content_type="application/json", body=json.dumps(result))
        else:
            route.continue_()

    page.route(BASE + "/api", failed_file_save)
    page.keyboard.press("Meta+s")
    expect(page.locator("#save-status")).to_have_text("Draft retained; file save failed")
    expect(page.locator("#banner-text")).to_have_text("Draft retained; file save failed")
    page.unroute(BASE + "/api", failed_file_save)

    def readonly_file_save(route):
        if route.request.post_data_json.get("method") == "Update":
            result = route.fetch().json()
            result["value"].update(statusCode="fileReadOnly", status="Unrelated legacy prose", conflict=False)
            route.fulfill(status=200, content_type="application/json", body=json.dumps(result))
        else:
            route.continue_()

    page.route(BASE + "/api", readonly_file_save)
    page.keyboard.press("Meta+s")
    expect(page.locator("#banner-text")).to_have_text("The file is read-only. Your changes are kept in the draft.")
    expect(page.locator("#retry-save")).to_be_visible()
    expect(page.locator("#retry-save")).to_have_text("Retry Save")
    expect(page.locator("#banner-save-as")).to_be_visible()
    expect(page.locator("#banner-save-as")).to_have_text("Save As…")
    expect(page.locator("#reload-disk")).to_be_hidden()
    expect(page.locator("#overwrite-disk")).to_be_hidden()
    chrome_is_english(page)
    page.unroute(BASE + "/api", readonly_file_save)
    page.keyboard.press("Meta+s")
    expect(page.locator("#save-status")).to_have_text("Draft saved")

    palette(page, "简体中文")
    expect(page.locator('[data-view="single"]')).to_have_text("编辑")
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    expect(page.locator("#word-count")).to_have_text("2 字")
    expect(page.locator(".cm-content")).to_have_text("hello world")
    palette(page, "English")
    expect(page.locator('[data-view="single"]')).to_have_text("Edit")
    expect(page.locator(".cm-content")).to_have_text("hello world")
    page.locator(".cm-content").click()
    page.keyboard.press("Meta+z")
    expect(page.locator(".cm-content")).not_to_have_text("hello world")
    page.keyboard.press("Meta+Shift+z")
    expect(page.locator(".cm-content")).to_have_text("hello world")
    expect(page.locator("#save-status")).to_have_text("Draft saved")
    palette(page, "简体中文")
    page.reload()
    expect(page.locator('[data-view="single"]')).to_have_text("编辑")
    palette(page, "English")
    expect(page.locator('[data-view="single"]')).to_have_text("Edit")
    palette(page, "Follow System")
    expect(page.locator('[data-view="single"]')).to_have_text("Edit")
    assert page.evaluate("localStorage.getItem('mygo:locale')") is None

    capture = context.new_page()
    capture.goto(BASE + "/capture.html")
    expect(capture.locator("#capture-text")).to_have_attribute("placeholder", "Capture this moment…")
    expect(capture.locator("#capture-save")).to_have_text("Save as Draft")
    chrome_is_english(capture)
    capture.close()
    page.screenshot(path=str(ARTIFACTS / "english.png"))
    assert not errors, errors


def chinese(context):
    page = context.new_page()
    page.goto(BASE)
    expect(page.locator(".cm-content")).to_be_visible()
    expect(page.locator('html')).to_have_attribute("lang", "zh-Hans")
    expect(page.locator('[data-view="single"]')).to_have_text("编辑")
    expect(page.locator(".export-label")).to_have_text("导出")
    expect(page.locator('#format-bar [data-action="bold"]')).to_have_attribute("aria-label", "加粗")
    page.locator("#sidebar-button").click()
    expect(page.locator("#recent-tab")).to_have_text("最近文稿")
    expect(page.locator("#outline-tab")).to_have_text("大纲")
    page.screenshot(path=str(ARTIFACTS / "chinese.png"))


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"))
    try:
        with browser.new_context(locale="en-US", viewport={"width": 1120, "height": 820}) as context:
            context.set_default_timeout(7000)
            try:
                english(context)
            except Exception:
                for index, page in enumerate(context.pages):
                    page.screenshot(path=str(ARTIFACTS / f"failure-{index}.png"))
                raise
        with browser.new_context(locale="zh-CN", viewport={"width": 1120, "height": 820}) as context:
            chinese(context)
        print("PASS: English chrome, dialogs/full width option, capture, save status, word plurals, live/persisted language switching, undo, Chinese browser matching")
    finally:
        print(f"Evidence: {ARTIFACTS}")
        browser.close()
