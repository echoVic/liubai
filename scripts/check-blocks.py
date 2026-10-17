"""Block handles, pointer dragging, selection and menus. Run via scripts/e2e.sh check-blocks."""
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4196"
ARTIFACTS = Path(tempfile.mkdtemp(prefix="liubai-blocks-qa-"))
TEXT = "第一段。\n\n第二段。\n\n第三段。\n\n第四段。"


def api(page, method, *args):
    r = page.request.post(BASE + "/api", data={"method": method, "args": list(args)}, headers={"Origin": BASE})
    assert r.ok, r.text()
    body = r.json()
    assert not body.get("error"), body
    return body["value"]


def saved(page):
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    return api(page, "State")["current"]


def text(page, value):
    content = page.locator(".cm-content")
    content.focus()
    page.keyboard.press("Meta+a")
    page.keyboard.insert_text(value)
    assert saved(page)["content"] == value


def hover(page, value):
    line = page.locator(".cm-line").filter(has_text=re.compile("^" + re.escape(value) + "$"))
    line.hover()
    grip = page.locator("#block-grip")
    expect(grip).to_be_visible()
    return grip


def action(page, name):
    page.locator('#block-menu [data-menu-action="' + name + '"]').click()


def convert(page, name):
    action(page, "convert")
    page.locator('#block-convert-menu [data-menu-action="' + name + '"]').click()


def drag(page, target, cancel=False):
    grip = page.locator("#block-grip").bounding_box()
    dest = page.locator(".cm-line").filter(has_text=re.compile("^" + re.escape(target) + "$" )).bounding_box()
    page.mouse.move(grip["x"] + grip["width"] / 2, grip["y"] + grip["height"] / 2)
    page.mouse.down()
    page.mouse.move(dest["x"] + 20, dest["y"] + 2, steps=14)
    expect(page.locator(".block-insertion")).to_be_visible()
    if cancel:
        page.keyboard.press("Escape")
    page.mouse.up()


