"""Browser regression for the word count: a worker counts, so a long document never holds up the page.

scripts/e2e.sh check-word-count
Requires Python Playwright and Chrome (or PLAYWRIGHT_CHANNEL).
"""
import os
import sys

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4196"
# Records the workers the page starts.
RECORD = "window.__workers=[];const W=window.Worker;window.Worker=class extends W{constructor(url,options){super(url,options);window.__workers.push(String(url))}};"
# A browser without workers.
NO_WORKERS = "delete window.Worker;window.Worker=undefined;"
SENTENCE = "这是十个字的一句话。Hello world.\n\n"  # 9 Han characters and 2 words.


def api(page, method, *args):
    response = page.request.post(BASE + "/api", data={"method": method, "args": list(args)}, headers={"Origin": BASE})
    assert response.ok, response.text()
    body = response.json()
    assert not body.get("error"), body
    return body["value"]


def open_with(browser, script, text):
    page = browser.new_page(locale="zh-CN")
    page.add_init_script(script)
    current = api(page, "State")["current"]
    api(page, "Update", {"id": current["id"], "revision": current["revision"], "content": text, "position": {"anchor": 0, "head": 0, "scroll": 0, "source": False}})
    page.goto(BASE)
    expect(page.locator(".cm-content")).to_be_visible()
    return page


with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"))
    # A worker counts, also a document of about a million characters, and typing updates the count.
    page = open_with(browser, RECORD, SENTENCE * 40000)
    expect(page.locator("#word-count")).to_have_text("440,000 字", timeout=15000)
    assert any(url.endswith("stats-worker.js") for url in page.evaluate("window.__workers")), page.evaluate("window.__workers")
    page.locator(".cm-content").focus(); page.keyboard.press("Meta+ArrowUp"); page.keyboard.insert_text("新")
    expect(page.locator("#word-count")).to_have_text("440,001 字")
    page.close()
    # Without workers the page counts itself.
    page = open_with(browser, NO_WORKERS, SENTENCE * 3)
    expect(page.locator("#word-count")).to_have_text("33 字")
    page.close()
    browser.close()
print("PASS: 字数在 worker 中统计，长文稿与无 worker 时都正确")
