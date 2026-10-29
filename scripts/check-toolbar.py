"""Browser regression for the approved toolbar. Use an isolated --data-dir.

python3 scripts/check-toolbar.py http://127.0.0.1:4197
Requires Python Playwright and Chrome (or PLAYWRIGHT_CHANNEL).
"""
import json
import os
from pathlib import Path
import re
import sys
import tempfile

from playwright.sync_api import expect, sync_playwright


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4197"
ARTIFACTS = Path(tempfile.mkdtemp(prefix="liubai-toolbar-qa-"))
THEMES = json.loads((Path(__file__).resolve().parent.parent / "src" / "themes.json").read_text())
TEXT = "# 一\n\n第一段。\n\n## 二\n\n第二段。"


def api(page, method, *args):
    response = page.request.post(BASE + "/api", data={"method": method, "args": list(args)}, headers={"Origin": BASE})
    assert response.ok, response.text()
    body = response.json()
    assert not body.get("error"), body
    return body["value"]


def set_theme(page, theme):
    """Paint a theme the way the app does, both root attributes. Assert right after: the app repaints the stored theme on its next minute tick or window focus."""
    scheme = "dark" if next(t["dark"] for t in THEMES if t["id"] == theme) else "light"
    page.evaluate("([theme, scheme]) => { const root = document.documentElement; root.dataset.liubaiTheme = theme; root.dataset.liubaiScheme = scheme }", [theme, scheme])


