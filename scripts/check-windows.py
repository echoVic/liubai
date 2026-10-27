"""Windows platform regression: shortcut names, F8, redo, quick note keys,
fonts, scrollbars and title bar room, with navigator.platform reporting Win32,
and the same page on macOS for comparison. Run against -web with its own data
directory:

python3 scripts/check-windows.py http://127.0.0.1:4196
Requires Python Playwright and Chrome (or PLAYWRIGHT_CHANNEL).
"""
import os
from pathlib import Path
import re
import sys
import tempfile
import uuid

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4196"
ARTIFACTS = Path(tempfile.mkdtemp(prefix="liubai-windows-qa-"))
WIN32 = "Object.defineProperty(Navigator.prototype, 'platform', {get: () => 'Win32'})"
MAC_SYMBOLS = "⌘⇧⌥⌃↩"
FIXTURE = "[示例](https://example.com)\n\n正文\n"


def api(page, method, *args):
    response = page.request.post(BASE + "/api", data={"method": method, "args": list(args)}, headers={"Origin": BASE})
    assert response.ok, response.text()
    result = response.json()
    assert not result.get("error"), result
    return result["value"]


def open_editor(context):
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    # Write the fixture before the page loads, so no save of the page races it.
    current = api(page, "State")["current"]
    api(page, "Update", {"id": current["id"], "revision": current["revision"], "content": FIXTURE, "position": {"anchor": 0, "head": 0, "scroll": 0, "source": False}})
    page.goto(BASE)
    expect(page.locator(".cm-content")).to_be_visible()
    expect(page.locator(".cm-content .md-link").first).to_be_visible()
    return page, errors


def style(page, selector, prop):
    return page.evaluate("([s, p]) => getComputedStyle(document.querySelector(s))[p]", [selector, prop])


def topbar_padding(page, left=None):
    # The web version has no window buttons; give the page MyGo's title bar insets.
    return page.evaluate("""left => {
        document.body.classList.add('desktop');
        if (left === null) document.documentElement.style.removeProperty('--mygo-titlebar-inset-left');
        else document.documentElement.style.setProperty('--mygo-titlebar-inset-left', left);
        document.documentElement.style.setProperty('--mygo-titlebar-inset-right', '138px');
        const s = getComputedStyle(document.querySelector('.topbar'));
        const padding = [s.paddingLeft, s.paddingRight];
        document.body.classList.remove('desktop');
        document.documentElement.style.removeProperty('--mygo-titlebar-inset-left');
        document.documentElement.style.removeProperty('--mygo-titlebar-inset-right');
        return padding;
    }""", left)


def palette_keys(page, modifier):
    page.locator(".cm-content").click()
    page.keyboard.press(modifier + "+k")
    expect(page.locator("#command-list button").first).to_be_visible()
    keys = page.locator("#command-list kbd").all_inner_texts()
    page.keyboard.press("Escape")
    return [k for k in keys if k]


def mac_symbols_outside_documents(page):
    return page.evaluate("""symbols => {
        const has = text => [...symbols].some(s => (text || '').includes(s));
        const found = [];
        for (const el of document.querySelectorAll('body *')) {
            if (el.closest('.cm-content, #preview-content, #print-document')) continue;
            for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE && has(node.textContent)) found.push(node.textContent);
            for (const attr of ['title', 'aria-label', 'placeholder', 'data-tip', 'aria-keyshortcuts']) if (has(el.getAttribute(attr))) found.push(attr + ': ' + el.getAttribute(attr));
        }
        return found;
    }""", MAC_SYMBOLS)


def capture_saves_with(context, saves, ignored, hint):
    page = context.new_page()
    page.goto(BASE + "/capture.html")
    field = page.get_by_placeholder("记下这一刻……")
    expect(field).to_be_focused()
    expect(page.locator("#capture-status")).to_have_text(hint)
    before = len(api(page, "State")["recent"])
    title = "平台随手记 " + uuid.uuid4().hex[:8]
    field.fill(title)
    field.press(ignored)
    page.wait_for_timeout(200)
    expect(field).to_have_value(title)
    assert len(api(page, "State")["recent"]) == before, ignored + " saved a quick note"
    field.press(saves)
    expect(field).to_have_value("")
    assert api(page, "State")["recent"][0]["title"] == title
    page.close()


