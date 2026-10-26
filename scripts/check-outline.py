"""Browser regression for the single outline: beside the text, or a popover from the top bar.

scripts/e2e.sh check-outline
Requires Python Playwright and Chrome (or PLAYWRIGHT_CHANNEL).
"""
import os
import re
import sys

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4196"
TEXT = "# 留白\n\n第一段。\n\n## 一、先写结尾\n\n正文。\n\n## 二、每天一页\n\n正文。\n\n### 晚上读一遍\n\n结尾。\n"


def api(page, method, *args):
    response = page.request.post(BASE + "/api", data={"method": method, "args": list(args)}, headers={"Origin": BASE})
    assert response.ok, response.text()
    body = response.json()
    assert not body.get("error"), body
    return body["value"]


def appearance_change(page, operation):
    with page.expect_response(lambda r: r.url.endswith("/api") and '"Appearance"' in (r.request.post_data or "")) as pending:
        operation()
    assert not pending.value.json().get("error"), pending.value.text()


def saved_position(page, check, timeout=7000):
    for _ in range(timeout // 100):
        current = api(page, "State")["current"]
        if check(current):
            return current
        page.wait_for_timeout(100)
    raise AssertionError(api(page, "State")["current"]["position"])


with sync_playwright() as p:
    browser = p.chromium.launch(channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"))
    page = browser.new_page(viewport={"width": 1512, "height": 900}, locale="zh-CN")
    page.goto(BASE)
    content = page.locator('.cm-content[contenteditable="true"]')
    content.focus(); page.keyboard.press("Meta+a"); page.keyboard.insert_text(TEXT)
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    outline, button = page.locator("#right-outline"), page.locator("#outline-button")
    popover = re.compile(r"\bpopover\b")

    # A docked sidebar holds documents only; the outline is beside the text, once.
    appearance_change(page, lambda: page.locator("#sidebar-button").click())
    expect(page.locator("#drawer")).to_be_visible()
    expect(page.locator("#recent-label")).to_have_text("最近文稿")
    expect(page.locator('#drawer [role="tab"]')).to_have_count(0)
    expect(page.locator(".outline-item:visible")).to_have_count(4)
    expect(outline).to_be_visible(); expect(outline).not_to_have_class(popover)
    expect(button).to_have_attribute("aria-expanded", "true")

    # The button hides it, and the choice survives a reload.
    appearance_change(page, lambda: button.click())
    expect(outline).to_be_hidden(); expect(button).to_have_attribute("aria-expanded", "false")
    assert api(page, "State")["appearance"]["outlineHidden"] is True
    page.reload(); expect(page.locator(".cm-content")).to_be_visible(); expect(outline).to_be_hidden()
    appearance_change(page, lambda: button.click()); expect(outline).to_be_visible()

    # Without room beside the text the button opens the same outline as a popover.
    page.set_viewport_size({"width": 1180, "height": 900})
    expect(outline).to_be_hidden()
    button.click(); expect(outline).to_be_visible(); expect(outline).to_have_class(popover)
    # Focus starts on the current section and arrows move through the list.
    expect(outline.locator('button[aria-current="location"]')).to_be_focused()
    index = lambda: outline.locator("button").evaluate_all("els => els.indexOf(document.activeElement)")
    start = index(); page.keyboard.press("ArrowDown"); assert index() == (start + 1) % 4
    page.keyboard.press("Escape"); expect(outline).to_be_hidden(); expect(button).to_be_focused()
    button.click(); outline.locator("button", has_text="二、每天一页").click()
    expect(outline).to_be_hidden()
    saved_position(page, lambda current: current["position"]["anchor"] == TEXT.index("## 二"))

    # The split view has no room either; a click elsewhere closes the popover.
    page.set_viewport_size({"width": 1512, "height": 900})
    appearance_change(page, lambda: page.locator('[data-view="split"]').click())
    expect(outline).to_be_hidden()
    button.click(); expect(outline).to_have_class(popover)
    page.mouse.click(700, 850); expect(outline).to_be_hidden()

    # The palette command opens the popover there too. Once its dialog has closed, focus is on the current section and the arrows move through the list.
    page.keyboard.press("Meta+k"); page.locator("#command-search").fill("大纲")
    page.evaluate("() => { window.paletteClosed = new Promise(done => document.querySelector('#commands').addEventListener('close', () => setTimeout(done), {once: true})) }")
    page.locator("#command-list button").filter(has_text="大纲").first.click()
    page.evaluate("window.paletteClosed"); expect(page.locator("#commands")).to_be_hidden()
    expect(outline).to_have_class(popover)
    expect(outline.locator('button[aria-current="location"]')).to_be_focused()
    start = index(); page.keyboard.press("ArrowDown"); assert index() == (start + 1) % 4
    page.keyboard.press("Escape"); expect(outline).to_be_hidden(); expect(button).to_be_focused()

    # Back in the single view the palette command does what the button does, and focus mode shows neither.
    appearance_change(page, lambda: page.locator('[data-view="single"]').click())
    expect(outline).to_be_visible()
    page.keyboard.press("Meta+k"); page.locator("#command-search").fill("大纲")
    appearance_change(page, lambda: page.locator("#command-list button").filter(has_text="大纲").first.click())
    expect(outline).to_be_hidden()
    appearance_change(page, lambda: button.click()); expect(outline).to_be_visible()
    page.keyboard.press("Meta+Shift+F"); expect(button).to_be_hidden(); expect(outline).to_be_hidden()
    page.keyboard.press("Escape"); expect(button).to_be_visible(); expect(outline).to_be_visible()

    # With nothing to list the popover still opens, and Esc closes it from the button.
    content.focus(); page.keyboard.press("Meta+a"); page.keyboard.insert_text("只有正文。")
    expect(outline).to_be_hidden()
    button.click(); expect(outline).to_have_class(popover); expect(outline.locator(".dialog-note")).to_be_visible()
    page.keyboard.press("Escape"); expect(outline).to_be_hidden(); expect(button).to_be_focused()

    # A long document lists every heading as soon as it opens, also those far beyond what the editor parses for the screen.
    long_text = "".join(f"## 第 {i} 节\n\n" + "正文。" * 300 + "\n\n" for i in range(1, 301))
    page.goto("about:blank")
    current = api(page, "State")["current"]
    api(page, "Update", {"id": current["id"], "revision": current["revision"], "content": long_text, "position": {"anchor": 0, "head": 0, "scroll": 0, "source": False}})
    page.goto(BASE); expect(page.locator(".cm-content")).to_be_visible()
    items = outline.locator(".outline-item")
    expect(items).to_have_count(300, timeout=15000); expect(items.last).to_have_text("第 300 节")
    # Its last entry jumps to the last section.
    items.last.click()
    saved_position(page, lambda current: current["position"]["anchor"] == long_text.index("## 第 300 节"))
    # Typing that leaves the headings alone keeps the list as it is; a new heading updates it.
    first = items.first.element_handle()
    page.keyboard.press("ArrowDown"); page.keyboard.press("ArrowDown"); page.keyboard.press("End"); page.keyboard.type("字")
    page.wait_for_timeout(800)
    assert first.evaluate("e => e.isConnected"), "typing in a paragraph rebuilt the outline"
    page.keyboard.press("Meta+ArrowUp"); page.keyboard.insert_text("## 新的一节\n\n")
    expect(items).to_have_count(301); expect(items.first).to_have_text("新的一节")
    browser.close()
print("PASS: 大纲只在一处，长文稿打开即列出全部标题")