def saved_position(page, check, timeout=7000):
    """Poll the persisted position; Playwright treats an async wait_for_function predicate as already true."""
    for _ in range(timeout // 100):
        current = api(page, "State")["current"]
        if check(current):
            return current
        page.wait_for_timeout(100)
    raise AssertionError(api(page, "State")["current"]["position"])



def appearance_change(page, operation):
    with page.expect_response(lambda r: r.url.endswith("/api") and '"UpdateAppearance"' in (r.request.post_data or "")) as pending:
        operation()
    assert not pending.value.json().get("error"), pending.value.text()


def select_view(page, view):
    appearance_change(page, lambda: page.locator(f'[data-view="{view}"]').click())
    assert_view(page, view)


def assert_view(page, view):
    expect(page.locator('.view-switch [aria-checked="true"]')).to_have_count(1)
    expect(page.locator(f'[data-view="{view}"]')).to_have_attribute("aria-checked", "true")
    assert page.locator('.view-switch button').evaluate_all("els => els.filter(el => el.tabIndex === 0).map(el => el.dataset.view)") == [view]
    assert api(page, "State")["appearance"]["layout"] == view


def more_action(page, action):
    page.locator("#more-button").click()
    page.locator(f'#more-menu [data-menu-action="{action}"]').click()


def accessible_buttons(page):
    for button in page.locator('.topbar button:visible, #format-bar button:visible, #heading-menu button:visible, #drawer button:visible, #more-menu button:visible').all():
        expect(button).to_have_accessible_name(re.compile(r"\S"))
        # SVG-only controls and the × recent-removal control need tooltips.
        if button.locator("svg").count() and not button.inner_text().strip() or button.inner_text().strip() == "×":
            assert button.get_attribute("data-tip"), button.evaluate("el => el.outerHTML")
            assert button.get_attribute("title") is None, button.evaluate("el => el.outerHTML")


def check_format_bar(page):
    bar = page.locator("#format-bar")
    heading = page.locator("#heading-button")
    menu = page.locator("#heading-menu")
    source = bar.locator('[data-action="source"]')
    source_item = page.locator('#more-menu [data-menu-action="source"]')
    expect(bar).to_have_attribute("role", "toolbar")
    expect(bar).to_have_attribute("aria-label", "格式")
    order = bar.locator(".format-group").evaluate("el => [...el.children].flatMap(el => el.classList.contains('format-cluster') ? [...el.children] : [el]).map(el => el.classList.contains('format-sep') ? '|' : el.dataset.action || el.id)")
    assert order == ["insert-button", "undo", "redo", "|", "heading-button", "|", "bold", "italic", "underline", "strike", "highlight", "inlineCode", "superscript", "subscript", "clearFormatting", "|", "quote", "bullet", "ordered", "task", "outdent", "indent", "|", "link", "image", "table", "code", "math", "mermaid", "footnote", "|", "source"], order
    for separator in bar.locator(".format-sep").all():
        expect(separator).to_have_attribute("aria-hidden", "true")
    expect(heading).to_have_attribute("data-tip", "标题级别")
    expect(heading).to_have_attribute("data-shortcut", "Mod+1–6")
    expect(heading).to_have_attribute("aria-haspopup", "menu")
    expect(bar.locator('[data-action="bold"]')).to_have_attribute("data-tip", "加粗")
    expect(bar.locator('[data-action="bold"]')).to_have_attribute("data-shortcut", "Mod+B")
    expect(bar.locator('[data-action="link"]')).to_have_attribute("data-tip", "链接")
    expect(bar.locator('[data-action="link"]')).to_have_attribute("data-shortcut", "Mod+L")
    expect(bar.locator('[data-action="footnote"]')).to_have_accessible_name("脚注")
    expect(bar.locator('[data-action="footnote"]')).to_have_attribute("data-tip", "脚注")
    expect(bar.locator('[data-action="mermaid"]')).to_have_accessible_name("图表")
    expect(bar.locator('[data-action="mermaid"]')).to_have_attribute("data-tip", "图表")
    expect(bar.locator('[data-action="math"]')).to_have_accessible_name("公式")
    expect(bar.locator('[data-action="math"]')).to_have_attribute("data-tip", "公式")
    expect(source).to_have_text("源码")
    expect(source).to_have_attribute("data-tip", "显示 Markdown 源码")
    expect(source).to_have_attribute("data-shortcut", "Mod+Shift+M")
    expect(source).to_be_hidden()
    expect(page.locator("#source-button, .source-toggle, .paper-top button")).to_have_count(0)
    expect(bar.locator('[data-action="image"]')).to_have_count(1)
    icons = bar.locator("button.tool").evaluate_all("els => els.map(el => ({action:el.dataset.action, svg:el.querySelector('svg').outerHTML}))")
    assert len(icons) == 24
    assert len({item["svg"] for item in icons}) == len(icons), icons
    assert bar.locator("button.tool").evaluate_all("els => els.every(el => el.getAttribute('aria-label') && getComputedStyle(el).width === '30px' && getComputedStyle(el).height === '32px')")
    accessible_buttons(page)
    for button in bar.locator("button:visible").all():
        assert button.get_attribute("data-tip") and button.get_attribute("title") is None, button.evaluate("el => el.outerHTML")

    with page.expect_response(lambda r: r.url.endswith("/api") and '"New"' in (r.request.post_data or "")):
        more_action(page, "new")
    content = page.locator('.cm-content[contenteditable="true"]')
    # An empty document shows only the CodeMirror placeholder.
    expect(page.locator(".cm-placeholder")).to_be_visible()
    content.focus()
    page.keyboard.insert_text("格式测试")
    for action, text, label in [("h1", "# 格式测试", "标题 1"), ("h3", "### 格式测试", "标题 3"), ("h4", "#### 格式测试", "标题 4"), ("h5", "##### 格式测试", "标题 5"), ("h6", "###### 格式测试", "标题 6"), ("paragraph", "格式测试", "正文")]:
        heading.click()
        expect(menu).to_be_visible()
        expect(menu.locator("[role=menuitemradio] > span")).to_have_text(["正文"] + [f"标题 {i}" for i in range(1, 7)])
        # The heading menu stays under its button after moving the row.
        button_box, menu_box = heading.bounding_box(), menu.bounding_box()
        assert abs(menu_box["x"] - button_box["x"]) <= 1 and menu_box["y"] >= button_box["y"] + button_box["height"], (button_box, menu_box)
        expect(menu.locator('[aria-checked="true"]')).to_have_count(1)
        accessible_buttons(page)
        menu.locator(f'[data-menu-action="{action}"]').click()
        expect(menu).to_be_hidden()
        expect(content).to_be_focused()
        expect(content).to_have_text(text)
        expect(page.locator("#save-status")).to_have_text("草稿已保存")
        assert api(page, "State")["current"]["content"] == text
        expect(heading).to_have_text(label)
        expect(menu.locator(f'[data-menu-action="{action}"]')).to_have_attribute("aria-checked", "true")
    # Radio items use the shared menu's full keyboard navigation and dismissal.
    heading.focus()
    page.keyboard.press("ArrowDown")
    expect(menu.get_by_role("menuitemradio", name="正文", exact=True)).to_be_focused()
    page.keyboard.press("End")
    page.keyboard.press("Enter")
    expect(content).to_have_text("###### 格式测试")
    expect(content).to_be_focused()
    heading.click()
    page.keyboard.press("Escape")
    expect(heading).to_be_focused()
    expect(menu).to_be_hidden()

    content.focus()
    page.keyboard.press("Meta+a")
    page.keyboard.insert_text("# 标题行\n正文行")
    expect(heading).to_have_text("正文")
    page.keyboard.press("Meta+Home")
    expect(heading).to_have_text("标题 1")
    page.keyboard.press("Meta+End")
    expect(heading).to_have_text("正文")
    for action, marker, close in [("strike", "~~", "~~"), ("inlineCode", "`", "`"), ("underline", "<u>", "</u>"), ("highlight", "==", "=="), ("superscript", "<sup>", "</sup>"), ("subscript", "<sub>", "</sub>")]:
        page.keyboard.press("Meta+a")
        page.keyboard.insert_text("选中文字")
        page.keyboard.press("Meta+a")
        bar.locator(f'[data-action="{action}"]').click()
        expect(content).to_be_focused()
        expect(content).to_have_text(marker + "选中文字" + close)
        expect(page.locator("#save-status")).to_have_text("草稿已保存")
        assert api(page, "State")["current"]["content"] == marker + "选中文字" + close
        bar.locator(f'[data-action="{action}"]').click()
        expect(content).to_have_text("选中文字")

    def replace(text):
        content.focus()
        page.keyboard.press("Meta+a")
        if text:
            page.keyboard.insert_text(text)
        else:
            page.keyboard.press("Backspace")

    def saved_text(text):
        expect(page.locator("#save-status")).to_have_text("草稿已保存")
        assert api(page, "State")["current"]["content"] == text

    replace("下划线")
    page.keyboard.press("Meta+a")
    page.keyboard.press("Meta+u")
    saved_text("<u>下划线</u>")
    page.keyboard.press("Meta+u")
    saved_text("下划线")
    replace("**粗体** ==高亮== [链接](https://example.com/a_b)")
    page.keyboard.press("Meta+a")
    bar.locator('[data-action="clearFormatting"]').click()
    saved_text("粗体 高亮 链接")
    bar.locator('[data-action="undo"]').click()
    saved_text("**粗体** ==高亮== [链接](https://example.com/a_b)")
    bar.locator('[data-action="redo"]').click()
    saved_text("粗体 高亮 链接")
    for initial, expected in [("", "> "), ("已有正文", "已有正文\n\n> ")]:
        replace(initial)
        page.locator("#insert-button").click()
        expect(page.locator("#insert-menu [role=menuitem]")).to_have_count(17)
        page.locator('#insert-menu [data-menu-action="quote"]').click()
        saved_text(expected)
    replace("- 父项\n- 子项\n  - 孙项")
    page.keyboard.press("Meta+Home")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("End")
    expect(bar.locator('[data-action="indent"]')).to_be_enabled()
    bar.locator('[data-action="indent"]').click()
    saved_text("- 父项\n  - 子项\n    - 孙项")
    bar.locator('[data-action="outdent"]').click()
    saved_text("- 父项\n- 子项\n  - 孙项")
    page.keyboard.press("Tab")
    saved_text("- 父项\n  - 子项\n    - 孙项")
    page.keyboard.press("Shift+Tab")
    saved_text("- 父项\n- 子项\n  - 孙项")
    replace("正文")
    for action in ("indent", "outdent"):
        expect(bar.locator(f'[data-action="{action}"]')).to_be_disabled()
    page.locator('#document-find-button').click()
    expect(page.locator("#document-find")).to_be_visible()
    page.keyboard.press("Escape")
    replace("==亮== <u>线</u> <sup>上</sup> <sub>下</sub> ~~删~~\n\n光标")
    for selector, prop, expected in [(".md-underline", "textDecorationLine", "underline"), (".md-sup", "verticalAlign", "super"), (".md-sub", "verticalAlign", "sub")]:
        assert page.locator(selector).first.evaluate("(el, p) => getComputedStyle(el)[p]", prop) == expected
    # Hidden ~~ markers would leave struck text looking plain.
    assert page.locator(".cm-line span", has_text="删").last.evaluate("el => getComputedStyle(el).textDecorationLine") == "line-through"
    for theme in [t["id"] for t in THEMES]:
        set_theme(page, theme)
        assert page.locator(".md-highlight").evaluate("el => getComputedStyle(el).backgroundColor") not in ("transparent", "rgba(0, 0, 0, 0)"), theme
    page.evaluate("delete document.documentElement.dataset.liubaiTheme; delete document.documentElement.dataset.liubaiScheme")
    select_view(page, "read")
    for tag in ("mark", "u", "sup", "sub"):
        expect(page.locator(f"#preview-content {tag}")).to_have_count(1)
    select_view(page, "single")
    content.focus()

    page.keyboard.press("Meta+a")
    page.keyboard.insert_text("# 源码测试\n\n**格式标记**\n\n正文")
    page.keyboard.press("Meta+End")
    expect(page.locator(".cm-content .cm-line").first).not_to_contain_text("# ")
    select_view(page, "split")
    expect(source).to_be_visible()
    expect(source).to_have_attribute("aria-pressed", "false")
    appearance_change(page, lambda: source.click())
    expect(source).to_have_attribute("aria-pressed", "true")
    expect(source_item).to_have_attribute("aria-checked", "true")
    expect(page.locator(".cm-content .cm-line").first).to_have_text("# 源码测试")
    expect(content).to_contain_text("**格式标记**")
    appearance_change(page, lambda: source.click())
    expect(source).to_have_attribute("aria-pressed", "false")
    expect(source_item).to_have_attribute("aria-checked", "false")
    expect(page.locator(".cm-content .cm-line").first).not_to_contain_text("# ")
    select_view(page, "read")
    expect(bar).to_be_hidden()
    select_view(page, "single")
    expect(source).to_be_hidden()


def check_tooltip_timing(browser):
    """The tooltip's timing on a controlled clock: 500ms to appear, at once along the bar, 800ms of warmth after it closes."""
    context = browser.new_context(locale="zh-CN", viewport={"width": 1120, "height": 820})
    page = context.new_page()
    page.clock.install()
    page.goto(BASE)
    expect(page.locator(".cm-content")).to_be_visible()
    tip, name = page.locator("#tooltip"), page.locator("#tooltip span")

    def centre(action):
        box = page.locator(f'#format-bar [data-action="{action}"]').bounding_box()
        return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

    bold, italic, footnote = centre("bold"), centre("italic"), centre("footnote")
    page.mouse.move(5, 500)
    page.clock.pause_at(page.evaluate("Date.now()") + 1000)
    page.mouse.move(*bold)
    page.clock.run_for(499)
    expect(tip).to_be_hidden()
    page.clock.run_for(1)
    expect(tip).to_be_visible()
    expect(name).to_have_text("加粗")
    # Along the bar it follows at once: no time passes.
    page.mouse.move(*italic)
    expect(tip).to_be_visible()
    expect(name).to_have_text("斜体")
    page.mouse.move(5, 500)
    expect(tip).to_be_hidden()
    page.clock.run_for(799)
    page.mouse.move(*footnote)
    expect(tip).to_be_visible()
    expect(name).to_have_text("脚注")
    page.mouse.move(5, 500)
    page.clock.run_for(800)
    page.mouse.move(*bold)
    page.clock.run_for(499)
    expect(tip).to_be_hidden()
    page.clock.run_for(1)
    expect(tip).to_be_visible()
    context.close()


def check_tooltips(page):
    """The drawn tooltip: name and keys, the delay, moving along the bar, dismissal, keyboard focus, placement and theme."""
    tip, bar = page.locator("#tooltip"), page.locator("#format-bar")
    name, keys = tip.locator("span"), tip.locator("kbd")
    expect(tip).to_have_attribute("role", "tooltip")
    expect(tip).to_be_hidden()
    assert page.locator(".topbar [title], #format-bar [title], #drawer [title]").count() == 0
    for selector, label, shortcut, aria in [
        ('#format-bar [data-action="bold"]', "加粗", "Mod+B", "Meta+B"), ('#format-bar [data-action="italic"]', "斜体", "Mod+I", "Meta+I"),
        ('#format-bar [data-action="footnote"]', "脚注", None, None), ("#heading-button", "标题级别", "Mod+1–6", None),
        ('[data-view="single"]', "只显示编辑区", None, None), ('[data-view="split"]', "编辑区和阅读视图并排", "Mod+\\", "Meta+\\"),
        ('[data-view="read"]', "只显示排好版的文稿", "Mod+Shift+R", "Meta+Shift+R"), ('.drawer-head [data-action="new"]', "新建文稿", "Mod+N", "Meta+N"),
        ('#format-bar [data-action="source"]', "显示 Markdown 源码", "Mod+Shift+M", "Meta+Shift+M"), ("#sidebar-button", "侧栏：最近文稿", None, None),
    ]:
        control = page.locator(selector)
        expect(control).to_have_attribute("data-tip", label)
        assert control.get_attribute("data-shortcut") == shortcut, (selector, control.get_attribute("data-shortcut"))
        assert control.get_attribute("aria-keyshortcuts") == aria, (selector, control.get_attribute("aria-keyshortcuts"))

    # The timing itself is checked on a controlled clock in check_tooltip_timing.
    page.mouse.move(5, 500)
    bold = bar.locator('[data-action="bold"]')
    bold.hover()
    expect(tip).to_be_visible()
    expect(name).to_have_text("加粗")
    expect(keys).to_have_text("⌘B")
    expect(bold).to_have_attribute("aria-describedby", "tooltip")
    b, t = bold.bounding_box(), tip.bounding_box()
    assert abs(t["x"] + t["width"] / 2 - (b["x"] + b["width"] / 2)) <= 1.5 and 4 <= t["y"] - (b["y"] + b["height"]) <= 8, (b, t)
    for action, label, shortcut in [("italic", "斜体", "⌘I"), ("strike", "删除线", "⌘⇧X"), ("ordered", "有序列表", "⌘⇧7"), ("footnote", "脚注", "")]:
        bar.locator(f'[data-action="{action}"]').hover()
        expect(name).to_have_text(label)
        expect(keys).to_have_text(shortcut)
    expect(keys).to_be_hidden()
    assert bold.get_attribute("aria-describedby") is None
    page.locator("#heading-button").hover()
    expect(name).to_have_text("标题级别")
    expect(keys).to_have_text("⌘1–6")

    # Leaving and Escape hide it. A press hides it until the pointer leaves that control.
    page.mouse.move(5, 500)
    expect(tip).to_be_hidden()
    bold.hover()
    expect(tip).to_be_visible()
    page.keyboard.press("Escape")
    expect(tip).to_be_hidden()
    page.mouse.move(5, 500)
    page.wait_for_timeout(900)
    find = page.locator('#document-find-button')
    find.hover()
    expect(name).to_have_text("查找正文")
    box = find.bounding_box()
    page.mouse.down()
    expect(tip).to_be_hidden()
    page.mouse.up()
    expect(page.locator("#document-find")).to_be_visible()
    page.mouse.move(box["x"] + box["width"] / 2 + 3, box["y"] + box["height"] / 2 + 2)
    page.wait_for_timeout(900)
    expect(tip).to_be_hidden()
    page.mouse.move(5, 500)
    find.hover()
    expect(tip).to_be_hidden()  # An expanded topbar control suppresses its tooltip.
    page.locator("#find-query").focus()
    page.keyboard.press("Escape")
    expect(tip).to_be_hidden()
    expect(page.locator("#document-find")).to_be_hidden()

    # No tooltip for a control whose menu is open.
    page.locator("#heading-button").click()
    expect(page.locator("#heading-menu")).to_be_visible()
    page.mouse.move(5, 500)
    page.locator("#heading-button").hover()
    page.wait_for_timeout(900)
    expect(tip).to_be_hidden()
    page.keyboard.press("Escape")
    expect(page.locator("#heading-menu")).to_be_hidden()

    # Keyboard focus shows it at once; leaving the control hides it.
    page.mouse.move(5, 500)
    bold.focus()
    page.keyboard.press("Tab")
    expect(bar.locator('[data-action="italic"]')).to_be_focused()
    expect(name).to_have_text("斜体")
    expect(tip).to_be_visible()
    page.keyboard.press("Shift+Tab")
    expect(name).to_have_text("加粗")
    page.locator(".cm-content").focus()
    expect(tip).to_be_hidden()

    # Enter and Escape hide it, and the focus they hand back does not bring it back.
    page.locator("#doc-title").focus()
    page.keyboard.press("Shift+Tab")
    expect(page.locator("#sidebar-button")).to_be_focused()
    expect(tip).to_be_visible()
    expect(name).to_have_text("侧栏：最近文稿")
    page.keyboard.press("Enter")
    expect(page.locator("#drawer")).to_be_visible()
    expect(tip).to_be_hidden()
    page.keyboard.press("Escape")
    expect(page.locator("#drawer")).to_be_hidden()
    expect(page.locator("#sidebar-button")).to_be_focused()
    page.wait_for_timeout(300)
    expect(tip).to_be_hidden()
    heading = page.locator("#heading-button")
    heading.focus()
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Tab")
    expect(heading).to_be_focused()
    expect(tip).to_be_visible()
    expect(name).to_have_text("标题级别")
    page.keyboard.press("Enter")
    expect(page.locator("#heading-menu")).to_be_visible()
    expect(tip).to_be_hidden()
    page.keyboard.press("Escape")
    expect(heading).to_be_focused()
    page.wait_for_timeout(300)
    expect(tip).to_be_hidden()
    assert heading.get_attribute("aria-describedby") is None
    # A control removed under the tooltip takes the tooltip with it.
    page.evaluate("""() => { const b = document.createElement('button'); b.id = 'tip-gone'; b.dataset.tip = '临时'; b.textContent = '临'; b.style.cssText = 'position:fixed;left:300px;top:300px'; document.body.append(b) }""")
    page.mouse.move(5, 500)
    page.locator("#tip-gone").hover()
    expect(tip).to_be_visible()
    page.evaluate("document.querySelector('#tip-gone').remove()")
    page.mouse.move(310, 330)
    page.mouse.move(320, 340)
    expect(tip).to_be_hidden()

    # Near the window's edges it stays 8px inside; with no room below it sits above the control.
    page.set_viewport_size({"width": 680, "height": 820})
    for selector in ("#sidebar-button", ".export-button"):
        page.mouse.move(5, 700)
        page.locator(selector).hover()
        expect(tip).to_be_visible()
        t = tip.bounding_box()
        assert t["x"] >= 7.5 and t["x"] + t["width"] <= 680 - 7.5, (selector, t)
    page.set_viewport_size({"width": 1120, "height": 820})
    page.evaluate("""() => { const b = document.createElement('button'); b.id = 'tip-probe'; b.dataset.tip = '底部'; b.textContent = '底'; b.style.cssText = 'position:fixed;left:2px;bottom:2px'; document.body.append(b) }""")
    page.mouse.move(5, 400)
    page.locator("#tip-probe").hover()
    expect(tip).to_be_visible()
    p, t = page.locator("#tip-probe").bounding_box(), tip.bounding_box()
    assert t["y"] + t["height"] <= p["y"] - 4 and t["x"] >= 7.5, (p, t)
    page.mouse.move(5, 400)
    page.evaluate("document.querySelector('#tip-probe').remove()")

    # Floating paper in every theme: in Ink it takes Ink's popover colour.
    set_theme(page, "ink")
    bold.hover()
    expect(tip).to_be_visible()
    colours = page.evaluate("""() => { const probe = document.createElement('div'); probe.style.background = 'var(--popover)'; document.body.append(probe);
      const pair = [getComputedStyle(document.querySelector('#tooltip')).backgroundColor, getComputedStyle(probe).backgroundColor]; probe.remove(); return pair }""")
    assert colours[0] == colours[1], colours
    page.evaluate("delete document.documentElement.dataset.liubaiTheme; delete document.documentElement.dataset.liubaiScheme")
    page.mouse.move(5, 500)
    expect(tip).to_be_hidden()


def check_format_shortcuts(page):
    """The format keys do what their toolbar buttons do, and nothing where the buttons do nothing."""
    with page.expect_response(lambda r: r.url.endswith("/api") and '"New"' in (r.request.post_data or "")):
        more_action(page, "new")
    content = page.locator('.cm-content[contenteditable="true"]')

    def replace(text):
        content.focus()
        page.keyboard.press("Meta+a")
        page.keyboard.insert_text(text)

    def saved_text(text):
        expect(page.locator("#save-status")).to_have_text("草稿已保存")
        assert api(page, "State")["current"]["content"] == text, api(page, "State")["current"]["content"]

    # ⌘1–⌘6 set every selected line's level, as the heading menu does; ⌘0 returns to body text.
    replace("第一行\n第二行")
    page.keyboard.press("Meta+a")
    for level in (1, 2, 3, 4, 5, 6, 6):
        page.keyboard.press(f"Meta+{level}")
        saved_text("#" * level + " 第一行\n" + "#" * level + " 第二行")
    expect(page.locator("#heading-label")).to_have_text("标题 6")
    page.keyboard.press("Meta+0")
    saved_text("第一行\n第二行")
    # Inline formats wrap the selection, and the same key unwraps it.
    for keys, opening, closing in [("Meta+i", "_", "_"), ("Meta+Shift+X", "~~", "~~"), ("Meta+Shift+H", "==", "=="), ("Meta+e", "`", "`"), ("Meta+b", "**", "**"), ("Meta+u", "<u>", "</u>")]:
        replace("选中文字")
        page.keyboard.press("Meta+a")
        page.keyboard.press(keys)
        saved_text(opening + "选中文字" + closing)
        page.keyboard.press(keys)
        saved_text("选中文字")
    # Lists toggle on every selected line.
    for keys, first, second in [("Meta+Shift+7", "1. ", "2. "), ("Meta+Shift+8", "- ", "- "), ("Meta+Shift+9", "- [ ] ", "- [ ] ")]:
        replace("第一项\n第二项")
        page.keyboard.press("Meta+a")
        page.keyboard.press(keys)
        saved_text(first + "第一项\n" + second + "第二项")
        page.keyboard.press(keys)
        saved_text("第一项\n第二项")
    # Other modifiers do nothing: ⌘⇧E, ⌥⌘1 and, on macOS, ⌃1.
    replace("不变")
    page.keyboard.press("Meta+a")
    for keys in ("Meta+Shift+E", "Meta+Alt+1", "Control+1"):
        page.keyboard.press(keys)
    page.wait_for_timeout(300)
    saved_text("不变")
    # In a text field the keys belong to the field: ⌘B there no longer bolds the document.
    page.locator("#sidebar-button").click()
    search = page.locator("#recent-search")
    search.fill("搜索")
    for keys in ("Meta+1", "Meta+b", "Meta+Shift+7"):
        search.press(keys)
    expect(search).to_be_focused()
    expect(search).to_have_value("搜索")
    page.wait_for_timeout(300)
    saved_text("不变")
    search.fill("")
    page.keyboard.press("Escape")
    # Reading mode keeps the text and says how to get back.
    select_view(page, "read")
    page.keyboard.press("Meta+1")
    expect(page.locator("#toast")).to_contain_text("阅读模式下不能编辑")
    select_view(page, "single")
    saved_text("不变")
    # The heading menu and All Commands show the same keys.
    page.locator("#heading-button").click()
    expect(page.locator("#heading-menu [role=menuitemradio] kbd")).to_have_text(["⌘0"] + [f"⌘{i}" for i in range(1, 7)])
    expect(page.locator('#heading-menu [data-menu-action="h2"]')).to_have_attribute("aria-keyshortcuts", "Meta+2")
    expect(page.locator('#heading-menu [data-menu-action="h2"]')).to_have_accessible_name("标题 2")
    page.keyboard.press("Escape")
    content.focus()
    page.keyboard.press("Meta+k")
    for label, keys in [("斜体选中文字", "⌘ I"), ("删除线", "⌘ ⇧ X"), ("高亮", "⌘ ⇧ H"), ("行内代码", "⌘ E"), ("正文", "⌘ 0"), ("标题 1", "⌘ 1"), ("标题 6", "⌘ 6"), ("有序列表", "⌘ ⇧ 7"), ("无序列表", "⌘ ⇧ 8"), ("插入任务列表", "⌘ ⇧ 9")]:
        row = page.locator("#command-list .command").filter(has=page.locator("span", has_text=re.compile("^" + re.escape(label) + "$")))
        expect(row.locator("kbd")).to_have_text(keys)
    page.keyboard.press("Escape")


def settled(page):
    page.evaluate("async () => {await document.fonts.ready;await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))}")


def page_geometry(page):
    return page.evaluate("""() => {
      const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
      const style=s=>{const c=getComputedStyle(document.querySelector(s));return {shadow:c.boxShadow,radius:c.borderRadius,border:c.borderTopWidth}};
      const scroll=document.querySelector('.editor-scroll');
      return {pane:rect('.editor-pane'),paper:rect('.paper'),text:rect('.cm-content'),bar:rect('#format-bar'),
        count:rect('#word-count'),top:rect('.topbar'),scroll:rect('.editor-scroll'),paperStyle:style('.paper'),
        scrollHeight:scroll.scrollHeight,clientHeight:scroll.clientHeight,scrollClientRight:scroll.getBoundingClientRect().left+scroll.clientWidth,width:innerWidth,height:innerHeight};
    }""")


def assert_count_position(page, g):
    expect(page.locator("#word-count")).to_be_visible()
    assert 0 <= g["pane"]["right"] - g["count"]["right"] <= 26, g
    assert 0 <= g["pane"]["bottom"] - g["count"]["bottom"] <= 16, g
    assert g["count"]["y"] >= g["scroll"]["bottom"], g


def set_width(page, value):
    page.locator('[data-action="settings"]').click()
    appearance_change(page, lambda: page.locator("#line-width").select_option(value=value))
    page.keyboard.press("Escape")
    settled(page)


def check_writing_sheet(page):
    def new_document():
        with page.expect_response(lambda r: r.url.endswith("/api") and '"New"' in (r.request.post_data or "")):
            more_action(page, "new")
        expect(page.locator(".cm-placeholder")).to_be_visible()

    select_view(page, "single")
    new_document()
    expect(page.locator(".desk-caption, #document-kind, .paper-top, .paper-bottom, .desk-bottom")).to_have_count(0)
    expect(page.get_by_text("写下这一刻。", exact=True)).to_have_count(0)
    expect(page.locator(".topbar #workspace-label")).to_have_text("本地开发版 · 独立草稿存档")
    expect(page.locator(".topbar #workspace-label")).to_be_visible()
    for width, height in ((1700, 1100), (1120, 820)):
        page.set_viewport_size({"width": width, "height": height})
        for value, cap in (("normal", 760), ("wide", 920), ("full", width)):
            set_width(page, value)
            g = page_geometry(page)
            assert abs(g["bar"]["y"] - g["top"]["bottom"]) <= 2 and abs(g["pane"]["y"] - g["bar"]["bottom"]) <= 2, g
            assert abs(g["pane"]["x"]) <= 2 and abs(g["pane"]["right"] - width) <= 2, g
            assert abs(g["pane"]["bottom"] - height) <= 2, g
            assert g["paperStyle"] == {"shadow": "none", "radius": "0px", "border": "0px"}, g
            assert abs(g["text"]["width"] - (cap - 96)) <= 2, g
            assert abs((g["text"]["x"] - g["pane"]["x"]) - (g["pane"]["right"] - g["text"]["right"])) <= 2, g
            assert abs(g["bar"]["x"] - g["pane"]["x"]) <= 2 and abs(g["bar"]["width"] - g["pane"]["width"]) <= 2, g
            assert abs(g["bar"]["bottom"] - g["pane"]["y"]) <= 2, g
            assert g["scrollHeight"] == g["clientHeight"], g
            assert_count_position(page, g)

    # Full width persists and applies to the reader's text column too.
    page.reload()
    content = page.locator('.cm-content[contenteditable="true"]')
    expect(content).to_be_visible()
    assert api(page, "State")["appearance"]["lineWidth"] == "full"
    select_view(page, "read")
    g = page.locator("#preview").bounding_box()
    top = page.locator(".topbar").bounding_box()
    assert abs(g["x"]) <= 2 and abs(g["width"] - 1120) <= 2 and abs(g["y"] - top["y"] - top["height"]) <= 2 and abs(g["y"] + g["height"] - 820) <= 2, g
    for value, cap in (("normal", 760), ("wide", 920), ("full", 1120)):
        set_width(page, value)
        document = page.locator(".markdown-document").bounding_box()
        assert abs(document["width"] - cap) <= 2 and abs(document["x"] - (1120 - cap) / 2) <= 2, document
    expect(page.locator("#word-count")).to_be_hidden()
    select_view(page, "single")
    set_width(page, "normal")
    content.focus()
    page.keyboard.insert_text("第一行\n第二行\n第三行")
    expect(page.locator("#word-count")).to_have_text("9 字")
    page.keyboard.press("Meta+Home")
    page.locator('[data-action="settings"]').focus()
    g = page_geometry(page)
    # The page outside the centred text column also appends at the end.
    page.mouse.click(g["pane"]["x"] + 10, g["scroll"]["bottom"] - 24)
    expect(content).to_be_focused()
    page.keyboard.insert_text("尾")
    expect(content.locator(".cm-line")).to_have_text(["第一行", "第二行", "第三行尾"])
    expect(page.locator("#word-count")).to_have_text("10 字")
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    assert api(page, "State")["current"]["content"] == "第一行\n第二行\n第三行尾"

    page.keyboard.press("Meta+a")
    page.keyboard.insert_text("\n".join(f"长文第{i}行" for i in range(1, 121)))
    page.keyboard.press("Meta+End")
    page.locator(".editor-scroll").evaluate("el => el.scrollTop=el.scrollHeight")
    last = content.locator(".cm-line", has_text=re.compile("^长文第120行$"))
    expect(last).to_be_visible()
    settled(page)
    g = page_geometry(page)
    assert g["scrollHeight"] > g["clientHeight"], g
    assert abs(g["bar"]["bottom"] - g["pane"]["y"]) <= 2, g
    expect(page.locator("#format-bar [data-action=bold]")).to_be_in_viewport()
    line = last.bounding_box()
    assert g["count"]["y"] >= line["y"] + line["height"], (g, line)
    assert_count_position(page, g)
    page.mouse.click(g["pane"]["right"] - 10, g["scroll"]["bottom"] - 12)
    page.keyboard.insert_text("尾")
    expect(content.locator(".cm-line", has_text=re.compile("^长文第120行尾$"))).to_be_visible()
    settled(page)
    last_line = content.locator(".cm-line", has_text=re.compile("^长文第120行尾$")).bounding_box()
    assert last_line["y"] + last_line["height"] <= page.locator("#word-count").bounding_box()["y"]
    # ⌘↑ returns to the very top, page padding included.
    page.keyboard.press("Meta+Home")
    page.wait_for_function("() => document.querySelector('.editor-scroll').scrollTop === 0")
    # Keyboard movement must keep the current line below the separate format row.
    page.keyboard.press("Meta+Home")
    for _ in range(40):
        page.keyboard.press("ArrowDown")
    page.wait_for_function("""() => {
      const node=getSelection()?.anchorNode, el=node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;
      const line=el?.closest('.cm-line');
      return line && line.getBoundingClientRect().top >= document.querySelector('#format-bar').getBoundingClientRect().bottom;
    }""")
    new_document()


def check_split_columns(page):
    select_view(page, "split")
    for width, height in ((1700, 1100), (1120, 820), (800, 700), (680, 540)):
        page.set_viewport_size({"width": width, "height": height})
        for value, cap in (("normal", 760), ("wide", 920), ("full", width)):
            set_width(page, value)
            g = page_geometry(page)
            r = page.locator("#preview").bounding_box()
            assert abs(g["bar"]["y"] - g["top"]["bottom"]) <= 2 and abs(g["pane"]["y"] - g["bar"]["bottom"]) <= 2, g
            if width >= 820:
                assert abs(g["pane"]["width"] - r["width"]) <= 2 and abs(r["x"] - g["pane"]["right"] - 1) <= .1, (g, r)
                assert abs(r["y"] - g["pane"]["y"]) <= 2 and abs(g["pane"]["bottom"] - height) <= 2, (g, r)
            else:
                assert abs(g["pane"]["height"] - r["height"]) <= 2 and abs(r["y"] - g["pane"]["bottom"] - 1) <= .1, (g, r)
                assert abs(r["x"]) <= 2 and abs(r["width"] - width) <= 2, (g, r)
            assert abs(r["y"] + r["height"] - height) <= 2, r
            gutter = 48 if width > 850 else 30
            assert abs(g["text"]["width"] - (min(cap, g["paper"]["width"]) - 2 * gutter)) <= 2, g
            assert abs((g["text"]["x"] - g["pane"]["x"]) - (g["pane"]["right"] - g["text"]["right"])) <= 2, g
            document = page.locator(".markdown-document").bounding_box()
            assert abs(document["width"] - min(cap, r["width"])) <= 2, (document, r)
            assert abs((document["x"] - r["x"]) - (r["x"] + r["width"] - document["x"] - document["width"])) <= 2, (document, r)
            assert_count_position(page, g)
            assert page.locator("#preview").evaluate("el => getComputedStyle(el).boxShadow==='none' && getComputedStyle(el).borderRadius==='0px'")
    page.set_viewport_size({"width": 1120, "height": 820})
    set_width(page, "normal")
    select_view(page, "single")


def check_docked_sidebar_and_outline(page):
    page.set_viewport_size({"width": 1700, "height": 1100})
    select_view(page, "single")
    set_width(page, "normal")
    content = page.locator('.cm-content[contenteditable="true"]')
    text = "# 第一节\n\n" + "正文。\n\n" * 30 + "## 第二节\n\n" + "正文。\n\n" * 30 + "### 第三节\n\n" + "结尾。\n\n" * 40
    content.focus()
    page.keyboard.press("Meta+a")
    page.keyboard.insert_text(text)
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    page.keyboard.press("Meta+Home")
    drawer, sidebar = page.locator("#drawer"), page.locator("#sidebar-button")
    outline = page.locator("#right-outline")
    items = outline.locator("button")
    expect(outline).to_be_visible()
    expect(items).to_have_text(["第一节", "第二节", "第三节"])
    expect(outline.locator(".outline-label")).to_have_text("大纲")

    def geometry(docked):
        settled(page)
        g = page_geometry(page)
        group = page.locator(".format-group").bounding_box()
        assert abs(g["bar"]["y"] - g["top"]["bottom"]) <= 1, g
        assert abs((group["x"] - g["bar"]["x"]) - (g["bar"]["right"] - group["x"] - group["width"])) <= 4, (g, group)
        left = drawer.bounding_box()["width"] if docked else 0
        assert abs(g["bar"]["x"] - left) <= 1 and abs(g["pane"]["x"] - left) <= 1, g
        assert abs(g["bar"]["right"] - 1700) <= 1 and abs(g["pane"]["right"] - 1700) <= 1, g
        assert abs((g["text"]["x"] - left) - (g["scrollClientRight"] - g["text"]["right"])) <= 2, g
        if docked:
            assert drawer.bounding_box()["x"] == 0
            assert drawer.evaluate("el => getComputedStyle(el).boxShadow") == "none"
        if outline.is_visible():
            box = outline.bounding_box()
            assert box["x"] >= g["text"]["right"] and box["x"] + box["width"] <= 1700, (g, box)

    geometry(False)
    appearance_change(page, sidebar.click)
    expect(drawer).to_be_visible()
    geometry(True)
    content.click()
    page.keyboard.press("Escape")
    expect(drawer).to_be_visible()
    expect(outline).to_be_visible()
    items.nth(2).click()
    expect(items.nth(2)).to_have_attribute("aria-current", "location")
    page.wait_for_function("""() => getSelection()?.anchorNode?.parentElement?.closest('.cm-line')?.textContent.includes('第三节')""")
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    saved_position(page, lambda current: current["position"]["anchor"] == text.index("### 第三节"))
    page.reload()
    expect(drawer).to_be_visible()
    geometry(True)
    assert api(page, "State")["appearance"]["sidebarDocked"] is True
    select_view(page, "split")
    expect(drawer).to_be_visible()
    expect(outline).to_be_hidden()
    left, right = page.locator(".editor-pane").bounding_box(), page.locator("#preview").bounding_box()
    assert abs(left["width"] - right["width"]) <= 2 and abs(left["x"] - drawer.bounding_box()["width"]) <= 1, (left, right)
    select_view(page, "read")
    expect(drawer).to_be_visible()
    expect(outline).to_be_visible()
    expect(page.locator("#format-bar")).to_be_hidden()
    reader = page.locator("#preview").bounding_box()
    assert abs(reader["x"] - drawer.bounding_box()["width"]) <= 1 and abs(reader["x"] + reader["width"] - 1700) <= 1, reader
    select_view(page, "single")
    page.set_viewport_size({"width": 1000, "height": 800})
    expect(drawer).to_be_hidden()
    assert page.locator(".editor-pane").bounding_box()["x"] == 0
    sidebar.click()
    expect(drawer).to_be_visible()
    assert drawer.evaluate("el => getComputedStyle(el).position") == "fixed"
    assert drawer.evaluate("el => getComputedStyle(el).boxShadow") != "none"
    page.keyboard.press("Escape")
    expect(drawer).to_be_hidden()
    assert api(page, "State")["appearance"]["sidebarDocked"] is True
    sidebar.click()
    page.mouse.click(950, 200)
    expect(drawer).to_be_hidden()
    page.set_viewport_size({"width": 1700, "height": 1100})
    expect(drawer).to_be_visible()
    geometry(True)
    appearance_change(page, lambda: drawer.locator('[data-close="drawer"]').click())
    expect(drawer).to_be_hidden()
    geometry(False)
    assert api(page, "State")["appearance"]["sidebarDocked"] is False
    appearance_change(page, sidebar.click)
    expect(drawer).to_be_visible()
    appearance_change(page, sidebar.click)
    expect(drawer).to_be_hidden()
    geometry(False)
    page.set_viewport_size({"width": 1000, "height": 800})
    sidebar.click()
    page.keyboard.press("Escape")
    assert api(page, "State")["appearance"]["sidebarDocked"] is False
    page.set_viewport_size({"width": 1700, "height": 1100})
    expect(drawer).to_be_hidden()

    select_view(page, "split")
    expect(outline).to_be_hidden()
    select_view(page, "single")
    set_width(page, "full")
    expect(outline).to_be_hidden()
    set_width(page, "normal")
    page.set_viewport_size({"width": 1120, "height": 820})
    expect(outline).to_be_hidden()
    page.set_viewport_size({"width": 1700, "height": 1100})
    more_action(page, "focus")
    expect(outline).to_be_hidden()
    page.keyboard.press("Escape")
    expect(outline).to_be_visible()
    select_view(page, "read")
    expect(outline).to_be_visible()
    expect(page.locator("#format-bar")).to_be_hidden()
    items.nth(2).click()
    expect(items.nth(2)).to_have_attribute("aria-current", "location")
    page.wait_for_function("""() => {
      const h=document.querySelector('#preview-content h3'),s=document.querySelector('.preview-scroll');
      return s.scrollTop>0 && Math.abs(h.getBoundingClientRect().top-s.getBoundingClientRect().top)<=2;
    }""")
    select_view(page, "single")
    content.focus()
    page.keyboard.press("Meta+a")
    page.keyboard.insert_text("# 唯一标题\n\n正文")
    expect(outline).to_be_hidden()
    page.set_viewport_size({"width": 680, "height": 820})
    for layout in ("single", "split"):
        select_view(page, layout)
        expect(page.locator("#format-bar button:visible")).to_have_count(27 if layout == "split" else 26)
        boxes = page.locator("#format-bar button:visible").evaluate_all("els => els.map(el => {const r=el.getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom}})")
        assert len({b["y"] for b in boxes}) >= 2, boxes
        bar = page.locator("#format-bar").bounding_box()
        for b in boxes:
            assert b["x"] >= 0 and b["right"] <= 680 and b["y"] >= bar["y"] and b["bottom"] <= bar["y"] + bar["height"], (bar, b)
    page.set_viewport_size({"width": 1120, "height": 820})
    select_view(page, "single")


def run(page):
    page.goto(BASE)
    expect(page.locator(".cm-content")).to_be_visible()
    order = page.locator(".topbar button").evaluate_all("els => els.map(el => el.id || el.dataset.view || el.dataset.action)")
    assert order == ["sidebar-button", "doc-title", "single", "split", "read", "settings", "document-find-button", "deliver", "more-button", "outline-button"], order
    assert page.locator(".view-switch button").all_text_contents() == ["编辑", "分栏", "阅读"]
    expect(page.locator('.view-switch')).to_have_attribute("role", "radiogroup")
    expect(page.locator('.view-switch')).to_have_attribute("aria-label", "视图")
    expect(page.locator('.view-switch [role="radio"]')).to_have_count(3)
    accessible_buttons(page)
    icons = page.locator('.topbar button, .drawer-head button, #format-bar button').evaluate_all("""els => els.filter(el => el.querySelector('svg')).map(el => ({
      action:el.dataset.action || el.dataset.close || el.id, svg:el.querySelector('svg').outerHTML
    }))""")
    for i, first in enumerate(icons):
        for second in icons[i + 1:]:
            assert first["action"] == second["action"] or first["svg"] != second["svg"], (first, second)

    check_format_bar(page)
    check_tooltips(page)
    check_tooltip_timing(page.context.browser)
    check_format_shortcuts(page)
    check_writing_sheet(page)
    check_split_columns(page)
    check_docked_sidebar_and_outline(page)

    # Use the real New action and autosave before checking sidebar headings/recent.
    with page.expect_response(lambda r: r.url.endswith("/api") and '"New"' in (r.request.post_data or "")):
        more_action(page, "new")
    page.locator('.cm-content[contenteditable="true"]').click()
    page.keyboard.insert_text(TEXT)
    expect(page.locator("#save-status")).to_have_text("草稿已保存")
    title = page.locator("#doc-title").inner_text()

    select_view(page, "split")
    expect(page.locator("#preview")).to_be_visible()
    select_view(page, "read")
    expect(page.locator("#format-bar")).to_be_hidden()
    expect(page.locator(".editor-pane")).to_be_hidden()
    select_view(page, "single")
    expect(page.locator(".editor-pane")).to_be_visible()
    expect(page.locator("#preview")).to_be_hidden()
    appearance_change(page, lambda: page.keyboard.press("Meta+\\"))
    assert_view(page, "split")
    appearance_change(page, lambda: page.keyboard.press("Meta+Shift+R"))
    assert_view(page, "read")
    appearance_change(page, lambda: page.keyboard.press("Meta+Shift+R"))
    assert_view(page, "split")
    page.locator('[data-view="split"]').focus()
    appearance_change(page, lambda: page.keyboard.press("ArrowLeft"))
    assert_view(page, "single")
    expect(page.locator('[data-view="single"]')).to_be_focused()
    appearance_change(page, lambda: page.keyboard.press("ArrowRight"))
    assert_view(page, "split")
    appearance_change(page, lambda: page.keyboard.press("ArrowRight"))
    assert_view(page, "read")
    appearance_change(page, lambda: page.keyboard.press("ArrowRight"))
    assert_view(page, "single")
    page.reload()
    expect(page.locator(".cm-content")).to_be_visible()
    assert_view(page, "single")

    sidebar = page.locator("#sidebar-button")
    drawer = page.locator("#drawer")
    sidebar.click()
    expect(drawer).to_be_visible()
    expect(sidebar).to_have_attribute("aria-expanded", "true")
    expect(page.locator('#drawer [role="tab"]')).to_have_count(0)
    expect(page.locator("#drawer .outline-item")).to_have_count(0)
    expect(page.locator("#recent-search")).to_be_visible()
    expect(page.locator(".drawer-open")).to_be_visible()
    accessible_buttons(page)
    sidebar.click()
    expect(drawer).to_be_hidden()
    expect(sidebar).to_have_attribute("aria-expanded", "false")
    sidebar.click()
    # Exact match: other test documents (第一节, 唯一标题) also contain the title character.
    expect(page.locator(".recent-item b", has_text=re.compile("^" + re.escape(title) + "$"))).to_have_count(1)
    accessible_buttons(page)
    page.locator('[data-close="drawer"]').click()
    expect(sidebar).to_have_attribute("aria-expanded", "false")

    more = page.locator("#more-button")
    menu = page.locator("#more-menu")
    first = menu.locator('[data-menu-action="new"]')
    source = menu.locator('[data-menu-action="source"]')
    focus = menu.locator('[data-menu-action="focus"]')
    more.click()
    expect(menu).to_be_visible()
    expect(more).to_have_attribute("aria-expanded", "true")
    expect(first).to_be_focused()
    # Dropdowns on the right half open right-aligned under their button.
    button_box, menu_box = more.bounding_box(), menu.bounding_box()
    assert abs((menu_box["x"] + menu_box["width"]) - (button_box["x"] + button_box["width"])) <= 1 and menu_box["y"] >= button_box["y"] + button_box["height"], (button_box, menu_box)
    accessible_buttons(page)
    expect(source).to_have_attribute("aria-disabled", "true")
    expect(source).to_contain_text("仅分栏可用")
    page.keyboard.press("ArrowDown")
    expect(menu.locator('[data-menu-action="open"]')).to_be_focused()
    page.keyboard.press("End")
    expect(menu.locator('[data-menu-action="commands"]')).to_be_focused()
    page.keyboard.press("ArrowUp")
    expect(menu.locator('[data-menu-action="captureSettings"]')).to_be_focused()
    page.keyboard.press("ArrowUp")  # Skip disabled source.
    expect(focus).to_be_focused()
    page.keyboard.press("Home")
    expect(first).to_be_focused()
    page.keyboard.press("Escape")
    expect(menu).to_be_hidden()
    expect(more).to_have_attribute("aria-expanded", "false")
    expect(more).to_be_focused()
    for key in ("Enter", "Space", "ArrowDown"):
        page.keyboard.press(key)
        expect(first).to_be_focused()
        page.keyboard.press("Escape")
    more.click()
    page.locator(".paper").click(position={"x": 10, "y": 200})
    expect(menu).to_be_hidden()
    expect(more).to_have_attribute("aria-expanded", "false")
    more.click()
    page.keyboard.press("Tab")
    expect(menu).to_be_hidden()

    select_view(page, "read")
    more.click()
    expect(focus).to_have_attribute("aria-disabled", "true")
    expect(source).to_have_attribute("aria-disabled", "true")
    page.keyboard.press("Escape")
    select_view(page, "split")
    more.click()
    expect(source).to_have_attribute("aria-disabled", "false")
    expect(source.locator("small")).to_be_hidden()
    previous = source.get_attribute("aria-checked")
    source.focus()
    appearance_change(page, lambda: page.keyboard.press("Space"))
    expect(menu).to_be_hidden()
    more.click()
    expect(source).to_have_attribute("aria-checked", "false" if previous == "true" else "true")
    page.keyboard.press("Escape")
    expect(page.locator('#format-bar [data-action="source"]')).to_have_attribute("aria-pressed", "false" if previous == "true" else "true")
    more_action(page, "focus")
    expect(page.locator("body")).to_have_class(re.compile("focus-mode"))
    page.keyboard.press("Escape")
    expect(page.locator("body")).not_to_have_class(re.compile("focus-mode"))
    more.click()
    page.keyboard.press("End")
    page.keyboard.press("Enter")
    expect(page.locator("#commands")).to_be_visible()
    expect(page.locator("#commands")).to_have_attribute("aria-label", "所有操作")
    for label in ("正文", "标题 1", "标题 2", "标题 3", "删除线", "行内代码"):
        expect(page.locator("#command-list .command span").filter(has_text=re.compile("^" + re.escape(label) + "$"))).to_have_count(1)
    expect(page.locator("#command-list")).not_to_contain_text("插入二级标题")
    page.keyboard.press("Escape")
    page.locator(".export-button").click()
    expect(page.locator("#delivery-dialog")).to_be_visible()
    expect(page.locator("#delivery-dialog h2")).to_have_text("导出这一页")
    page.keyboard.press("Escape")

    # Include desktop traffic-light space even though this test uses the web backend.
    page.evaluate("document.body.classList.add('desktop')")
    expect(page.locator('.topbar [data-action="settings"]')).to_be_hidden()
    expect(page.locator("#workspace-label")).to_be_hidden()
    for width in (1440, 1120, 800, 680):
        page.set_viewport_size({"width": width, "height": 820})
        accessible_buttons(page)
        geometry = page.locator(".topbar").evaluate("""bar => {
          const r=bar.getBoundingClientRect();
          return {overflow:bar.scrollWidth>bar.clientWidth || document.documentElement.scrollWidth>innerWidth,
            boxes:[...bar.querySelectorAll('button')].map(b => {const q=b.getBoundingClientRect();return {x:q.x,right:q.right,y:q.y,bottom:q.bottom}}),
            bounds:{x:r.x,right:r.right,y:r.y,bottom:r.bottom}};
        }""")
        assert not geometry["overflow"], geometry
        for box in geometry["boxes"]:
            assert box["x"] >= 0 and box["right"] <= width and box["y"] >= geometry["bounds"]["y"] and box["bottom"] <= geometry["bounds"]["bottom"], geometry
        for radio in page.locator(".view-switch button").all():
            expect(radio).to_be_visible()
        if width == 680:
            expect(page.locator(".export-label")).to_be_hidden()
            expect(page.locator(".export-button")).to_have_accessible_name("导出")
        # Narrow editors wrap the format bar onto another row; every control stays visible.
        for view in ("single", "split"):
            page.locator(f'[data-view="{view}"]').click()
            format_geometry = page.locator("#format-bar").evaluate("""bar => {
              const r=bar.getBoundingClientRect();
              return {scroll:bar.scrollWidth, width:bar.clientWidth, outside:[...bar.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.getBoundingClientRect()).filter(q => q.x < r.x - 1 || q.right > r.right + 1).length};
            }""")
            assert format_geometry["scroll"] <= format_geometry["width"] and format_geometry["outside"] == 0, (width, view, format_geometry)
            # Groups wrap whole, and no visible separator is left at the start or end of a row.
            page.wait_for_function("""() => [...document.querySelectorAll('#format-bar .format-group > .format-sep')].filter(s => s.offsetParent && getComputedStyle(s).visibility !== 'hidden').every(s => {
              const m = e => {const r = e.getBoundingClientRect(); return r.top + r.height / 2};
              return Math.abs(m(s.previousElementSibling) - m(s)) <= 8 && Math.abs(m(s.nextElementSibling) - m(s)) <= 8;
            }) && [...document.querySelectorAll('#format-bar .format-cluster')].every(c => new Set([...c.children].filter(b => b.offsetParent).map(b => Math.round(b.getBoundingClientRect().top))).size <= 1)""")
            expect(page.locator("#format-bar .format-source")).to_be_visible() if view == "split" else None
            page.locator("#format-bar").screenshot(path=str(ARTIFACTS / f"format-bar-{width}-{view}.png"))
        page.locator('[data-view="single"]').click()
        page.locator(".topbar").screenshot(path=str(ARTIFACTS / f"toolbar-{width}.png"))
    page.evaluate("localStorage.setItem('mygo:locale','en')")
    page.reload()
    for action, label in [("footnote", "Footnote"), ("mermaid", "Diagram"), ("math", "Formula"), ("underline", "Underline"), ("highlight", "Highlight"), ("superscript", "Superscript"), ("subscript", "Subscript"), ("clearFormatting", "Clear Formatting"), ("indent", "Increase Indent"), ("outdent", "Decrease Indent")]:
        expect(page.locator(f'#format-bar [data-action="{action}"]')).to_have_accessible_name(label)
    expect(page.locator("#document-find-button")).to_have_accessible_name("Find in Document")
    expect(page.locator("#insert-button")).to_have_accessible_name("Insert")
    page.locator('#format-bar [data-action="bold"]').hover()
    expect(page.locator("#tooltip")).to_be_visible()
    expect(page.locator('#format-bar [data-action="bold"]')).to_have_attribute("aria-describedby", "tooltip")
    expect(page.locator("#tooltip span")).to_have_text("Bold")
    expect(page.locator("#tooltip kbd")).to_have_text("⌘B")
    page.locator('[data-view="split"]').hover()
    expect(page.locator("#tooltip")).to_be_visible()
    expect(page.locator('[data-view="split"]')).to_have_attribute("aria-describedby", "tooltip")
    expect(page.locator("#tooltip span")).to_have_text("Show the editor and reading view side by side")
    page.mouse.move(5, 500)
    page.locator("#heading-button").click()
    expect(page.locator("#heading-menu [role=menuitemradio] > span")).to_have_text(["Body"] + [f"Heading {i}" for i in range(1, 7)])
    page.keyboard.press("Escape")
    print("PASS: whole-page bounds/flat panes/centred normal-wide-full columns, format row/word count/long-document/click-to-write, equal split/stacked divider/full reader, format groups/names/icons/headings/cursor/wrapping/source, toolbar order/names/icons, view radios/shortcuts/reload, docked/overlay sidebar persistence/resizing, right outline geometry/jumps/active heading/visibility, sidebar recent documents only, menu keyboard/dismissal/disabled/source/focus/commands, export, responsive toolbar")


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