def windows(context):
    page, errors = open_editor(context)
    expect(page.locator("html")).to_have_class(re.compile(r"\bwindows\b"))
    expect(page.locator('button.tool[data-action="new"]')).to_have_attribute("aria-keyshortcuts", "Control+N")
    expect(page.locator('#format-bar [data-action="bold"]')).to_have_attribute("aria-keyshortcuts", "Control+B")
    # The tooltip writes the keys for this platform as it shows.
    for selector, label, keys in [('[data-view="split"]', "编辑区和阅读视图并排", "Ctrl+\\"), ('[data-view="read"]', "只显示排好版的文稿", "Ctrl+Shift+R"), ('#format-bar [data-action="bold"]', "加粗", "Ctrl+B"), ('#format-bar [data-action="redo"]', "重做", "Ctrl+Y"), ('#format-bar [data-action="strike"]', "删除线", "Ctrl+Shift+X"), ("#heading-button", "标题级别", "Ctrl+1–6")]:
        page.locator(selector).hover()
        expect(page.locator("#tooltip")).to_be_visible()
        expect(page.locator(selector)).to_have_attribute("aria-describedby", "tooltip")
        expect(page.locator("#tooltip span")).to_have_text(label)
        expect(page.locator("#tooltip kbd")).to_have_text(keys)
    page.mouse.move(5, 500)
    expect(page.locator('#more-menu [data-menu-action="new"] kbd')).to_have_text("Ctrl+N")
    expect(page.locator('#more-menu [data-menu-action="focus"] kbd')).to_have_text("F8")
    expect(page.locator('#block-menu [data-menu-action="up"] kbd')).to_have_text("Alt+Shift+↑")
    expect(page.locator(".cm-content .md-link").first).to_have_attribute("title", "Ctrl 点击打开链接")
    found = mac_symbols_outside_documents(page)
    assert not found, found
    keys = palette_keys(page, "Control")
    assert "Ctrl+N" in keys and "F8" in keys and "Ctrl+Y" in keys and "Ctrl+1" in keys and "Ctrl+Shift+7" in keys and "Ctrl+I" in keys, keys
    assert not [k for k in keys if any(s in k for s in MAC_SYMBOLS)], keys

    # F8 is focus mode on Windows; Escape leaves it.
    page.locator(".cm-content").click()
    page.keyboard.press("F8")
    expect(page.locator("body")).to_have_class(re.compile(r"\bfocus-mode\b"))
    page.keyboard.press("Escape")
    expect(page.locator("body")).not_to_have_class(re.compile(r"\bfocus-mode\b"))

    # Ctrl+Z undoes; both Ctrl+Y and Ctrl+Shift+Z redo. Keys, not a click, place
    # the caret: click-then-type races CodeMirror's selection handling under load.
    page.locator(".cm-content").focus()
    expect(page.locator(".cm-content")).to_be_focused()
    page.keyboard.press("Control+End")
    page.keyboard.type("续写")
    last = page.locator(".cm-content .cm-line").last
    expect(last).to_have_text("续写")
    # A real Shift+Z reports the key "Z"; Playwright would send "z" for Control+Shift+z.
    for redo in ["Control+y", "Control+Shift+Z"]:
        page.keyboard.press("Control+z")
        expect(last).not_to_have_text("续写")
        page.keyboard.press(redo)
        expect(last).to_have_text("续写")

    # Headings, lists and inline formats on Ctrl. Ctrl+Alt is AltGr, and the Windows key is not Ctrl.
    def saved(text):
        expect(page.locator("#save-status")).to_have_text("草稿已保存")
        assert api(page, "State")["current"]["content"] == text, api(page, "State")["current"]["content"]
    page.keyboard.press("Control+a")
    page.keyboard.insert_text("平台标题")
    page.keyboard.press("Control+1")
    saved("# 平台标题")
    for keys in ("Control+Alt+2", "Meta+2"):
        page.keyboard.press(keys)
    page.wait_for_timeout(300)
    saved("# 平台标题")
    page.keyboard.press("Control+0")
    saved("平台标题")
    page.keyboard.press("Control+Shift+7")
    saved("1. 平台标题")
    page.keyboard.press("Control+Shift+7")
    saved("平台标题")
    page.keyboard.press("Control+a")
    page.keyboard.press("Control+i")
    saved("_平台标题_")
    expect(page.locator('#heading-menu [data-menu-action="paragraph"] kbd')).to_have_text("Ctrl+0")
    expect(page.locator('#heading-menu [data-menu-action="h6"] kbd')).to_have_text("Ctrl+6")
    expect(page.locator('#heading-menu [data-menu-action="h1"]')).to_have_attribute("aria-keyshortcuts", "Control+1")

    assert "Microsoft YaHei" in style(page, ".cm-content", "fontFamily"), style(page, ".cm-content", "fontFamily")
    assert "Segoe UI" in style(page, "body", "fontFamily"), style(page, "body", "fontFamily")
    assert style(page, ".cm-scroller", "scrollbarWidth") == "thin"
    assert topbar_padding(page) == ["24px", "150px"], topbar_padding(page)

    # The web server runs on macOS, so its default is ⌃⌥⌘N: Windows writes Cmd as Win.
    page.locator(".cm-content").click()
    page.keyboard.press("Control+k")
    page.locator("#command-search").fill("随手记设置")
    page.locator("#command-list button").first.click()
    expect(page.locator("#capture-settings")).to_be_visible()
    expect(page.locator("#capture-shortcut")).to_have_value("Ctrl+Alt+Win+N")
    expect(page.locator('#capture-settings [data-i18n="fUseTheShortcutInAnyAppToWriteA"]')).to_have_text("在任何应用里按快捷键，写一句话，Ctrl+Enter 存为草稿。")
    page.screenshot(path=str(ARTIFACTS / "windows.png"))
    page.keyboard.press("Escape")
    assert not errors, errors
    capture_saves_with(context, "Control+Enter", "Meta+Enter", "Ctrl+Enter 存为草稿 · Esc 关闭")