def run(page):
    page.goto(BASE)
    expect(page.locator(".cm-content")).to_be_visible()
    text(page, TEXT)
    grip = hover(page, "第二段。")
    g, line = grip.bounding_box(), page.locator(".cm-line").filter(has_text="第二段。").bounding_box()
    assert g["x"] + g["width"] <= line["x"] and abs(g["y"] - line["y"]) < 12, (g, line)
    page.mouse.move(3, 3)
    expect(grip).to_be_hidden()
    hover(page, "第三段。")
    drag(page, "第一段。")
    assert saved(page)["content"] == "第三段。\n\n第一段。\n\n第二段。\n\n第四段。"
    page.keyboard.press("Meta+z")
    assert saved(page)["content"] == TEXT
    hover(page, "第三段。")
    drag(page, "第一段。", cancel=True)
    assert saved(page)["content"] == TEXT
    hover(page, "第二段。").click()
    expect(page.locator("#block-menu")).to_be_visible()
    expect(page.locator(".cm-block-selected")).to_have_count(1)
    expect(page.locator('#block-menu [data-menu-action="convert"]')).to_be_focused()
    page.keyboard.press("ArrowDown")
    expect(page.locator('#block-menu [data-menu-action="duplicate"]')).to_be_focused()
    page.keyboard.press("Home")
    page.keyboard.press("ArrowRight")
    expect(page.locator('#block-convert-menu [data-menu-action="paragraph"]')).to_be_focused()
    page.keyboard.press("ArrowLeft")
    expect(page.locator('#block-menu [data-menu-action="convert"]')).to_be_focused()
    page.keyboard.press("Escape")
    hover(page, "第三段。").click(modifiers=["Shift"])
    expect(page.locator(".cm-block-selected")).to_have_count(3)  # includes the separator line
    action(page, "up")
    assert saved(page)["content"] == "第二段。\n\n第三段。\n\n第一段。\n\n第四段。"
    text(page, TEXT)
    hover(page, "第二段。").click()
    convert(page, "h2")
    assert saved(page)["content"] == TEXT.replace("第二段。", "## 第二段。")
    page.keyboard.press("Meta+z")
    assert saved(page)["content"] == TEXT
    hover(page, "第一段。").click()
    page.keyboard.press("Escape")
    hover(page, "第三段。").click(modifiers=["Shift"])
    convert(page, "task")
    assert saved(page)["content"] == "- [ ] 第一段。\n\n- [ ] 第二段。\n\n- [ ] 第三段。\n\n第四段。"
    text(page, "- parent\n  - child\n- sibling")
    page.locator(".cm-line").filter(has_text="- parent").click()
    page.keyboard.press("Alt+Shift+ArrowDown")
    assert saved(page)["content"] == "- sibling\n- parent\n  - child"
    text(page, TEXT)
    hover(page, "第二段。")
    page.locator("#block-plus").click()
    expected = TEXT.replace("第二段。\n\n", "第二段。\n\n\n\n")
    current = saved(page)
    assert current["content"] == expected
    assert current["position"]["anchor"] == TEXT.index("第二段。") + len("第二段。\n\n")
    page.keyboard.insert_text("新段落")
    assert "第二段。\n\n新段落\n\n第三段。" in saved(page)["content"]
    text(page, TEXT)
    hover(page, "第一段。")
    page.locator(".cm-content").dispatch_event("compositionstart")
    expect(grip).to_be_hidden()
    page.locator(".cm-line").filter(has_text="第三段。").hover()
    expect(grip).to_be_hidden()
    page.locator(".cm-content").dispatch_event("compositionend")
    hover(page, "第一段。")
    page.locator('[data-view="split"]').click()
    page.locator('#format-bar [data-action="source"]').click()
    page.locator(".cm-line").first.hover()
    expect(grip).to_be_hidden()
    page.locator('#format-bar [data-action="source"]').click()
    hover(page, "第一段。")
    page.locator('[data-view="read"]').click()
    expect(grip).to_be_hidden()
    page.locator('[data-view="single"]').click()
    hover(page, "第一段。")
    page.keyboard.press("Meta+Shift+f")
    expect(grip).to_be_hidden()
    page.keyboard.press("Escape")
    page.locator(".cm-line").first.click()
    page.keyboard.press("Meta+/")
    expect(page.locator("#block-menu")).to_be_visible()
    page.keyboard.press("Escape")
    for theme in ("paper", "warm", "mist", "ink"):
        page.evaluate("theme => document.documentElement.dataset.liubaiTheme=theme", theme)
        hover(page, "第一段。")
        page.screenshot(path=str(ARTIFACTS / (theme + ".png")))
    # A paragraph dragged past a list lands before/after the whole list, which stays intact.
    text(page, "第一段。\n\n- 甲\n  - 乙\n- 丙\n\n尾段。")
    hover(page, "第一段。")
    grip = page.locator("#block-grip").bounding_box()
    last = page.locator(".cm-line").filter(has_text=re.compile("^尾段。$")).bounding_box()
    page.mouse.move(grip["x"] + grip["width"] / 2, grip["y"] + grip["height"] / 2)
    page.mouse.down()
    page.mouse.move(last["x"] + 20, last["y"] + last["height"] + 2, steps=14)
    expect(page.locator(".block-insertion")).to_be_visible()
    page.mouse.up()
    assert saved(page)["content"] == "- 甲\n  - 乙\n- 丙\n\n尾段。\n\n第一段。", saved(page)["content"]
    page.keyboard.press("Meta+z")
    assert saved(page)["content"] == "第一段。\n\n- 甲\n  - 乙\n- 丙\n\n尾段。"
    # Headings and block widgets must not shift CodeMirror's line geometry: margins there broke hover.
    text(page, "# 标题\n\n第一段。\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n第二段。")
    grip = hover(page, "第二段。")
    g, line = grip.bounding_box(), page.locator(".cm-line").filter(has_text="第二段。").bounding_box()
    assert g["x"] + g["width"] <= line["x"] and abs(g["y"] - line["y"]) < 12, (g, line)
    page.evaluate("localStorage.setItem('mygo:locale','en')")
    page.reload()
    expect(page.locator(".cm-content")).to_be_visible()
    hover(page, "第一段。").click()
    expect(page.locator("#block-menu")).to_have_accessible_name("Block actions")
    for label in ("Convert to", "Duplicate", "Delete", "Move up", "Move down"):
        # Move up/down also carry their shortcut (⌥⇧↑/↓) in the accessible name.
        expect(page.locator("#block-menu").get_by_role("menuitem", name=re.compile("^" + re.escape(label) + r"(\s|$)"))).to_be_visible()
    action(page, "convert")
    for label in ("Body", "Heading 1", "Heading 2", "Heading 3", "Bulleted List", "Numbered List", "Task List", "Blockquote", "Code Block"):
        expect(page.locator("#block-convert-menu").get_by_role("menuitem", name=label, exact=True)).to_be_visible()
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")
    print("PASS: handles/visibility, pointer drag/undo/Escape, selection/Shift range, conversions, nested list move, composition, plus/cursor, themes, keyboard menu, English")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, channel=os.environ.get("PLAYWRIGHT_CHANNEL", "chrome"))
    page = browser.new_page(locale="zh-CN", viewport={"width": 1120, "height": 820})
    page.set_default_timeout(7000)
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        run(page)
        assert not errors, errors
    except Exception:
        page.screenshot(path=str(ARTIFACTS / "failure.png"))
        (ARTIFACTS / "errors.json").write_text(json.dumps(errors, ensure_ascii=False))
        raise
    finally:
        print(f"Evidence: {ARTIFACTS}")
        browser.close()