def mac(context):
    page, errors = open_editor(context)
    expect(page.locator("html")).not_to_have_class(re.compile(r"\bwindows\b"))
    expect(page.locator('button.tool[data-action="new"]')).to_have_attribute("aria-keyshortcuts", "Meta+N")
    page.locator('#format-bar [data-action="redo"]').hover()
    expect(page.locator("#tooltip")).to_be_visible()
    expect(page.locator("#tooltip kbd")).to_have_text("⌘⇧Z")
    page.mouse.move(5, 500)
    expect(page.locator('#more-menu [data-menu-action="focus"] kbd')).to_have_text("⌘⇧F")
    expect(page.locator(".cm-content .md-link").first).to_have_attribute("title", "⌘ 点击打开链接")
    keys = palette_keys(page, "Meta")
    assert "⌘ N" in keys and "⌘ ⇧ F" in keys and "⌘ 1" in keys and "⌘ ⇧ 7" in keys, keys
    assert style(page, ".cm-scroller", "scrollbarWidth") == "auto"
    for inset, padding in [("76px", "88px"), ("0px", "24px"), (None, "88px")]:
        actual = topbar_padding(page, inset)
        assert actual[0] == padding, (inset, actual)
    page.screenshot(path=str(ARTIFACTS / "mac.png"))
    assert not errors, errors
    capture_saves_with(context, "Meta+Enter", "Control+Enter", "⌘↩ 存为草稿 · Esc 关闭")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"))
    try:
        for name, run, script in [("windows", windows, WIN32), ("mac", mac, None)]:
            with browser.new_context(locale="zh-CN", viewport={"width": 1120, "height": 820}) as context:
                context.set_default_timeout(7000)
                if script:
                    context.add_init_script(script)
                try:
                    run(context)
                except Exception:
                    for index, page in enumerate(context.pages):
                        page.screenshot(path=str(ARTIFACTS / f"failure-{name}-{index}.png"))
                    raise
        print("PASS: Windows shortcut names, menu hints, palette, F8, redo, quick note keys, fonts, scrollbars and title bar room; macOS unchanged")
    finally:
        print(f"Evidence: {ARTIFACTS}")
        browser.close()
